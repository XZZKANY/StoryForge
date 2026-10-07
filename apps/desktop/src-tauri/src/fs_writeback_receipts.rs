// Persistent at-most-once admission for one approved Desktop writeback operation.
// Intent and outcome are separate immutable, synced files. A surviving intent without
// outcome is UNKNOWN, including when target bytes equal before/after: never replay it.
use crate::fs::{self as project_fs, DiskBaseline};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritebackRequest {
    pub operation_key: String,
    pub source: String,
    pub path: String,
    pub content: String,
}
// Read-only identity description. This is not admission, authorization, or a receipt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritebackIdentity {
    pub relative_path: String,
    pub operation_id: String,
    pub fingerprint: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritebackReceipt {
    pub operation_id: String,
    pub state: String,
    pub current: String,
    pub checkpoint_timestamp: Option<u64>,
    pub created_file: bool,
    pub receipt_persisted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Intent {
    schema_version: u8,
    operation_id: String,
    fingerprint: String,
    relative_path: String,
    before_hash: Option<String>,
    after_hash: String,
    checkpoint_timestamp: Option<u64>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Outcome {
    schema_version: u8,
    operation_id: String,
    fingerprint: String,
    state: String,
    detail: Option<String>,
}
struct Location {
    root: PathBuf,
    target: PathBuf,
    directory: PathBuf,
    operation_id: String,
    fingerprint: String,
    relative_path: String,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
// Resolve existing ancestors too, so an in-project directory alias cannot mint
// a second operation identity for the same missing target.
fn canonical_pending_path(path: &Path) -> Result<PathBuf, String> {
    let mut cursor = path;
    let mut suffix = Vec::new();
    while !cursor.exists() {
        suffix.push(
            cursor
                .file_name()
                .ok_or("写回路径没有文件名")?
                .to_os_string(),
        );
        cursor = cursor.parent().ok_or("写回路径没有父目录")?;
    }
    let mut resolved = fs::canonicalize(cursor).map_err(|e| format!("无法解析写回路径: {e}"))?;
    for part in suffix.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved)
}
fn resolve(project_root: &str, request: &WritebackRequest) -> Result<Location, String> {
    if request.operation_key.is_empty() || request.operation_key.len() > 4096 {
        return Err("写回 operationKey 无效".into());
    }
    let target = Path::new(&request.path);
    let root = project_fs::validate_pending_mutation_path(project_root, target)?;
    let relative = target
        .strip_prefix(Path::new(project_root))
        .map_err(|_| "写回目标必须在当前项目内".to_string())?;
    if relative
        .components()
        .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("写回目标包含无效路径片段".into());
    }
    let canonical_target = canonical_pending_path(target)?;
    let canonical_relative = canonical_target
        .strip_prefix(&root)
        .map_err(|_| "写回目标不在当前项目内")?;
    let relative_path = canonical_relative.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let relative_path = relative_path.to_lowercase();
    let directory = root.join(".storyforge").join("writeback-receipts");
    project_fs::validate_pending_mutation_path(&root.to_string_lossy(), &directory)?;
    if canonical_target.starts_with(canonical_pending_path(&directory)?) {
        return Err("不能把写回回执目录用作正文目标".into());
    }
    let operation_id = hash(
        serde_json::to_string(&(&relative_path, &request.operation_key))
            .map_err(|e| e.to_string())?
            .as_bytes(),
    );
    let fingerprint = hash(
        serde_json::to_string(&(
            &relative_path,
            &request.operation_key,
            &request.source,
            &request.content,
        ))
        .map_err(|e| e.to_string())?
        .as_bytes(),
    );
    Ok(Location {
        root,
        target: target.to_path_buf(),
        directory,
        operation_id,
        fingerprint,
        relative_path,
    })
}
fn record_path(location: &Location, suffix: &str) -> PathBuf {
    location
        .directory
        .join(format!("{}.{}.json", location.operation_id, suffix))
}
fn checked_path(location: &Location, suffix: &str) -> Result<PathBuf, String> {
    let path = record_path(location, suffix);
    project_fs::validate_pending_mutation_path(&location.root.to_string_lossy(), &path)?;
    if fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("写回回执不能是符号链接".into());
    }
    Ok(path)
}
fn append_once<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    // A partial/corrupt claim is deliberately kept: losing liveness is safer than replay.
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("无法独占创建写回回执: {e}"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("无法持久化写回回执: {e}"))
}
fn current_state(location: &Location, intent: &Intent) -> Result<String, String> {
    project_fs::validate_pending_mutation_path(&location.root.to_string_lossy(), &location.target)?;
    match fs::read(&location.target) {
        Ok(bytes) => {
            let digest = hash(&bytes);
            Ok(if digest == intent.after_hash {
                "after"
            } else if intent.before_hash.as_ref() == Some(&digest) {
                "before"
            } else {
                "diverged"
            }
            .into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(if intent.before_hash.is_none() {
                "before"
            } else {
                "missing"
            }
            .into())
        }
        Err(error) => Err(format!("无法核对写回目标: {error}")),
    }
}
fn inspect(location: &Location) -> Result<Option<WritebackReceipt>, String> {
    let path = checked_path(location, "intent")?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("无法读取写回意图: {error}")),
    };
    let intent: Intent = serde_json::from_slice(&bytes)
        .map_err(|_| "写回意图损坏，结果未知，已禁止重复写入".to_string())?;
    if intent.schema_version != 1
        || intent.operation_id != location.operation_id
        || intent.fingerprint != location.fingerprint
        || intent.relative_path != location.relative_path
    {
        return Err("写回操作身份冲突，已拒绝同一操作 ID 的不同请求".into());
    }
    let outcome_path = checked_path(location, "outcome")?;
    let mut state = "outcome_unknown".to_string();
    let mut detail = None;
    let mut persisted = false;
    match fs::read(outcome_path) {
        Ok(bytes) => {
            let outcome: Outcome = serde_json::from_slice(&bytes)
                .map_err(|_| "写回结果回执损坏，结果未知，已禁止重复写入".to_string())?;
            if outcome.schema_version != 1
                || outcome.operation_id != intent.operation_id
                || outcome.fingerprint != intent.fingerprint
                || !["applied", "not_written"].contains(&outcome.state.as_str())
            {
                return Err("写回结果回执身份无效，已禁止重复写入".into());
            }
            state = outcome.state;
            detail = outcome.detail;
            persisted = true;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            detail = Some(format!("无法读取写回结果: {error}"));
        }
    }
    // 失效结果单独补记，原始正文 outcome 保持不可变；损坏补记不得掩盖原警告。
    if state == "applied"
        && detail
            .as_deref()
            .is_some_and(|value| value.starts_with(CANON_INVALIDATION_WARNING))
    {
        if let Ok(path) = checked_path(location, "canon-invalidation") {
            if let Ok(bytes) = fs::read(path) {
                if let Ok(repair) = serde_json::from_slice::<Outcome>(&bytes) {
                    if repair.schema_version == 1
                        && repair.operation_id == intent.operation_id
                        && repair.fingerprint == intent.fingerprint
                        && repair.state == "invalidated"
                    {
                        detail = None;
                    }
                }
            }
        }
    }
    let current = current_state(location, &intent).unwrap_or_else(|error| {
        detail = Some(error);
        "unreadable".into()
    });
    Ok(Some(WritebackReceipt {
        operation_id: intent.operation_id.clone(),
        state,
        current,
        checkpoint_timestamp: intent.checkpoint_timestamp,
        created_file: intent.before_hash.is_none(),
        receipt_persisted: persisted,
        detail,
    }))
}
#[tauri::command]
pub fn describe_writeback_operation(
    project_root: String,
    request: WritebackRequest,
) -> Result<WritebackIdentity, String> {
    let location = resolve(&project_root, &request)?;
    Ok(WritebackIdentity {
        relative_path: location.relative_path,
        operation_id: location.operation_id,
        fingerprint: location.fingerprint,
    })
}
#[tauri::command]
pub fn inspect_writeback_receipt(
    project_root: String,
    request: WritebackRequest,
) -> Result<Option<WritebackReceipt>, String> {
    inspect(&resolve(&project_root, &request)?)
}
pub fn write_file_with_receipt(
    project_root: String,
    request: WritebackRequest,
    expected: DiskBaseline,
    checkpoint_timestamp: Option<u64>,
) -> Result<WritebackReceipt, String> {
    apply_with(
        &project_root,
        &request,
        expected,
        checkpoint_timestamp,
        |expected| {
            project_fs::write_file_if_unchanged(
                project_root.clone(),
                request.path.clone(),
                request.content.clone(),
                expected,
            )
        },
    )
}
/// 正文派生的 canon 缓存白名单（D04 统一失效清单）。
/// proposals.json 刻意排除：那是 canon_delta 的待决提案草稿，不是正文派生。
const CANON_INVALIDATION_WARNING: &str = "canon 派生缓存未失效: ";
const CANON_DERIVED_INVALIDATION_NAMES: [&str; 4] = [
    "presence.json",
    "observations.json",
    "dossier.md",
    "report.json",
];

