//! 插件库：本机统一存放技能插件（只含文本的文件夹）。宿主只管库目录、从文件夹导入
//! （暂存 → 确认 / 丢弃）与移除；插件内容的解析归引擎。
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use walkdir::WalkDir;

const LIBRARY_DIR: &str = "plugins";
const STAGING_DIR: &str = ".staging";
const TRASH_DIR: &str = ".trash";
const CODEX_MANIFEST_DIR: &str = ".codex-plugin";
const TEXT_EXTENSIONS: [&str; 4] = ["md", "markdown", "txt", "json"];
const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FILES: usize = 300;
const MAX_DIR_DEPTH: usize = 8;
const MAX_SCAN_ENTRIES: usize = 5000;
const MAX_NAME_CHARS: usize = 40;
const FORBIDDEN_NAME_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

const REASON_NOT_TEXT: &str = "不是文本文件，StoryForge 不运行插件里的程序";
const REASON_TOO_LARGE: &str = "文件太大（超过 512 KB）";
const REASON_NOT_UTF8: &str = "不是 UTF-8 文本";
const REASON_BAD_FILE_NAME: &str = "文件名不是合法的 Unicode";
const REASON_LINK: &str = "链接或联接点，不跟随";

static STAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
// 开始暂存会清掉旧暂存、安装与移除都会挪目录：命令串行执行，免得两次导入互相清掉对方的副本。
static LIBRARY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StagedFile {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedImport {
    pub stage_id: String,
    pub stage_root: String,
    pub files: Vec<StagedFile>,
    pub skipped: Vec<SkippedFile>,
}

struct ScannedFile {
    path: String,
    content: Vec<u8>,
}

/// 插件名规则；TS 侧有一份同规则的实现（project-core 的 pluginNameProblem），两边要一起改。
pub(crate) fn validate_plugin_name(name: &str) -> Result<(), String> {
    let count = name.chars().count();
    if count == 0 {
        return Err("插件名不能为空".into());
    }
    if count > MAX_NAME_CHARS {
        return Err(format!(
            "插件名最多 {MAX_NAME_CHARS} 个字，现在有 {count} 个"
        ));
    }
    if name != name.trim() {
        return Err("插件名开头和结尾不能有空白".into());
    }
    if let Some(found) = name
        .chars()
        .find(|c| FORBIDDEN_NAME_CHARS.contains(c) || is_name_control(*c))
    {
        return Err(if is_name_control(found) {
            "插件名不能含有控制字符".into()
        } else {
            format!("插件名不能含有「{found}」（< > : \" / \\ | ? * 都不能用）")
        });
    }
    if name.starts_with('.') {
        return Err("插件名不能以「.」开头".into());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("插件名不能以「.」或空格结尾".into());
    }
    let stem = name.split('.').next().unwrap_or(name);
    if RESERVED_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return Err(format!("「{stem}」是 Windows 保留名，不能用作插件名"));
    }
    Ok(())
}

fn is_name_control(c: char) -> bool {
    c <= '\u{1F}' || c == '\u{7F}'
}

fn validate_stage_id(stage_id: &str) -> Result<(), String> {
    if stage_id.is_empty()
        || !stage_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("导入编号无效".into());
    }
    Ok(())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn new_stage_id(source: &Path) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(now.as_nanos().to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hasher.update(STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hasher.update(source.to_string_lossy().as_bytes());
    let suffix: String = hasher
        .finalize()
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{}-{suffix}", now.as_millis())
}

fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| format!("路径含有无法识别的字符：{}", path.display()))
}

fn is_ignored_dir_name(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    name == "node_modules" || (name.starts_with('.') && name != CODEX_MANIFEST_DIR)
}

