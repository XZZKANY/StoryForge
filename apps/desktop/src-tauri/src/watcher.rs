// 文件监听模块：监听文件变化并通知前端

use anyhow::Result;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

/// 文件变化事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    /// 事件类型：created, modified, removed
    pub kind: String,
    /// 变化的文件路径
    pub paths: Vec<String>,
}

/// 全局文件监听器管理器
pub struct WatcherManager {
    watchers: Arc<Mutex<Vec<RecommendedWatcher>>>,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// 添加文件监听
    pub fn watch_path(&self, path: String, app_handle: AppHandle) -> Result<(), String> {
        let (tx, rx) = channel();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("无法创建文件监听器: {}", e))?;

        watcher
            .watch(Path::new(&path), RecursiveMode::Recursive)
            .map_err(|e| format!("无法监听路径 {}: {}", path, e))?;

        // 保存监听器引用
        self.watchers.lock().unwrap().push(watcher);

        // 启动事件处理线程
        thread::spawn(move || {
            while let Ok(event) = rx.recv() {
                let change_event = convert_event(event);
                // 发送事件到前端
                let _ = app_handle.emit("file-change", change_event);
            }
        });

        Ok(())
    }

    /// 停止所有监听
    pub fn stop_all(&self) {
        let mut watchers = self.watchers.lock().unwrap();
        watchers.clear();
    }
}

/// 启动文件监听
#[tauri::command]
pub fn watch_file(path: String, app_handle: AppHandle) -> Result<(), String> {
    let manager = app_handle.state::<WatcherManager>();
    manager.watch_path(path, app_handle.clone())
}

/// 停止所有文件监听
#[tauri::command]
pub fn stop_watching(app_handle: AppHandle) -> Result<(), String> {
    let manager = app_handle.state::<WatcherManager>();
    manager.stop_all();
    Ok(())
}

// ==================== 辅助函数 ====================

/// 将 notify::Event 转换为 FileChangeEvent
fn convert_event(event: Event) -> FileChangeEvent {
    let kind = match event.kind {
        notify::EventKind::Create(_) => "created",
        notify::EventKind::Modify(_) => "modified",
        notify::EventKind::Remove(_) => "removed",
        _ => "unknown",
    }
    .to_string();

    let paths = event
        .paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    FileChangeEvent { kind, paths }
}
