// 文件系统模块：提供本地文件操作 API

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

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
    fs::read_to_string(&path)
        .map_err(|e| format!("无法读取文件 {}: {}", path, e))
}

/// 写入文件内容
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    // 确保父目录存在
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建目录 {}: {}", parent.display(), e))?;
    }

    fs::write(&path, content)
        .map_err(|e| format!("无法写入文件 {}: {}", path, e))
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
        for entry in fs::read_dir(path)
            .map_err(|e| format!("无法读取目录: {}", e))?
        {
            let entry = entry.map_err(|e| format!("无法读取目录条目: {}", e))?;
            if let Ok(file_entry) = create_file_entry(&entry.path()) {
                entries.push(file_entry);
            }
        }
    }

    // 按名称排序：目录在前，文件在后
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// 删除文件或目录
#[tauri::command]
pub fn delete_path(path: String, recursive: bool) -> Result<(), String> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err(format!("路径不存在: {}", path.display()));
    }

    if path.is_dir() {
        if recursive {
            fs::remove_dir_all(path)
                .map_err(|e| format!("无法删除目录: {}", e))
        } else {
            fs::remove_dir(path)
                .map_err(|e| format!("无法删除目录（非空）: {}", e))
        }
    } else {
        fs::remove_file(path)
            .map_err(|e| format!("无法删除文件: {}", e))
    }
}

/// 创建目录
#[tauri::command]
pub fn create_dir(path: String, recursive: bool) -> Result<(), String> {
    if recursive {
        fs::create_dir_all(&path)
    } else {
        fs::create_dir(&path)
    }
    .map_err(|e| format!("无法创建目录 {}: {}", path, e))
}

/// 重命名/移动文件或目录
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to)
        .map_err(|e| format!("无法重命名 {} -> {}: {}", from, to, e))
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
    let metadata = fs::metadata(path)
        .map_err(|e| format!("无法读取文件元数据: {}", e))?;

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

        write_file(file_path.clone(), "# Chapter 1\n\nOpening.".to_string())
            .expect("write should succeed");

        let content = read_file(file_path).expect("read should succeed");
        assert_eq!(content, "# Chapter 1\n\nOpening.");
    }

    #[test]
    fn list_dir_orders_directories_before_files_and_sorts_by_name() {
        let temp = TempDir::new("list-dir");
        create_dir(temp.join("b-dir"), true).expect("b-dir should be created");
        create_dir(temp.join("a-dir"), true).expect("a-dir should be created");
        write_file(temp.join("b.md"), "b".to_string()).expect("b.md should be written");
        write_file(temp.join("a.md"), "a".to_string()).expect("a.md should be written");

        let entries = list_dir(temp.path.to_string_lossy().to_string(), false)
            .expect("list_dir should succeed");
        let names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();

        assert_eq!(names, vec!["a-dir", "b-dir", "a.md", "b.md"]);
    }

    #[test]
    fn recursive_list_dir_includes_nested_files() {
        let temp = TempDir::new("recursive-list");
        write_file(temp.join("drafts/arc/chapter-002.md"), "nested".to_string())
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
        write_file(from.clone(), "draft".to_string()).expect("source file should be written");

        rename_path(from.clone(), to.clone()).expect("rename should succeed");

        assert!(!path_exists(from));
        assert!(path_exists(to.clone()));
        assert_eq!(read_file(to).expect("renamed file should be readable"), "draft");
    }

    #[test]
    fn delete_path_removes_files_and_recursive_dirs() {
        let temp = TempDir::new("delete");
        let file_path = temp.join("delete-me.md");
        let dir_path = temp.join("folder");
        write_file(file_path.clone(), "temporary".to_string()).expect("file should be written");
        write_file(temp.join("folder/nested.md"), "nested".to_string())
            .expect("nested file should be written");

        delete_path(file_path.clone(), false).expect("file delete should succeed");
        delete_path(dir_path.clone(), true).expect("recursive dir delete should succeed");

        assert!(!path_exists(file_path));
        assert!(!path_exists(dir_path));
    }

    #[test]
    fn get_file_info_reports_file_metadata() {
        let temp = TempDir::new("file-info");
        let file_path = temp.join("chapter.markdown");
        write_file(file_path.clone(), "hello".to_string()).expect("file should be written");

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
        write_file(file_path.clone(), "file".to_string()).expect("file should be written");

        assert!(list_dir(temp.join("missing"), false)
            .expect_err("missing path should fail")
            .contains("路径不存在"));
        assert!(list_dir(file_path, false)
            .expect_err("file path should fail")
            .contains("路径不是目录"));
    }
}
