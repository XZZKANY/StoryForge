//! 自动更新升级冒烟（`apps/desktop/scripts/verify-update-smoke.mjs`）：命令行带记录文件时，打开后照作者的点法
//! 走「设置 → 关于 → 检查更新 → 下载新版 → 重启安装」，每一步往记录文件追加一行 JSON。用命令行不用环境变量：
//! 安装器以当前用户身份重新打开新版（不继承环境），但插件会把旧进程的命令行原样转给它，新版再查应是「已是最新」。
//! 只在隔离测试身份里跑，正式标识的装机版绝不跑。
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

const PRODUCTION_IDENTIFIER: &str = "com.storyforge.ide";
const LOG_ARG: &str = "--storyforge-update-smoke-log=";
const DEADLINE: Duration = Duration::from_secs(300);

const STATE_SCRIPT: &str = r#"(() => ({
  button: document.querySelector('[data-testid="about-update-check"]')?.textContent ?? null,
  status: document.querySelector('[data-testid="about-update-status"]')?.textContent ?? '',
}))()"#;

const OPEN_SETTINGS_SCRIPT: &str = r#"(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }));
  return {};
})()"#;

fn record(log: &Path, version: &str, event: &str, detail: Value) {
    let line = json!({ "version": version, "event": event, "detail": detail });
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
    {
        let _ = writeln!(file, "{line}");
    }
}

pub fn start_if_requested<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(log) = std::env::args().find_map(|arg| arg.strip_prefix(LOG_ARG).map(PathBuf::from))
    else {
        return;
    };
    if app.config().identifier == PRODUCTION_IDENTIFIER {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let version = app.package_info().version.to_string();
    thread::spawn(move || {
        record(&log, &version, "started", Value::Null);
        let (event, detail) = match drive(&window, &log, &version) {
            Ok(outcome) => outcome,
            Err(error) => ("failed", json!(error)),
        };
        record(&log, &version, event, detail);
    });
}

fn drive<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    log: &Path,
    version: &str,
) -> Result<(&'static str, Value), String> {
    let started = Instant::now();
    let mut last = Value::Null;
    let mut announced = false;
    while started.elapsed() < DEADLINE {
        thread::sleep(Duration::from_millis(500));
        let Ok(state) = crate::eval_window_json(window, STATE_SCRIPT, Duration::from_millis(1500))
        else {
            continue;
        };
        let status = state["status"].as_str().unwrap_or_default();
        if ["检查失败", "下载失败", "没能开始安装"]
            .iter()
            .any(|prefix| status.starts_with(prefix))
        {
            return Err(status.to_string());
        }
        if status.starts_with("已是最新") {
            return Ok(("up-to-date", state));
        }
        match state["button"].as_str() {
            None => {
                let _ = crate::eval_window_json(
                    window,
                    OPEN_SETTINGS_SCRIPT,
                    Duration::from_millis(1500),
                );
            }
            Some("检查更新") if status.is_empty() => {
                let _ = crate::click_window_test_id(window, "about-update-check");
            }
            Some("下载新版") => {
                let _ = crate::click_window_test_id(window, "about-update-check");
            }
            Some("重启安装") => {
                // 点下去这个进程就会在退出握手后结束，先记下来；右下角提示挡住按钮时下一轮再点。
                if !announced {
                    record(log, version, "ready-to-restart", state.clone());
                    announced = true;
                }
                if crate::click_window_test_id(window, "about-update-check").is_ok() {
                    return Ok(("restart-clicked", Value::Null));
                }
            }
            _ => {}
        }
        last = state;
    }
    Err(format!("超时，最后状态：{last}"))
}
