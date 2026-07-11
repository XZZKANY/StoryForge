// 文件系统模块：提供本地文件操作 API。
//
// 前端统一 path helper 负责字符串级 containment；Rust 对项目读写再做
// canonicalize 真实路径校验，目录枚举也不会跟随 symlink。

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use walkdir::WalkDir;

/// 原子写临时文件序号：进程内单调递增，保证同目标并发写不撞临时名。
static ATOMIC_WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 文件条目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// 文件名
    pub name: String,
    /// 完整路径
    pub path: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 文件大小（字节）
    pub size: u64,
    /// 最后修改时间（Unix 时间戳）
    pub modified: i64,
    /// 文件扩展名
    pub extension: Option<String>,
}

/// 读取文件内容
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("无法读取文件 {}: {}", path, e))
}

/// 读取项目文件前解析真实路径，阻止项目内 symlink 指向项目外部文件。
#[tauri::command]
pub fn read_project_file(project_root: String, path: String) -> Result<String, String> {
    let root = fs::canonicalize(&project_root)
        .map_err(|e| format!("无法解析项目目录 {}: {}", project_root, e))?;
    let candidate =
        fs::canonicalize(&path).map_err(|e| format!("无法解析项目文件 {}: {}", path, e))?;
    if candidate == root || !candidate.starts_with(&root) {
        return Err(format!("文件不在当前项目内: {}", path));
    }
    if !candidate.is_file() {
        return Err(format!("路径不是项目文件: {}", path));
    }
    fs::read_to_string(&candidate).map_err(|e| format!("无法读取文件 {}: {}", path, e))
}

fn canonical_project_root(project_root: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(project_root)
        .map_err(|e| format!("无法解析项目目录 {}: {}", project_root, e))?;
    if !root.is_dir() {
        return Err(format!("项目根不是目录: {}", project_root));
    }
    Ok(root)
}

fn ensure_canonical_path_inside_project(
    root: &Path,
    candidate: &Path,
    original: &Path,
    allow_root: bool,
) -> Result<(), String> {
    if !candidate.starts_with(root) || (!allow_root && candidate == root) {
        return Err(format!("路径不在当前项目内: {}", original.display()));
    }
    Ok(())
}

fn canonicalize_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut ancestor = path;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| format!("路径没有可解析的父目录: {}", path.display()))?;
    }
    fs::canonicalize(ancestor)
        .map_err(|e| format!("无法解析路径 {}: {}", ancestor.display(), e))
}

fn validate_existing_mutation_path(project_root: &str, path: &Path) -> Result<(), String> {
    let root = canonical_project_root(project_root)?;
    let candidate = fs::canonicalize(path)
        .map_err(|e| format!("无法解析项目路径 {}: {}", path.display(), e))?;
    ensure_canonical_path_inside_project(&root, &candidate, path, false)
}

fn validate_pending_mutation_path(project_root: &str, path: &Path) -> Result<PathBuf, String> {
    let root = canonical_project_root(project_root)?;
    if path.exists() {
        let candidate = fs::canonicalize(path)
            .map_err(|e| format!("无法解析项目路径 {}: {}", path.display(), e))?;
        ensure_canonical_path_inside_project(&root, &candidate, path, false)?;
    } else {
        let ancestor = canonicalize_existing_ancestor(path)?;
        ensure_canonical_path_inside_project(&root, &ancestor, path, true)?;
    }
    Ok(root)
}

/// 写入文件内容（原子替换：先写同目录临时文件并 sync，再 rename 覆盖目标，
/// 崩溃/中断绝不会在目标文件留下截断内容）。
#[tauri::command]
pub fn write_file(project_root: String, path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    let root = validate_pending_mutation_path(&project_root, target)?;
    // 确保父目录存在
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("无法创建目录 {}: {}", parent.display(), e))?;
            let canonical_parent = fs::canonicalize(parent)
                .map_err(|e| format!("无法解析项目目录 {}: {}", parent.display(), e))?;
            ensure_canonical_path_inside_project(&root, &canonical_parent, parent, true)?;
        }
    }

    let staged = stage_atomic_write(target, content.as_bytes())
        .map_err(|e| format!("无法写入临时文件 {}: {}", path, e))?;
    // 原子替换目标；Windows 的 fs::rename 走 MOVEFILE_REPLACE_EXISTING、Unix 覆盖，二者均原子。
    if let Err(e) = fs::rename(&staged, target) {
        let _ = fs::remove_file(&staged);
        return Err(format!("无法写入文件 {}: {}", path, e));
    }
    Ok(())
}