fn relative_posix(source: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(source)
        .ok()?
        .components()
        .map(|component| component.as_os_str().to_str())
        .collect::<Option<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

fn lossy_relative(source: &Path, path: &Path) -> String {
    path.strip_prefix(source)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn has_text_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            TEXT_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn read_capped(path: &Path) -> io::Result<Vec<u8>> {
    let mut content = Vec::new();
    fs::File::open(path)?
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut content)?;
    Ok(content)
}

fn skip(skipped: &mut Vec<SkippedFile>, path: String, reason: &str) {
    skipped.push(SkippedFile {
        path,
        reason: reason.to_string(),
    });
}

// 只读、不落盘：任何上限超了都在复制之前整体报错。
fn scan_source(
    source: &Path,
    max_entries: usize,
) -> Result<(Vec<ScannedFile>, Vec<SkippedFile>), String> {
    let mut files: Vec<ScannedFile> = Vec::new();
    let mut skipped = Vec::new();
    let mut total_bytes: u64 = 0;
    let mut entries: usize = 0;
    let mut walker = WalkDir::new(source).follow_links(false).into_iter();
    while let Some(entry) = walker.next() {
        let entry = entry.map_err(|error| format!("读取插件文件夹失败：{error}"))?;
        if entry.depth() == 0 {
            continue;
        }
        entries += 1;
        if entries > max_entries {
            return Err(format!(
                "文件夹里的东西太多（超过 {max_entries} 项），请选插件自己的文件夹"
            ));
        }
        // Windows 上符号链接与联接点都报为 symlink；OneDrive 云文件等其他 reparse point 不算，照常读。
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            let path = relative_posix(source, entry.path())
                .unwrap_or_else(|| lossy_relative(source, entry.path()));
            skip(&mut skipped, path, REASON_LINK);
            continue;
        }
        if file_type.is_dir() {
            if is_ignored_dir_name(entry.file_name()) {
                walker.skip_current_dir();
                continue;
            }
            if entry.depth() > MAX_DIR_DEPTH {
                let location = relative_posix(source, entry.path())
                    .unwrap_or_else(|| entry.path().display().to_string());
                return Err(format!(
                    "文件夹层级超过 {MAX_DIR_DEPTH} 层（{location}），没有导入"
                ));
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(path) = relative_posix(source, entry.path()) else {
            skip(
                &mut skipped,
                lossy_relative(source, entry.path()),
                REASON_BAD_FILE_NAME,
            );
            continue;
        };
        if !has_text_extension(entry.path()) {
            skip(&mut skipped, path, REASON_NOT_TEXT);
            continue;
        }
        let size = entry
            .metadata()
            .map_err(|error| format!("读取「{path}」失败：{error}"))?
            .len();
        if size > MAX_FILE_BYTES {
            skip(&mut skipped, path, REASON_TOO_LARGE);
            continue;
        }
        let content =
            read_capped(entry.path()).map_err(|error| format!("读取「{path}」失败：{error}"))?;
        if content.len() as u64 > MAX_FILE_BYTES {
            skip(&mut skipped, path, REASON_TOO_LARGE);
            continue;
        }
        if std::str::from_utf8(&content).is_err() {
            skip(&mut skipped, path, REASON_NOT_UTF8);
            continue;
        }
        if files.len() >= MAX_FILES {
            return Err(format!("可导入的文本文件超过 {MAX_FILES} 个，没有导入"));
        }
        total_bytes += content.len() as u64;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err("可导入的文本文件合计超过 4 MB，没有导入".into());
        }
        files.push(ScannedFile { path, content });
    }
    if files.is_empty() {
        return Err("这个文件夹里没有可以导入的文本文件".into());
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    skipped.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((files, skipped))
}

fn write_stage(stage_root: &Path, files: &[ScannedFile]) -> Result<(), String> {
    fs::create_dir(stage_root).map_err(|error| format!("无法创建导入暂存目录：{error}"))?;
    for file in files {
        let target = file
            .path
            .split('/')
            .fold(stage_root.to_path_buf(), |path, part| path.join(part));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("复制「{}」到暂存失败：{error}", file.path))?;
        }
        fs::write(&target, &file.content)
            .map_err(|error| format!("复制「{}」到暂存失败：{error}", file.path))?;
    }
    Ok(())
}

fn remove_dir_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

fn move_to_trash(root: &Path, name: &str) -> Result<PathBuf, String> {
    let trash = root.join(TRASH_DIR);
    fs::create_dir_all(&trash).map_err(|error| format!("无法创建插件回收目录：{error}"))?;
    let mut stamp = now_millis();
    loop {
        let candidate = trash.join(format!("{name}-{stamp}"));
        match fs::symlink_metadata(&candidate) {
            Ok(_) => stamp += 1,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                fs::rename(root.join(name), &candidate)
                    .map_err(|error| format!("无法把「{name}」移进回收目录：{error}"))?;
                return Ok(candidate);
            }
            Err(error) => return Err(format!("无法检查插件回收目录：{error}")),
        }
    }
}

fn plugin_exists(root: &Path, name: &str) -> Result<bool, String> {
    match fs::symlink_metadata(root.join(name)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("无法检查插件「{name}」：{error}")),
    }
}

pub(crate) fn ensure_library_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("无法创建插件库目录：{error}"))
}

pub(crate) fn stage_import(root: &Path, source: &Path) -> Result<StagedImport, String> {
    stage_import_with_scan_limit(root, source, MAX_SCAN_ENTRIES)
}

