use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn publish_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .context("无法获取应用配置目录")?
        .join("publish");
    fs::create_dir_all(&dir).context("无法创建 publish 数据目录")?;
    Ok(dir)
}

fn resolve_under_publish(app: &AppHandle, relative: &str) -> Result<PathBuf> {
    let root = publish_dir(app)?;
    let cleaned = relative.replace('\\', "/");
    if cleaned.is_empty()
        || cleaned.starts_with('/')
        || cleaned.contains("..")
        || Path::new(&cleaned).is_absolute()
    {
        anyhow::bail!("非法 publish 相对路径");
    }
    let target = root.join(&cleaned);
    let canonical_root = fs::canonicalize(&root).unwrap_or(root.clone());
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).context("无法创建 publish 子目录")?;
    }
    if target.exists() {
        let canonical_target =
            fs::canonicalize(&target).context("无法解析 publish 目标路径")?;
        if !canonical_target.starts_with(&canonical_root) {
            anyhow::bail!("publish 路径越界");
        }
        return Ok(canonical_target);
    }
    // 新文件：校验父目录
    if let Ok(parent) = target.parent().map(|p| fs::canonicalize(p)).transpose() {
        if let Some(parent) = parent {
            if !parent.starts_with(&canonical_root) {
                anyhow::bail!("publish 路径越界");
            }
        }
    }
    Ok(target)
}

#[tauri::command]
pub fn get_publish_data_dir(app: AppHandle) -> Result<String, String> {
    publish_dir(&app)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_publish_file(app: AppHandle, relative_path: String) -> Result<String, String> {
    let path = resolve_under_publish(&app, &relative_path).map_err(|e| e.to_string())?;
    if !path.exists() {
        return Err(format!("文件不存在: {}", relative_path));
    }
    fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}

#[tauri::command]
pub fn write_publish_file(
    app: AppHandle,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let path = resolve_under_publish(&app, &relative_path).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("写入失败: {}", e))
}

#[tauri::command]
pub fn publish_file_exists(app: AppHandle, relative_path: String) -> Result<bool, String> {
    let path = resolve_under_publish(&app, &relative_path).map_err(|e| e.to_string())?;
    Ok(path.exists())
}