/// 把内容写进目标同目录的临时文件并 sync 落盘，返回临时文件路径（尚未替换目标）。
/// 拆成独立步骤是为了让「暂存绝不改动目标」这一原子性不变量可被单测证伪。
fn stage_atomic_write(target: &Path, content: &[u8]) -> std::io::Result<PathBuf> {
    let dir = match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let stem = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("storyforge");
    let seq = ATOMIC_WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{}.tmp-{}-{}", stem, std::process::id(), seq));

    // write/sync 失败（磁盘满、配额）也要删掉刚建的临时文件，否则 .{name}.tmp-* 残渣会
    // 在目标目录堆积（此前只有 rename 失败分支清理）。闭包作用域结束即 drop file 句柄，
    // 再 remove——Windows 下删一个仍打开的文件会失败，故必须先关句柄。
    let write = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(content)?;
        file.sync_all()
    };
    if let Err(err) = write() {
        let _ = fs::remove_file(&tmp);
        return Err(err);
    }
    Ok(tmp)
}

/// 列出目录内容
#[tauri::command]
pub fn list_dir(path: String, recursive: bool) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!("路径不是目录: {}", path.display()));
    }

    let mut entries = Vec::new();

    if recursive {
        // 递归遍历
        for entry in WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if let Ok(file_entry) = create_file_entry(entry.path()) {
                entries.push(file_entry);
            }
        }
    } else {
        // 只列出直接子项
        for entry in fs::read_dir(path).map_err(|e| format!("无法读取目录: {}", e))? {
            let entry = entry.map_err(|e| format!("无法读取目录条目: {}", e))?;
            if let Ok(file_entry) = create_file_entry(&entry.path()) {
                entries.push(file_entry);
            }
        }
    }

    // 按名称排序：目录在前，文件在后
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// 删除文件或目录
#[tauri::command]
pub fn delete_path(project_root: String, path: String, recursive: bool) -> Result<(), String> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }
    validate_existing_mutation_path(&project_root, path)?;

    if path.is_dir() {
        if recursive {
            fs::remove_dir_all(path).map_err(|e| format!("无法删除目录: {}", e))
        } else {
            fs::remove_dir(path).map_err(|e| format!("无法删除目录（非空）: {}", e))
        }
    } else {
        fs::remove_file(path).map_err(|e| format!("无法删除文件: {}", e))
    }
}

/// 创建目录
#[tauri::command]
pub fn create_dir(project_root: String, path: String, recursive: bool) -> Result<(), String> {
    let root = validate_pending_mutation_path(&project_root, Path::new(&path))?;
    if recursive {
        fs::create_dir_all(&path)
    } else {
        fs::create_dir(&path)
    }
    .map_err(|e| format!("无法创建目录 {}: {}", path, e))?;
    let canonical = fs::canonicalize(&path)
        .map_err(|e| format!("无法解析项目目录 {}: {}", path, e))?;
    ensure_canonical_path_inside_project(&root, &canonical, Path::new(&path), false)
}

/// 重命名/移动文件或目录
#[tauri::command]
pub fn rename_path(project_root: String, from: String, to: String) -> Result<(), String> {
    validate_existing_mutation_path(&project_root, Path::new(&from))?;
    validate_pending_mutation_path(&project_root, Path::new(&to))?;
    fs::rename(&from, &to).map_err(|e| format!("无法重命名 {} -> {}: {}", from, to, e))
}

/// 检查路径是否存在
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 获取文件信息
#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileEntry, String> {
    create_file_entry(Path::new(&path))
}