fn stage_import_with_scan_limit(
    root: &Path,
    source: &Path,
    max_entries: usize,
) -> Result<StagedImport, String> {
    if !source.is_absolute() {
        return Err("要导入的文件夹必须是完整路径".into());
    }
    match fs::metadata(source) {
        Ok(info) if info.is_dir() => {}
        Ok(_) => return Err("要导入的不是文件夹".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err("要导入的文件夹不存在".into())
        }
        Err(error) => return Err(format!("无法读取要导入的文件夹：{error}")),
    }
    ensure_library_root(root)?;
    let canonical_source =
        fs::canonicalize(source).map_err(|error| format!("无法解析要导入的文件夹：{error}"))?;
    let canonical_root =
        fs::canonicalize(root).map_err(|error| format!("无法解析插件库目录：{error}"))?;
    if canonical_source.starts_with(&canonical_root) {
        return Err("不能从插件库里面导入插件".into());
    }
    if canonical_root.starts_with(&canonical_source) {
        return Err("不能导入包含插件库的文件夹".into());
    }

    let staging = root.join(STAGING_DIR);
    remove_dir_if_present(&staging)
        .map_err(|error| format!("无法清理上一次导入的暂存：{error}"))?;
    let (files, skipped) = scan_source(source, max_entries)?;
    fs::create_dir_all(&staging).map_err(|error| format!("无法创建导入暂存目录：{error}"))?;
    let stage_id = new_stage_id(source);
    let stage_root = staging.join(&stage_id);
    let stage_root_string = path_string(&stage_root)?;
    if let Err(error) = write_stage(&stage_root, &files) {
        let _ = remove_dir_if_present(&stage_root);
        return Err(error);
    }
    Ok(StagedImport {
        stage_id,
        stage_root: stage_root_string,
        files: files
            .iter()
            .map(|file| StagedFile {
                path: file.path.clone(),
                bytes: file.content.len() as u64,
            })
            .collect(),
        skipped,
    })
}

pub(crate) fn commit_import(root: &Path, stage_id: &str, name: &str) -> Result<String, String> {
    validate_stage_id(stage_id)?;
    let stage = root.join(STAGING_DIR).join(stage_id);
    match fs::symlink_metadata(&stage) {
        Ok(info) if info.is_dir() => {}
        Ok(_) => return Err("这次导入的暂存已经不在了，请重新导入".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err("这次导入的暂存已经不在了，请重新导入".into())
        }
        Err(error) => return Err(format!("无法读取导入暂存：{error}")),
    }
    validate_plugin_name(name)?;
    let target = root.join(name);
    let replaced = if plugin_exists(root, name)? {
        Some(move_to_trash(root, name)?)
    } else {
        None
    };
    if let Err(error) = fs::rename(&stage, &target) {
        if let Some(previous) = replaced {
            let _ = fs::rename(previous, &target);
        }
        return Err(format!("安装插件「{name}」失败：{error}"));
    }
    path_string(&target)
}

pub(crate) fn discard_import(root: &Path, stage_id: &str) -> Result<(), String> {
    validate_stage_id(stage_id)?;
    remove_dir_if_present(&root.join(STAGING_DIR).join(stage_id))
        .map_err(|error| format!("丢弃导入暂存失败：{error}"))
}

pub(crate) fn remove_plugin(root: &Path, name: &str) -> Result<(), String> {
    validate_plugin_name(name)?;
    if !plugin_exists(root, name)? {
        return Err(format!("插件库里没有「{name}」"));
    }
    move_to_trash(root, name).map(|_| ())
}

fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::runtime_paths::app_data_dir(app)
        .map(|dir| dir.join(LIBRARY_DIR))
        .map_err(|error| error.to_string())
}

async fn run_locked<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = LIBRARY_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        work()
    })
    .await
    .map_err(|error| format!("插件库后台任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn plugin_library_dir(app: AppHandle) -> Result<String, String> {
    let root = library_root(&app)?;
    run_locked(move || {
        ensure_library_root(&root)?;
        path_string(&root)
    })
    .await
}

#[tauri::command]
pub async fn plugin_stage_import(app: AppHandle, source: String) -> Result<StagedImport, String> {
    let root = library_root(&app)?;
    run_locked(move || stage_import(&root, Path::new(&source))).await
}

#[tauri::command]
pub async fn plugin_commit_import(
    app: AppHandle,
    stage_id: String,
    name: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    run_locked(move || commit_import(&root, &stage_id, &name)).await
}

#[tauri::command]
pub async fn plugin_discard_import(app: AppHandle, stage_id: String) -> Result<(), String> {
    let root = library_root(&app)?;
    run_locked(move || discard_import(&root, &stage_id)).await
}

#[tauri::command]
pub async fn plugin_remove(app: AppHandle, name: String) -> Result<(), String> {
    let root = library_root(&app)?;
    run_locked(move || remove_plugin(&root, &name)).await
}

#[cfg(test)]
#[path = "plugin_library_tests.rs"]
mod tests;
