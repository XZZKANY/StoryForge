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