// ==================== 辅助函数 ====================

/// 从路径创建 FileEntry
fn create_file_entry(path: &Path) -> Result<FileEntry, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("无法读取文件元数据: {}", e))?;
    if metadata.file_type().is_symlink() {
        return Err("符号链接不纳入项目文件索引".to_string());
    }

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let path_str = path.to_string_lossy().to_string();

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_string());

    Ok(FileEntry {
        name,
        path: path_str,
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified,
        extension,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "storyforge-desktop-fs-{}-{}-{}",
                name,
                std::process::id(),
                unique
            ));
            fs::create_dir_all(&path).expect("temp dir should be created");
            Self { path }
        }

        fn join(&self, relative: &str) -> String {
            self.path.join(relative).to_string_lossy().to_string()
        }

        fn root(&self) -> String {
            self.path.to_string_lossy().to_string()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn write_file_creates_parent_dirs_and_read_file_returns_content() {
        let temp = TempDir::new("read-write");
        let file_path = temp.join("chapters/chapter-001.md");

        write_file(
            temp.root(),
            file_path.clone(),
            "# Chapter 1\n\nOpening.".to_string(),
        )
            .expect("write should succeed");

        let content = read_file(file_path).expect("read should succeed");
        assert_eq!(content, "# Chapter 1\n\nOpening.");
    }

    #[test]
    fn write_file_rejects_project_external_paths() {
        let project = TempDir::new("project-write-root");
        let outside = TempDir::new("project-write-outside");
        let outside_file = outside.join("escaped.md");

        let error = write_file(
            project.root(),
            outside_file.clone(),
            "must not escape".to_string(),
        )
        .expect_err("external write must be rejected");

        assert!(error.contains("路径不在当前项目内"));
        assert!(!Path::new(&outside_file).exists());
    }

    #[test]
    fn write_file_does_not_follow_symlinked_parent_outside_project() {
        let project = TempDir::new("project-write-symlink-root");
        let outside = TempDir::new("project-write-symlink-outside");
        let link = project.path.join("linked-dir");

        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&outside.path, &link);
        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_dir(&outside.path, &link);
        if link_result.is_err() {
            return;
        }

        let escaped_file = link.join("escaped.md");
        let error = write_file(
            project.root(),
            escaped_file.to_string_lossy().to_string(),
            "must not escape".to_string(),
        )
        .expect_err("symlinked parent write must be rejected");

        assert!(error.contains("路径不在当前项目内"));
        assert!(!outside.path.join("escaped.md").exists());
    }

    #[test]
    fn create_dir_rejects_project_external_paths() {
        let project = TempDir::new("project-create-root");
        let outside = TempDir::new("project-create-outside");
        let outside_dir = outside.path.join("escaped-dir");

        let error = create_dir(
            project.root(),
            outside_dir.to_string_lossy().to_string(),
            true,
        )
        .expect_err("external directory creation must be rejected");

        assert!(error.contains("路径不在当前项目内"));
        assert!(!outside_dir.exists());
    }

    #[test]
    fn delete_path_rejects_external_paths_and_project_root() {
        let project = TempDir::new("project-delete-root");
        let outside = TempDir::new("project-delete-outside");
        let outside_file = outside.path.join("keep.md");
        fs::write(&outside_file, "keep").expect("outside file should exist");

        let external_error = delete_path(
            project.root(),
            outside_file.to_string_lossy().to_string(),
            false,
        )
        .expect_err("external delete must be rejected");
        let root_error = delete_path(project.root(), project.root(), true)
            .expect_err("project root delete must be rejected");

        assert!(external_error.contains("路径不在当前项目内"));
        assert!(root_error.contains("路径不在当前项目内"));
        assert!(outside_file.exists());
        assert!(project.path.exists());
    }

    #[test]
    fn rename_path_rejects_moving_a_project_file_outside() {
        let project = TempDir::new("project-rename-root");
        let outside = TempDir::new("project-rename-outside");
        let source = project.join("chapter.md");
        let destination = outside.join("escaped.md");
        write_file(project.root(), source.clone(), "keep inside".to_string())
            .expect("source should exist");

        let error = rename_path(project.root(), source.clone(), destination.clone())
            .expect_err("rename destination outside project must be rejected");

        assert!(error.contains("路径不在当前项目内"));
        assert!(Path::new(&source).exists());
        assert!(!Path::new(&destination).exists());
    }

    #[test]
    fn read_project_file_rejects_project_external_paths() {
        let project = TempDir::new("project-read-root");
        let outside = TempDir::new("project-read-outside");
        let outside_file = outside.join("secret.md");
        write_file(outside.root(), outside_file.clone(), "secret".to_string())
            .expect("outside file should exist");

        let error = read_project_file(project.path.to_string_lossy().to_string(), outside_file)
            .expect_err("external file must be rejected");

        assert!(error.contains("文件不在当前项目内"));
    }

    #[test]
    fn read_project_file_does_not_follow_symlink_escape() {
        let project = TempDir::new("project-symlink-read-root");
        let outside = TempDir::new("project-symlink-read-outside");
        let outside_file = outside.path.join("secret.md");
        fs::write(&outside_file, "secret").expect("outside file should exist");
        let link = project.path.join("linked-secret.md");

        #[cfg(unix)]
        let link_result = std::os::unix::fs::symlink(&outside_file, &link);
        #[cfg(windows)]
        let link_result = std::os::windows::fs::symlink_file(&outside_file, &link);
        if link_result.is_err() {
            return;
        }

        let error = read_project_file(
            project.path.to_string_lossy().to_string(),
            link.to_string_lossy().to_string(),
        )
        .expect_err("symlink escape must be rejected");

        assert!(error.contains("文件不在当前项目内"));
    }

    #[test]
    fn write_file_stages_out_of_place_so_target_is_replaced_atomically() {
        let temp = TempDir::new("atomic-stage");
        let file_path = temp.join("chapter.md");
        write_file(temp.root(), file_path.clone(), "committed-v1".to_string())
            .expect("seed write should succeed");

        // 暂存新内容到同目录临时文件，但尚未 rename：目标必须仍是旧内容（绝不原地截断）。
        let target = Path::new(&file_path);
        let staged = stage_atomic_write(target, b"pending-v2").expect("stage should succeed");
        assert!(staged.exists(), "临时文件应已写好");
        assert_ne!(staged, target.to_path_buf(), "临时文件不能就是目标本身");
        assert_eq!(
            read_file(file_path.clone()).expect("target should stay readable"),
            "committed-v1",
            "暂存阶段绝不能改动目标文件（原子性不变量）"
        );
        assert_eq!(
            fs::read_to_string(&staged).expect("staged file should be readable"),
            "pending-v2"
        );
        let _ = fs::remove_file(&staged);
    }

    #[test]
    fn write_file_overwrites_content_and_leaves_no_temp_residue() {
        let temp = TempDir::new("atomic-commit");
        let file_path = temp.join("chapter.md");
        write_file(temp.root(), file_path.clone(), "v1".to_string())
            .expect("first write should succeed");
        write_file(temp.root(), file_path.clone(), "v2-longer-body".to_string())
            .expect("overwrite should succeed");

        assert_eq!(
            read_file(file_path).expect("read should succeed"),
            "v2-longer-body"
        );
        // rename 提交后临时文件必须已被消费，目录里不留 .tmp 残渣。
        let residue: Vec<String> = fs::read_dir(&temp.path)
            .expect("dir listing should succeed")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp-"))
            .collect();
        assert!(residue.is_empty(), "提交后不应残留临时文件: {:?}", residue);
    }

    #[test]
    fn list_dir_orders_directories_before_files_and_sorts_by_name() {
        let temp = TempDir::new("list-dir");
        create_dir(temp.root(), temp.join("b-dir"), true).expect("b-dir should be created");
        create_dir(temp.root(), temp.join("a-dir"), true).expect("a-dir should be created");
        write_file(temp.root(), temp.join("b.md"), "b".to_string())
            .expect("b.md should be written");
        write_file(temp.root(), temp.join("a.md"), "a".to_string())
            .expect("a.md should be written");

        let entries = list_dir(temp.path.to_string_lossy().to_string(), false)
            .expect("list_dir should succeed");
        let names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();

        assert_eq!(names, vec!["a-dir", "b-dir", "a.md", "b.md"]);
    }

    #[test]
    fn recursive_list_dir_includes_nested_files() {
        let temp = TempDir::new("recursive-list");
        write_file(
            temp.root(),
            temp.join("drafts/arc/chapter-002.md"),
            "nested".to_string(),
        )
            .expect("nested file should be written");

        let entries = list_dir(temp.path.to_string_lossy().to_string(), true)
            .expect("recursive list_dir should succeed");

        assert!(entries.iter().any(|entry| entry.name == "chapter-002.md"));
    }

    #[test]
    fn rename_path_moves_file_and_path_exists_tracks_it() {
        let temp = TempDir::new("rename");
        let from = temp.join("old.md");
        let to = temp.join("new.md");
        write_file(temp.root(), from.clone(), "draft".to_string())
            .expect("source file should be written");

        rename_path(temp.root(), from.clone(), to.clone()).expect("rename should succeed");

        assert!(!path_exists(from));
        assert!(path_exists(to.clone()));
        assert_eq!(
            read_file(to).expect("renamed file should be readable"),
            "draft"
        );
    }

    #[test]
    fn delete_path_removes_files_and_recursive_dirs() {
        let temp = TempDir::new("delete");
        let file_path = temp.join("delete-me.md");
        let dir_path = temp.join("folder");
        write_file(temp.root(), file_path.clone(), "temporary".to_string())
            .expect("file should be written");
        write_file(
            temp.root(),
            temp.join("folder/nested.md"),
            "nested".to_string(),
        )
            .expect("nested file should be written");

        delete_path(temp.root(), file_path.clone(), false).expect("file delete should succeed");
        delete_path(temp.root(), dir_path.clone(), true)
            .expect("recursive dir delete should succeed");

        assert!(!path_exists(file_path));
        assert!(!path_exists(dir_path));
    }

    #[test]
    fn get_file_info_reports_file_metadata() {
        let temp = TempDir::new("file-info");
        let file_path = temp.join("chapter.markdown");
        write_file(temp.root(), file_path.clone(), "hello".to_string())
            .expect("file should be written");

        let info = get_file_info(file_path.clone()).expect("file info should be available");

        assert_eq!(info.name, "chapter.markdown");
        assert_eq!(info.path, file_path);
        assert!(!info.is_dir);
        assert_eq!(info.size, 5);
        assert_eq!(info.extension, Some("markdown".to_string()));
    }

    #[test]
    fn list_dir_rejects_missing_paths_and_files() {
        let temp = TempDir::new("list-errors");
        let file_path = temp.join("not-a-dir.md");
        write_file(temp.root(), file_path.clone(), "file".to_string())
            .expect("file should be written");

        assert!(list_dir(temp.join("missing"), false)
            .expect_err("missing path should fail")
            .contains("路径不存在"));
        assert!(list_dir(file_path, false)
            .expect_err("file path should fail")
            .contains("路径不是目录"));
    }

    #[test]
    fn list_dir_does_not_follow_symlink_entries() {
        let temp = TempDir::new("symlink-skip");
        let outside = TempDir::new("symlink-outside");
        let outside_file = outside.path.join("secret.md");
        fs::write(&outside_file, "external secret").expect("outside file should be written");
        let link_path = temp.path.join("linked-secret.md");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside_file, &link_path)
                .expect("symlink should be created");
        }
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_file(&outside_file, &link_path).is_err() {
                // Windows symlink creation can require Developer Mode or elevated privileges.
                return;
            }
        }

        let entries = list_dir(temp.path.to_string_lossy().to_string(), true)
            .expect("recursive list should succeed");

        assert!(
            entries.iter().all(|entry| entry.name != "linked-secret.md"),
            "project index must not expose symlink targets"
        );
    }
}