/// 写回成功后删除项目内 canon 正文派生缓存；缺失即 no-op。
/// 只删 canonical project root 内 `.storyforge/canon/derived/` 下的白名单文件，
/// 每个目标先过 containment 校验，杜绝借目录结构穿出项目。
fn invalidate_canon_derived_caches(root: &Path) -> Result<(), String> {
    let derived_dir = root.join(".storyforge").join("canon").join("derived");
    for name in CANON_DERIVED_INVALIDATION_NAMES {
        let target = derived_dir.join(name);
        let removal = match fs::symlink_metadata(&target) {
            Ok(_) => project_fs::validate_pending_mutation_path(&root.to_string_lossy(), &target)
                .and_then(|_| fs::remove_file(&target).map_err(|error| format!("无法删除 {name}: {error}"))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => Err(format!("无法检查 {name}: {error}")),
        };
        if let Err(error) = removal {
            // 并发清理可在路径校验或删除时移走文件；只凭重新核实的缺失收敛，
            // 不能把 Windows 的拒绝访问一律当成功，也不能绕过父目录围栏。
            project_fs::validate_pending_mutation_path(&root.to_string_lossy(), &derived_dir)?;
            if !matches!(fs::symlink_metadata(&target), Err(missing) if missing.kind() == std::io::ErrorKind::NotFound) {
                return Err(error);
            }
        }
    }
    Ok(())
}

// 仅修复已知 applied 的派生缓存，函数没有正文写回闭包。
fn repair_canon_invalidation(location: &Location, mut receipt: WritebackReceipt) -> WritebackReceipt {
    // 正文已有结果时绝不重放。只允许重试可弃缓存清理，并独立持久化补记。
    if receipt.state == "applied"
        && receipt
            .detail
            .as_deref()
            .is_some_and(|value| value.starts_with(CANON_INVALIDATION_WARNING))
    {
        let repair = invalidate_canon_derived_caches(&location.root).and_then(|()| {
            let outcome = Outcome {
                schema_version: 1,
                operation_id: location.operation_id.clone(),
                fingerprint: location.fingerprint.clone(),
                state: "invalidated".into(),
                detail: None,
            };
            // 这是可重复生成的缓存维护状态，不是正文 admission/outcome。
            // 原子替换允许修复中断的补记；并发同身份补记写入相同结果。
            let path = checked_path(location, "canon-invalidation")?;
            project_fs::write_file(
                location.root.to_string_lossy().into_owned(),
                path.to_string_lossy().into_owned(),
                serde_json::to_string(&outcome).map_err(|error| error.to_string())?,
            )
        });
        match repair {
            Ok(()) => receipt.detail = None,
            Err(error) => receipt.detail = Some(format!("{CANON_INVALIDATION_WARNING}{error}")),
        }
    }
    receipt
}

#[tauri::command]
pub fn repair_writeback_canon_cache(
    project_root: String,
    request: WritebackRequest,
) -> Result<WritebackReceipt, String> {
    let location = resolve(&project_root, &request)?;
    let receipt = inspect(&location)?.ok_or("未找到写回回执，不能修复缓存")?;
    if receipt.state != "applied" {
        return Err("正文写回结果未确认，不能修复缓存".into());
    }
    Ok(repair_canon_invalidation(&location, receipt))
}

fn apply_with(
    project_root: &str,
    request: &WritebackRequest,
    expected: DiskBaseline,
    checkpoint_timestamp: Option<u64>,
    write: impl FnOnce(DiskBaseline) -> Result<(), String>,
) -> Result<WritebackReceipt, String> {
    let location = resolve(project_root, request)?;
    if let Some(receipt) = inspect(&location)? {
        return Ok(repair_canon_invalidation(&location, receipt));
    }
    // Known validation/drift rejection happens before admission, with no unknown claim.
    project_fs::check_disk_baseline(&location.target, &expected)?;
    fs::create_dir_all(&location.directory).map_err(|e| format!("无法创建写回回执目录: {e}"))?;
    let intent_path = checked_path(&location, "intent")?;
    let intent = Intent {
        schema_version: 1,
        operation_id: location.operation_id.clone(),
        fingerprint: location.fingerprint.clone(),
        relative_path: location.relative_path.clone(),
        before_hash: match &expected {
            DiskBaseline::Missing {} => None,
            DiskBaseline::Content { content } => Some(hash(content.as_bytes())),
        },
        after_hash: hash(request.content.as_bytes()),
        checkpoint_timestamp,
    };
    if let Err(error) = append_once(&intent_path, &intent) {
        // Another process may own this identity. No contender gets to dispatch.
        return inspect(&location)?.ok_or(error);
    }
    #[cfg(feature = "gui-fixture")]
    crate::lifecycle_gui_fixture::at_boundary(project_root, "intent", Some(&intent.operation_id))?;
    let (state, mut detail) = match write(expected) {
        Ok(()) => ("applied", None),
        Err(error) => ("not_written", Some(error)),
    };
    #[cfg(feature = "gui-fixture")]
    if state == "applied" {
        crate::lifecycle_gui_fixture::at_boundary(
            project_root,
            "body",
            Some(&intent.operation_id),
        )?;
    }
    // D04：正文落盘成功后使 canon 派生缓存失效（可弃缓存，缺失即触发后端按需重建）。
    // proposals.json 不在此列——它承载 canon_delta 的待决提案草稿，不是正文派生。
    // 正文结果与缓存清理分别记账；失败必须警告，后端读取另有来源版本校验。
    if state == "applied" {
        if let Err(error) = invalidate_canon_derived_caches(&location.root) {
            detail = Some(format!("{CANON_INVALIDATION_WARNING}{error}"));
        }
    }
    let outcome = Outcome {
        schema_version: 1,
        operation_id: intent.operation_id.clone(),
        fingerprint: intent.fingerprint.clone(),
        state: state.into(),
        detail: detail.clone(),
    };
    let committed =
        checked_path(&location, "outcome").and_then(|path| append_once(&path, &outcome));
    let current = current_state(&location, &intent).unwrap_or_else(|error| {
        detail = Some(error);
        "unreadable".into()
    });
    Ok(WritebackReceipt {
        operation_id: intent.operation_id.clone(),
        state: state.into(),
        current,
        checkpoint_timestamp,
        created_file: intent.before_hash.is_none(),
        receipt_persisted: committed.is_ok(),
        detail: committed.err().or(detail),
    })
}
/// Create a fixed, receipt-keyed audit exclusively. Existing bytes are never replaced.
/// A retry flushes the existing file before the caller verifies its semantic envelope.
pub fn create_writeback_audit(
    project_root: String,
    operation_id: String,
    content: String,
) -> Result<(), String> {
    if operation_id.len() != 64
        || !operation_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("写回审计 operationId 无效".into());
    }
    let directory = Path::new(&project_root)
        .join(".storyforge")
        .join("author-loop");
    let root = project_fs::validate_pending_mutation_path(&project_root, &directory)?;
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建写回审计目录: {e}"))?;
    let target = directory.join(format!("{operation_id}.md"));
    project_fs::validate_pending_mutation_path(&root.to_string_lossy(), &target)?;
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(mut file) => {
            file.write_all(content.as_bytes())
                .map_err(|e| format!("写回审计记录未完成: {e}"))?;
            file
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if fs::symlink_metadata(&target)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("写回审计记录不能是符号链接".into());
            }
            // No truncate/create on the existing branch; partial records stay visible as errors.
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&target)
                .map_err(|e| format!("无法打开现有写回审计: {e}"))?
        }
        Err(error) => return Err(format!("无法独占创建写回审计: {error}")),
    };
    file.flush()
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("无法持久化写回审计: {e}"))
}

#[cfg(test)]
#[path = "fs_writeback_receipts_tests.rs"]
mod tests;
