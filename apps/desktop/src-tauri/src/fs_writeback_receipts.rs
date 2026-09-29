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
pub fn inspect_writeback_receipt(
    project_root: String,
    request: WritebackRequest,
) -> Result<Option<WritebackReceipt>, String> {
    inspect(&resolve(&project_root, &request)?)
}
#[tauri::command]
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
fn apply_with(
    project_root: &str,
    request: &WritebackRequest,
    expected: DiskBaseline,
    checkpoint_timestamp: Option<u64>,
    write: impl FnOnce(DiskBaseline) -> Result<(), String>,
) -> Result<WritebackReceipt, String> {
    let location = resolve(project_root, request)?;
    if let Some(receipt) = inspect(&location)? {
        return Ok(receipt);
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
    let (state, mut detail) = match write(expected) {
        Ok(()) => ("applied", None),
        Err(error) => ("not_written", Some(error)),
    };
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
#[tauri::command]
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
