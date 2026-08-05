// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs;
mod llm_config;
mod runtime_paths;
mod shadow_git;
mod watcher;

use anyhow::{Context, Result};
use runtime_paths::is_smoke_mode;
use serde::{Deserialize, Serialize};
use std::fs as std_fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

type SharedServiceManager = Arc<Mutex<ServiceManager>>;
static SMOKE_PROJECT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 全局状态：保存所有启动的子进程，用于退出时清理
struct ServiceManager {
    children: Vec<Child>,
    sidecars: Vec<ManagedSidecar>,
}

struct ManagedSidecar {
    child: CommandChild,
    terminated: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiConfig {
    base_url: String,
    api_key: String,
}

impl ServiceManager {
    fn new() -> Self {
        Self {
            children: Vec::new(),
            sidecars: Vec::new(),
        }
    }

    fn add_sidecar(&mut self, child: CommandChild, terminated: Arc<AtomicBool>) {
        self.sidecars.push(ManagedSidecar { child, terminated });
    }

    fn shutdown(&mut self) {
        println!("正在停止所有服务...");
        for mut child in self.children.drain(..) {
            match child.try_wait() {
                Ok(Some(_)) => continue,
                Ok(None) if cfg!(windows) => {
                    if !kill_windows_process_tree(child.id()) {
                        let _ = child.kill();
                    }
                }
                Ok(None) => {
                    if let Err(error) = child.kill() {
                        eprintln!("停止进程失败: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("读取受管进程状态失败，仍将通过进程句柄停止: {error}");
                    let _ = child.kill();
                }
            }
        }
        for managed in self.sidecars.drain(..) {
            let child = managed.child;
            if cfg!(windows)
                && !managed.terminated.load(Ordering::Acquire)
                && kill_windows_process_tree(child.pid())
            {
                continue;
            }
            if let Err(error) = child.kill() {
                eprintln!("停止 sidecar 失败: {error}");
            }
        }
        println!("所有服务已停止");
    }
}

fn kill_windows_process_tree(pid: u32) -> bool {
    if !cfg!(windows) {
        return false;
    }
    matches!(
        Command::new("taskkill.exe")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
        Ok(status) if status.success()
    )
}

fn shutdown_managed_services(manager: &SharedServiceManager) {
    let mut services = match manager.lock() {
        Ok(services) => services,
        Err(poisoned) => {
            eprintln!("服务管理器锁已损坏，仍将尝试停止受管服务");
            poisoned.into_inner()
        }
    };
    services.shutdown();
}

/// 启动并等待 Docker Compose 服务
fn is_api_ready(base_url: &str) -> bool {
    reqwest::blocking::get(format!("{}/health/ready", base_url.trim_end_matches('/')))
        .map(|resp| resp.status().is_success())
        .unwrap_or(false)
}

/// 读 /health/ready 的 app_version：用于覆盖安装后判断在跑的是不是旧孤儿 sidecar（W1）。
fn fetch_api_version(base_url: &str) -> Option<String> {
    let resp =
        reqwest::blocking::get(format!("{}/health/ready", base_url.trim_end_matches('/'))).ok()?;
    if !resp.status().is_success() {
        return None;
    }
    // reqwest 未启用 json feature，直接取文本用 serde_json 解析，避免动 Cargo 依赖。
    let text = resp.text().ok()?;
    let body: serde_json::Value = serde_json::from_str(&text).ok()?;
    body.get("app_version")
        .and_then(|value: &serde_json::Value| value.as_str())
        .map(|value: &str| value.to_string())
}

/// 按端口杀掉占用者（Windows netstat 定位 PID → taskkill /F）。用于强杀旧版本孤儿 sidecar，
/// 再由正常 spawn 流程拉起当前版本。非 Windows 走 lsof + kill。
fn kill_process_on_port(port: u16) {
    #[cfg(windows)]
    {
        let output = Command::new("netstat").args(["-ano", "-p", "tcp"]).output();
        let Ok(output) = output else {
            eprintln!("netstat 执行失败，无法定位端口 {} 的孤儿进程", port);
            return;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let needle = format!(":{}", port);
        let mut pids: Vec<String> = Vec::new();
        for line in stdout.lines() {
            if !line.contains("LISTENING") || !line.contains(&needle) {
                continue;
            }
            if let Some(pid) = line.split_whitespace().last() {
                if pid.chars().all(|c| c.is_ascii_digit()) && !pids.contains(&pid.to_string()) {
                    pids.push(pid.to_string());
                }
            }
        }
        for pid in pids {
            println!("强杀端口 {} 上的旧 sidecar 进程 PID={}", port, pid);
            let _ = Command::new("taskkill").args(["/F", "/PID", &pid]).output();
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-t", &format!("-i:{}", port)])
            .output()
        {
            for pid in String::from_utf8_lossy(&output.stdout).split_whitespace() {
                println!("强杀端口 {} 上的旧 sidecar 进程 PID={}", port, pid);
                let _ = Command::new("kill").args(["-9", pid]).output();
            }
        }
    }
}

fn desktop_api_base_url() -> String {
    std::env::var("STORYFORGE_API_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8000".to_string())
}

fn desktop_api_port(base_url: &str) -> u16 {
    base_url
        .rsplit_once(':')
        .and_then(|(_, port)| port.trim_end_matches('/').parse::<u16>().ok())
        .unwrap_or(8000)
}

fn backend_env(
    app: &tauri::AppHandle,
    api_base_url: &str,
) -> Result<Vec<(String, String)>> {
    let mut env = vec![
        ("STORYFORGE_API_HOST".to_string(), "127.0.0.1".to_string()),
        (
            "STORYFORGE_API_PORT".to_string(),
            desktop_api_port(api_base_url).to_string(),
        ),
        (
            "STORYFORGE_DESKTOP_SKIP_SERVICES".to_string(),
            "1".to_string(),
        ),
        ("STORYFORGE_ENV".to_string(), "local".to_string()),
        (
            "DATABASE_URL".to_string(),
            llm_config::sqlite_database_url(app)?,
        ),
    ];
    env.extend(llm_config::llm_env_for_backend(app)?);
    Ok(env)
}

fn spawn_api_sidecar(
    app: &tauri::AppHandle,
    api_base_url: &str,
    manager: &Arc<Mutex<ServiceManager>>,
) -> Result<()> {
    let sidecar_name = "storyforge-api";
    let mut command = app
        .shell()
        .sidecar(sidecar_name)
        .context("无法构建 API sidecar 命令")?;

    for (key, value) in backend_env(app, api_base_url)? {
        command = command.env(key, value);
    }

    let (mut rx, child) = command.spawn().context("启动 API sidecar 失败")?;
    let terminated = Arc::new(AtomicBool::new(false));
    manager
        .lock()
        .unwrap()
        .add_sidecar(child, Arc::clone(&terminated));
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[api-sidecar] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[api-sidecar] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(err) => {
                    eprintln!("[api-sidecar] error: {}", err);
                }
                CommandEvent::Terminated(payload) => {
                    terminated.store(true, Ordering::Release);
                    println!("[api-sidecar] terminated: {:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// 启动 FastAPI 服务：拉起 sidecar 进程（快）。wait_ready=true 时同步等待就绪；
/// 正常启动传 false，就绪由调用方在后台线程等待，避免阻塞窗口首帧（#3 启动慢）。
fn start_api_server(
    app: &tauri::AppHandle,
    manager: &Arc<Mutex<ServiceManager>>,
    wait_ready: bool,
) -> Result<()> {
    let api_base_url = desktop_api_base_url();
    if is_api_ready(&api_base_url) {
        if is_smoke_mode() {
            anyhow::bail!(
                "Smoke API 地址已被占用，拒绝复用或终止现有进程: {}",
                api_base_url
            );
        }
        // 端口上已有 API：可能是覆盖安装遗留的旧版本孤儿，也可能是上次崩溃/被强杀未清理
        // 留下的**同版本**孤儿 sidecar（W1 握手，决策=taskkill+respawn）。
        let expected_version = app.package_info().version.to_string();
        let running_version = fetch_api_version(&api_base_url);
        let version_matches = running_version
            .as_deref()
            .map(|value| value == expected_version)
            .unwrap_or(false);
        // 桌面模式必须用自带 sidecar 注入 BYO-key LLM 配置，故不复用——此时无论版本是否
        // 相同都把端口上的孤儿强杀重启。旧逻辑对同版本孤儿走 bail，会让上次崩溃残留的 sidecar
        // 占着端口后**每次启动都闪退**（真机实证），故改为一律强杀。
        let reuse_existing = version_matches && should_reuse_existing_api();
        if reuse_existing {
            println!("✓ 复用已有 FastAPI 服务 ({}/health/ready)", api_base_url);
            return Ok(());
        }
        if version_matches {
            println!(
                "桌面模式检测到端口上已有同版本 API，判定为残留孤儿 sidecar，强杀后启动自带后端。"
            );
        } else {
            println!(
                "检测到端口上运行的 API 版本为 {:?}，与当前应用 {} 不符，强杀旧 sidecar 后重启。",
                running_version, expected_version
            );
        }
        kill_process_on_port(desktop_api_port(&api_base_url));
        // 给旧进程释放端口留出时间，避免紧接着的 spawn 撞端口。
        thread::sleep(Duration::from_secs(1));
    }

    println!("启动 FastAPI 服务 ({})...", api_base_url);

    spawn_api_sidecar(app, &api_base_url, manager)?;

    if !wait_ready {
        return Ok(());
    }
    wait_api_ready(&api_base_url)
}

/// 轮询 /health/ready 直到就绪或超时。先查后睡、250ms 粒度：原先固定先 sleep(2s) 再查，
/// 即使 sidecar 秒起也白等 ≥2s（#3）。
fn wait_api_ready(api_base_url: &str) -> Result<()> {
    println!("等待 API 服务就绪 ({}/health/ready)...", api_base_url);
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    loop {
        if is_api_ready(api_base_url) {
            println!("✓ FastAPI 已就绪");
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            anyhow::bail!("API 服务未在 60 秒内就绪");
        }
        thread::sleep(Duration::from_millis(250));
    }
}

/// 获取项目根目录（从当前可执行文件向上查找）
fn should_reuse_existing_api() -> bool {
    std::env::var("STORYFORGE_DESKTOP_REUSE_API")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn desktop_api_key() -> String {
    std::env::var("STORYFORGE_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "local-dev-key".to_string())
}

#[tauri::command]
fn get_api_config() -> ApiConfig {
    ApiConfig {
        base_url: desktop_api_base_url(),
        api_key: desktop_api_key(),
    }
}

#[tauri::command]
fn restart_api_server(
    app: tauri::AppHandle,
    manager: tauri::State<'_, SharedServiceManager>,
) -> Result<(), String> {
    println!("正在重启本机 FastAPI 服务以应用 LLM 配置...");
    let manager = manager.inner().clone();
    manager.lock().unwrap().shutdown();
    start_api_server(&app, &manager, true)
        .map_err(|error| error.to_string())
}

fn eval_window_json<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    script: &str,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let (tx, rx) = mpsc::channel();
    window
        .eval_with_callback(script, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|error| format!("无法执行窗口脚本: {}", error))?;

    let result = rx
        .recv_timeout(timeout)
        .map_err(|_| "窗口脚本执行超时".to_string())?;

    serde_json::from_str(&result).map_err(|error| format!("无法解析窗口脚本结果: {}", error))
}

fn wait_for_window_state<R, F>(
    window: &tauri::WebviewWindow<R>,
    script: &str,
    attempts: usize,
    delay: Duration,
    predicate: F,
) -> Result<serde_json::Value, String>
where
    R: tauri::Runtime,
    F: Fn(&serde_json::Value) -> bool,
{
    let mut last_value = None;
    let mut last_error = None;

    for _ in 0..attempts {
        match eval_window_json(window, script, Duration::from_millis(1500)) {
            Ok(value) => {
                if predicate(&value) {
                    return Ok(value);
                }
                last_value = Some(value);
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
        thread::sleep(delay);
    }

    if let Some(value) = last_value {
        Err(format!("窗口状态未达到预期，最后状态: {}", value))
    } else {
        Err(last_error.unwrap_or_else(|| "窗口探针失败".to_string()))
    }
}

fn has_bool(value: &serde_json::Value, key: &str, expected: bool) -> bool {
    value
        .get(key)
        .and_then(|entry| entry.as_bool())
        .map(|actual| actual == expected)
        .unwrap_or(false)
}

fn click_window_test_id<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    test_id: &str,
) -> Result<(), String> {
    let script = format!(
        r#"
            (() => {{
              const target = document.querySelector('[data-testid="{}"]');
              if (!target) {{
                return {{ clicked: false }};
              }}
              target.click();
              return {{ clicked: true }};
            }})()
        "#,
        test_id
    );

    let result = eval_window_json(window, &script, Duration::from_millis(1500))?;
    if has_bool(&result, "clicked", true) {
        Ok(())
    } else {
        Err(format!("找不到可点击元素: {}", test_id))
    }
}

fn click_first_file_item<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let script = r#"
        (() => {
          const items = Array.from(document.querySelectorAll('[data-testid="file-item"]'));
          const target = items.find((item) => item.getAttribute('data-file-name') === 'chapter-001.md') ?? items[0];
          if (!target) {
            return { clicked: false, count: items.length };
          }
          target.click();
          return {
            clicked: true,
            count: items.length,
            filePath: target.getAttribute('data-file-path'),
            fileName: target.getAttribute('data-file-name')
          };
        })()
    "#;

    let result = eval_window_json(window, script, Duration::from_millis(1500))?;
    if has_bool(&result, "clicked", true) {
        Ok(())
    } else {
        Err("找不到可点击文件条目".to_string())
    }
}

fn create_smoke_project() -> Result<PathBuf> {
    let mut root = std::env::temp_dir();
    root.push(format!(
        "storyforge-desktop-smoke-{}-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_millis(),
        SMOKE_PROJECT_SEQUENCE.fetch_add(1, Ordering::Relaxed),
    ));

    create_smoke_project_at(root)
}

fn create_smoke_project_at(root: PathBuf) -> Result<PathBuf> {
    create_owned_smoke_project_at(root, |root| {
        let drafts = root.join("正文");
        let outline = root.join("大纲");
        let character = root.join("人物");
        std_fs::create_dir_all(&drafts).context("创建 smoke 项目目录失败")?;
        std_fs::create_dir_all(&outline).context("创建 smoke 大纲目录失败")?;
        std_fs::create_dir_all(&character).context("创建 smoke 人物目录失败")?;
        std_fs::write(
            drafts.join("chapter-001.md"),
            "# Chapter 1\n\nSmoke content\n",
        )
        .context("写入 chapter-001.md 失败")?;
        std_fs::write(
            drafts.join("chapter-002.markdown"),
            "# Chapter 2\n\nNested smoke content\n",
        )
        .context("写入 chapter-002.markdown 失败")?;
        std_fs::write(outline.join("总纲.md"), "Smoke outline\n").context("写入 总纲.md 失败")?;
        std_fs::write(character.join("林岚.md"), "Smoke character\n")
            .context("写入 林岚.md 失败")?;
        std_fs::write(root.join("ignore.txt"), "ignore me").context("写入 ignore.txt 失败")?;
        Ok(())
    })
}

fn create_owned_smoke_project_at(
    root: PathBuf,
    populate: impl FnOnce(&Path) -> Result<()>,
) -> Result<PathBuf> {
    std_fs::create_dir(&root).context("独占创建 smoke 项目根目录失败")?;

    if let Err(error) = populate(&root) {
        if let Err(cleanup_error) = remove_smoke_project(&root) {
            return Err(error.context(format!("清理未完成的 smoke 项目失败: {cleanup_error}")));
        }
        return Err(error);
    }

    Ok(root)
}

fn remove_smoke_project(path: &Path) -> Result<()> {
    match std_fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("删除 smoke 临时项目失败"),
    }
}

fn cleanup_smoke_probe(
    manager: &SharedServiceManager,
    original_path: Option<&std::ffi::OsStr>,
    smoke_project: Option<&Path>,
) -> Result<()> {
    if let Some(path) = original_path {
        std::env::set_var("PATH", path);
    }
    shutdown_managed_services(manager);
    if let Some(path) = smoke_project {
        remove_smoke_project(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod smoke_project_tests {
    use super::*;

    #[test]
    fn preexisting_smoke_project_root_is_not_owned_or_removed() {
        let parent = tempfile::tempdir().expect("create smoke project test parent");
        let root = parent.path().join("preexisting-project");
        std_fs::create_dir_all(&root).expect("create preexisting root");
        std_fs::write(root.join("sentinel.txt"), "must survive").expect("create sentinel");
        std_fs::write(root.join("大纲"), "block directory creation").expect("create blocking file");

        create_smoke_project_at(root.clone()).expect_err("preexisting root must not be acquired");

        assert_eq!(
            std_fs::read_to_string(root.join("sentinel.txt")).expect("sentinel must remain"),
            "must survive"
        );
    }

    #[test]
    fn partial_owned_smoke_project_is_removed() {
        let parent = tempfile::tempdir().expect("create smoke project test parent");
        let root = parent.path().join("owned-partial-project");

        let error = create_owned_smoke_project_at(root.clone(), |owned_root| {
            std_fs::create_dir(owned_root.join("正文")).context("create first child")?;
            anyhow::bail!("injected population failure");
        })
        .expect_err("injected population failure must propagate");

        assert!(error.to_string().contains("injected population failure"));
        assert!(!root.exists(), "owned partial root must be removed");
    }
}

fn count_files_under(path: &std::path::Path) -> usize {
    if !path.exists() {
        return 0;
    }
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .count()
}

fn contains_file_content_under(path: &std::path::Path, expected: &str) -> bool {
    if !path.exists() {
        return false;
    }
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .any(|entry| {
            std_fs::read_to_string(entry.path())
                .map(|content| content.contains(expected))
                .unwrap_or(false)
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmokeShadowVersionMeta {
    schema_version: u32,
    storage: String,
    tree_hash: String,
    record_id: String,
    patch_id: Option<String>,
}

fn find_smoke_shadow_version_meta(
    path: &std::path::Path,
    patch_id: &str,
) -> Option<SmokeShadowVersionMeta> {
    if !path.exists() {
        return None;
    }
    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".meta.json"))
        .filter_map(|entry| std_fs::read_to_string(entry.path()).ok())
        .filter_map(|content| serde_json::from_str::<SmokeShadowVersionMeta>(&content).ok())
        .find(|meta| {
            meta.schema_version == 2
                && meta.storage == "shadow-git"
                && meta.patch_id.as_deref() == Some(patch_id)
        })
}

fn run_smoke_probe<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    app: tauri::AppHandle<R>,
    manager: SharedServiceManager,
) {
    thread::spawn(move || {
        let original_path =
            if runtime_paths::environment_flag("STORYFORGE_SHADOW_GIT_SMOKE_CLEAR_PATH") {
                let value = std::env::var_os("PATH");
                std::env::set_var("PATH", "");
                value
            } else {
                None
            };
        let mut smoke_project_for_cleanup: Option<PathBuf> = None;
        macro_rules! fail_smoke {
            () => {{
                if let Err(error) = cleanup_smoke_probe(
                    &manager,
                    original_path.as_deref(),
                    smoke_project_for_cleanup.as_deref(),
                ) {
                    eprintln!("Smoke 失败: 无法完成失败态清理: {error}");
                }
                std::process::exit(1);
            }};
        }
        let smoke_project = match create_smoke_project() {
            Ok(path) => path,
            Err(error) => {
                eprintln!("Smoke 失败: 无法创建临时项目: {}", error);
                fail_smoke!();
            }
        };
        smoke_project_for_cleanup = Some(smoke_project.clone());
        if runtime_paths::environment_flag("STORYFORGE_DESKTOP_SMOKE_FORCE_FAILURE") {
            eprintln!("Smoke 失败: 已触发隔离清理回归探针");
            fail_smoke!();
        }
        let smoke_project_string = smoke_project.to_string_lossy().to_string();

        let snapshot_script = r#"
            (() => {
              const shell = document.querySelector('[data-testid="desktop-shell"]');
              const editor = document.querySelector('[data-testid="editor-root"]');
              return {
                hasShell: Boolean(shell),
                isTauri: shell?.getAttribute('data-tauri-runtime') === 'true',
                tauriMenuReady: shell?.getAttribute('data-tauri-menu-ready') === 'true',
                smokeApiReady: shell?.getAttribute('data-smoke-api-ready') === 'true',
                smokeHookReady: typeof window.__STORYFORGE_SMOKE__?.openProject === 'function',
                title: document.title,
                layoutView: shell?.getAttribute('data-layout-mode') ?? '',
                layoutFocus: shell?.getAttribute('data-layout-focus') ?? '',
                hasSidePanel: Boolean(document.querySelector('[data-testid="shell-side-panel"]')),
                hasExplorerEmpty: Boolean(document.querySelector('[data-testid="explorer-empty"]')),
                hasFilePanel: Boolean(document.querySelector('[data-testid="file-tree-panel"]')),
                hasAssistantPanel: Boolean(document.querySelector('[data-testid="assistant-panel"]')),
                hasEditorPanel: Boolean(document.querySelector('[data-testid="editor-panel"]')),
                hasActivityExplorer: Boolean(document.querySelector('[data-testid="activity-explorer"]')),
                activityExplorerActive: document.querySelector('[data-testid="activity-explorer"]')?.getAttribute('data-active') === 'true',
                hasWelcomeWorkspace: Boolean(document.querySelector('[data-testid="welcome-workspace"]')),
                hasWelcomeClose: Boolean(document.querySelector('[data-testid="welcome-close"]')),
                hasWelcomeDismissed: Boolean(document.querySelector('[data-testid="welcome-dismissed"]')),
                hasPatchReview: Boolean(document.querySelector('[data-testid="patch-review"]')),
                hasPatchRejectConfirm: Boolean(document.querySelector('[data-testid="patch-reject-confirm"]')),
                hasSuggestionReview: Boolean(document.querySelector('[data-testid="patch-review"], [data-testid="suggestion-review"]')),
                errorToastText: Array.from(document.querySelectorAll('[data-testid="toast-item"][data-tone="error"]')).map((item) => item.textContent ?? '').join('\n'),
                successToastText: Array.from(document.querySelectorAll('[data-testid="toast-item"][data-tone="success"]')).map((item) => item.textContent ?? '').join('\n'),
                visualTone: (() => {
                  const workspace = document.querySelector('[data-testid="welcome-workspace"]');
                  const composer = document.querySelector('[data-testid="welcome-composer-input"]')?.closest('div');
                  const rgb = (element) => {
                    if (!element) return null;
                    const match = getComputedStyle(element).backgroundColor.match(/\d+/g);
                    return match ? match.slice(0, 3).map(Number) : null;
                  };
                  return {
                    workspace: rgb(workspace),
                    composer: rgb(composer),
                  };
                })(),
                fileCount: Number(document.querySelector('[data-testid="file-list"]')?.getAttribute('data-file-count') ?? document.querySelectorAll('[data-testid="file-item"]').length),
                fileItemCount: document.querySelectorAll('[data-testid="file-item"]').length,
                projectPath: document.querySelector('[data-testid="file-list"]')?.getAttribute('data-project-path') ?? '',
                editorLoaded: editor?.getAttribute('data-editor-loaded') === 'true',
                editorReady: editor?.getAttribute('data-editor-ready') === 'true',
                currentFile: editor?.getAttribute('data-current-file') ?? '',
                renderHasFile: editor?.getAttribute('data-render-has-file') === 'true',
                loadAttemptFile: editor?.getAttribute('data-load-attempt-file') ?? '',
                loadError: editor?.getAttribute('data-load-error') ?? '',
                editorInitError: editor?.getAttribute('data-editor-init-error') ?? '',
                editorPreview: editor?.getAttribute('data-content-preview') ?? '',
              };
            })()
        "#;

        let shell = match wait_for_window_state(
            &window,
            snapshot_script,
            40,
            Duration::from_millis(250),
            |value| {
                has_bool(value, "hasShell", true)
                    && has_bool(value, "isTauri", true)
                    && has_bool(value, "tauriMenuReady", true)
                    && value.get("title").and_then(|entry| entry.as_str()) == Some("StoryForge IDE")
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: Tauri 窗口未就绪: {}", error);
                fail_smoke!();
            }
        };

        if !has_bool(&shell, "hasWelcomeWorkspace", true)
            || !has_bool(&shell, "hasWelcomeClose", true)
        {
            eprintln!("Smoke 失败: 初始欢迎工作区不可见: {}", shell);
            fail_smoke!();
        }

        let tone_is_readable = shell
            .get("visualTone")
            .and_then(|entry| {
                let workspace = entry.get("workspace")?.as_array()?;
                let composer = entry.get("composer")?.as_array()?;
                let workspace_ok = workspace
                    .iter()
                    .all(|channel| channel.as_u64().map(|value| value >= 24).unwrap_or(false));
                let composer_ok = composer
                    .iter()
                    .all(|channel| channel.as_u64().map(|value| value >= 36).unwrap_or(false));
                let layered = workspace
                    .first()
                    .and_then(|channel| channel.as_u64())
                    .zip(composer.first().and_then(|channel| channel.as_u64()))
                    .map(|(workspace_value, composer_value)| composer_value > workspace_value)
                    .unwrap_or(false);
                Some(workspace_ok && composer_ok && layered)
            })
            .unwrap_or(false);
        if !tone_is_readable {
            eprintln!("Smoke 失败: 初始欢迎工作区仍然接近黑屏: {}", shell);
            fail_smoke!();
        }

        if let Err(error) = click_window_test_id(&window, "welcome-close") {
            eprintln!("Smoke 失败: 无法关闭初始欢迎页: {}", error);
            fail_smoke!();
        }

        let initial = match wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| {
                value.get("layoutView").and_then(|entry| entry.as_str()) == Some("explorer")
                    && value.get("layoutFocus").and_then(|entry| entry.as_str()) == Some("balanced")
                    && has_bool(value, "hasSidePanel", true)
                    && has_bool(value, "hasExplorerEmpty", true)
                    && has_bool(value, "hasFilePanel", false)
                    && has_bool(value, "hasAssistantPanel", false)
                    && has_bool(value, "hasEditorPanel", false)
                    && has_bool(value, "hasActivityExplorer", true)
                    && has_bool(value, "activityExplorerActive", true)
                    && has_bool(value, "hasWelcomeWorkspace", false)
                    && has_bool(value, "hasWelcomeDismissed", true)
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: 关闭欢迎页后壳层状态不正确: {}", error);
                fail_smoke!();
            }
        };

        let expected_api_base_url = desktop_api_base_url();
        let expected_api_key = desktop_api_key();
        let expected_api_key_json =
            serde_json::to_string(&expected_api_key).unwrap_or_else(|_| "\"\"".to_string());
        let api_config_script = r#"
            (() => {
              const config = window.__STORYFORGE_SMOKE__?.getApiConfigSnapshot?.();
              return {
                baseUrl: config?.baseUrl ?? '',
                hasApiKey: Boolean(config?.apiKey),
                apiKeyMatches: config?.apiKey === __EXPECTED_API_KEY__
              };
            })()
"#
        .replace("__EXPECTED_API_KEY__", &expected_api_key_json);
        let api_config = match wait_for_window_state(
            &window,
            &api_config_script,
            20,
            Duration::from_millis(150),
            |value| {
                value
                    .get("baseUrl")
                    .and_then(|entry| entry.as_str())
                    .map(|entry| !entry.is_empty())
                    .unwrap_or(false)
                    && has_bool(value, "hasApiKey", true)
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: 无法读取 API 配置: {}", error);
                fail_smoke!();
            }
        };
        if api_config.get("baseUrl").and_then(|entry| entry.as_str())
            != Some(expected_api_base_url.as_str())
            || !has_bool(&api_config, "apiKeyMatches", true)
        {
            eprintln!("Smoke 失败: API 配置不符合预期: {}", api_config);
            fail_smoke!();
        }

        let sidebar_was_open = has_bool(&initial, "hasSidePanel", true);
        if let Err(error) = click_window_test_id(&window, "activity-explorer") {
            eprintln!("Smoke 失败: 无法触发文件树窗口交互: {}", error);
            fail_smoke!();
        }
        thread::sleep(Duration::from_millis(400));

        let _sidebar_state = match wait_for_window_state(
            &window,
            snapshot_script,
            10,
            Duration::from_millis(150),
            |value| {
                has_bool(value, "hasSidePanel", !sidebar_was_open)
                    && has_bool(value, "activityExplorerActive", !sidebar_was_open)
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: 切换侧边栏后探针失败: {}", error);
                fail_smoke!();
            }
        };

        if sidebar_was_open {
            if let Err(error) = click_window_test_id(&window, "activity-explorer") {
                eprintln!("Smoke 失败: 无法重新打开文件树面板: {}", error);
                fail_smoke!();
            }
        }

        if let Err(error) = wait_for_window_state(
            &window,
            snapshot_script,
            10,
            Duration::from_millis(150),
            |value| {
                has_bool(value, "hasSidePanel", true)
                    && has_bool(value, "hasExplorerEmpty", true)
                    && has_bool(value, "activityExplorerActive", true)
                    && has_bool(value, "tauriMenuReady", true)
            },
        ) {
            eprintln!("Smoke 失败: 无法恢复文件树面板: {}", error);
            fail_smoke!();
        }

        let _smoke_ready = match wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| {
                value
                    .get("smokeHookReady")
                    .and_then(|entry| entry.as_bool())
                    == Some(true)
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: smoke hook 未就绪: {}", error);
                fail_smoke!();
            }
        };

        let open_project_script = format!(
            r#"
                (() => {{
                  const smoke = window.__STORYFORGE_SMOKE__;
                  if (!smoke || typeof smoke.openProject !== 'function') {{
                    return {{ opened: false, reason: 'missing-smoke-api' }};
                  }}
                  smoke.openProject({});
                  return {{ opened: true }};
                }})()
            "#,
            serde_json::to_string(&smoke_project_string).unwrap_or_else(|_| "\"\"".to_string())
        );
        let open_project_result =
            match eval_window_json(&window, &open_project_script, Duration::from_millis(1500)) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Smoke 失败: 无法调用 smoke 打开项目入口: {}", error);
                    fail_smoke!();
                }
            };
        if !has_bool(&open_project_result, "opened", true) {
            eprintln!(
                "Smoke 失败: smoke 打开项目入口不可用: {}",
                open_project_result
            );
            fail_smoke!();
        }

        let file_list_state = match wait_for_window_state(
            &window,
            snapshot_script,
            40,
            Duration::from_millis(250),
            |value| {
                value.get("projectPath").and_then(|entry| entry.as_str())
                    == Some(smoke_project.to_string_lossy().as_ref())
                    && value.get("fileItemCount").and_then(|entry| entry.as_u64()) == Some(4)
                    && has_bool(value, "hasFilePanel", true)
                    && has_bool(value, "hasAssistantPanel", true)
                    && has_bool(value, "hasEditorPanel", true)
                    && value.get("layoutFocus").and_then(|entry| entry.as_str()) == Some("balanced")
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: 文件列表未加载预期项目: {}", error);
                fail_smoke!();
            }
        };

        if let Err(error) = click_first_file_item(&window) {
            eprintln!("Smoke 失败: 无法点击文件条目: {}", error);
            fail_smoke!();
        }

        let editor_state = match wait_for_window_state(
            &window,
            snapshot_script,
            40,
            Duration::from_millis(250),
            |value| {
                value.get("editorLoaded").and_then(|entry| entry.as_bool()) == Some(true)
                    && value.get("editorReady").and_then(|entry| entry.as_bool()) == Some(true)
                    && value
                        .get("currentFile")
                        .and_then(|entry| entry.as_str())
                        .map(|path| path.ends_with("chapter-001.md"))
                        .unwrap_or(false)
                    && value
                        .get("editorPreview")
                        .and_then(|entry| entry.as_str())
                        .map(|preview| preview.contains("Smoke content"))
                        .unwrap_or(false)
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: 编辑器未加载文件: {}", error);
                fail_smoke!();
            }
        };

        let smoke_file = smoke_project.join("正文").join("chapter-001.md");
        let smoke_file_string = smoke_file.to_string_lossy().to_string();
        let before_revision = "# Chapter 1\n\nSmoke content\n";
        let after_revision = "# Chapter 1\n\nSmoke content revised by Agent\n";
        let propose_script = format!(
            r#"
                (() => {{
                  const smoke = window.__STORYFORGE_SMOKE__;
                  if (!smoke || typeof smoke.proposeRevision !== 'function') {{
                    return {{ proposed: false, reason: 'missing-propose-revision' }};
                  }}
                  smoke.proposeRevision({{
                    filePath: {},
                    before: {},
                    after: {},
                    summary: 'Smoke Agent proposed patch',
                    userIntent: 'smoke writeback',
                    assistantSessionId: 4242,
                    issueIds: ['character-1'],
                    contextFiles: ['人物/林岚.md']
                  }});
                  return {{ proposed: true }};
                }})()
            "#,
            serde_json::to_string(&smoke_file_string).unwrap_or_else(|_| "\"\"".to_string()),
            serde_json::to_string(before_revision).unwrap_or_else(|_| "\"\"".to_string()),
            serde_json::to_string(after_revision).unwrap_or_else(|_| "\"\"".to_string())
        );
        let propose_result =
            match eval_window_json(&window, &propose_script, Duration::from_millis(1500)) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Smoke 失败: 无法注入建议补丁: {}", error);
                    fail_smoke!();
                }
            };
        if !has_bool(&propose_result, "proposed", true) {
            eprintln!("Smoke 失败: 建议补丁入口不可用: {}", propose_result);
            fail_smoke!();
        }

        if let Err(error) = wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| has_bool(value, "hasPatchReview", true),
        ) {
            eprintln!("Smoke 失败: proposed patch diff 未显示: {}", error);
            fail_smoke!();
        }

        let disk_before_accept = std_fs::read_to_string(&smoke_file).unwrap_or_default();
        if disk_before_accept != before_revision {
            eprintln!(
                // 该 smoke 跑在默认的「询问」档：此档下补丁未点接受前盘上必须原样。
                // 「自动」档是作者按项目显式选的另一条路，不走这里。
                "Smoke 失败: 询问档下 proposed patch 未确认前不应写盘，实际内容: {}",
                disk_before_accept
            );
            fail_smoke!();
        }

        if let Err(error) = click_window_test_id(&window, "suggestion-reject") {
            eprintln!("Smoke 失败: 无法拒绝建议补丁: {}", error);
            fail_smoke!();
        }
        if let Err(error) = wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| has_bool(value, "hasPatchRejectConfirm", true),
        ) {
            eprintln!("Smoke 失败: 拒绝补丁后未显示意图确认入口: {}", error);
            fail_smoke!();
        }
        if let Err(error) = click_window_test_id(&window, "patch-reject-confirm") {
            eprintln!("Smoke 失败: 无法确认留空拒绝补丁: {}", error);
            fail_smoke!();
        }
        if let Err(error) = wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| has_bool(value, "hasPatchReview", false),
        ) {
            eprintln!("Smoke 失败: 拒绝补丁后审阅面板未关闭: {}", error);
            fail_smoke!();
        }
        let disk_after_reject = std_fs::read_to_string(&smoke_file).unwrap_or_default();
        if disk_after_reject != before_revision {
            eprintln!(
                "Smoke 失败: 拒绝补丁不应写盘，实际内容: {}",
                disk_after_reject
            );
            fail_smoke!();
        }

        let repropose_result =
            match eval_window_json(&window, &propose_script, Duration::from_millis(1500)) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Smoke 失败: 无法重新注入建议补丁: {}", error);
                    fail_smoke!();
                }
            };
        if !has_bool(&repropose_result, "proposed", true) {
            eprintln!(
                "Smoke 失败: 重新注入建议补丁入口不可用: {}",
                repropose_result
            );
            fail_smoke!();
        }
        if let Err(error) = wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| has_bool(value, "hasPatchReview", true),
        ) {
            eprintln!("Smoke 失败: 重新注入 proposed patch diff 未显示: {}", error);
            fail_smoke!();
        }

        let local_edit_revision = "# Chapter 1\n\nSmoke content locally edited\n";
        let local_edit_script = format!(
            r#"
                (() => {{
                  const smoke = window.__STORYFORGE_SMOKE__;
                  if (!smoke || typeof smoke.setCurrentEditorContent !== 'function') {{
                    return {{ changed: false, reason: 'missing-editor-smoke-hook' }};
                  }}
                  const changed = smoke.setCurrentEditorContent({});
                  return {{
                    changed,
                    content: smoke.getCurrentEditorContent?.() ?? ''
                  }};
                }})()
            "#,
            serde_json::to_string(local_edit_revision).unwrap_or_else(|_| "\"\"".to_string())
        );
        let local_edit_result =
            match eval_window_json(&window, &local_edit_script, Duration::from_millis(1500)) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Smoke 失败: 无法模拟补丁后本地编辑: {}", error);
                    fail_smoke!();
                }
            };
        if !has_bool(&local_edit_result, "changed", true) {
            eprintln!(
                "Smoke 失败: 编辑器 smoke 改稿入口不可用: {}",
                local_edit_result
            );
            fail_smoke!();
        }

        if let Err(error) = click_window_test_id(&window, "suggestion-accept") {
            eprintln!("Smoke 失败: 无法点击接受以触发补丁冲突: {}", error);
            fail_smoke!();
        }
        if let Err(error) = wait_for_window_state(
            &window,
            snapshot_script,
            20,
            Duration::from_millis(150),
            |value| {
                value
                    .get("errorToastText")
                    .and_then(|entry| entry.as_str())
                    .map(|status| status.contains("旧补丁不能直接写回"))
                    .unwrap_or(false)
                    && has_bool(value, "hasPatchReview", true)
            },
        ) {
            eprintln!("Smoke 失败: 旧补丁冲突未被阻止: {}", error);
            fail_smoke!();
        }

        let disk_after_conflict = std_fs::read_to_string(&smoke_file).unwrap_or_default();
        if disk_after_conflict != before_revision {
            eprintln!(
                "Smoke 失败: 冲突补丁不应写盘，实际内容: {}",
                disk_after_conflict
            );
            fail_smoke!();
        }

        let reset_edit_script = format!(
            r#"
                (() => {{
                  const smoke = window.__STORYFORGE_SMOKE__;
                  if (!smoke || typeof smoke.setCurrentEditorContent !== 'function') {{
                    return {{ changed: false, reason: 'missing-editor-smoke-hook' }};
                  }}
                  return {{
                    changed: smoke.setCurrentEditorContent({}),
                    content: smoke.getCurrentEditorContent?.() ?? ''
                  }};
                }})()
            "#,
            serde_json::to_string(before_revision).unwrap_or_else(|_| "\"\"".to_string())
        );
        let reset_edit_result =
            match eval_window_json(&window, &reset_edit_script, Duration::from_millis(1500)) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("Smoke 失败: 无法恢复编辑器内容以继续写回验证: {}", error);
                    fail_smoke!();
                }
            };
        if !has_bool(&reset_edit_result, "changed", true)
            || reset_edit_result
                .get("content")
                .and_then(|value| value.as_str())
                != Some(before_revision)
        {
            eprintln!(
                "Smoke 失败: 编辑器内容恢复入口不可用: {}",
                reset_edit_result
            );
            fail_smoke!();
        }

        if let Err(error) = click_window_test_id(&window, "suggestion-accept") {
            eprintln!("Smoke 失败: 无法点击接受以确认写回补丁: {}", error);
            fail_smoke!();
        }

        let writeback_state = match wait_for_window_state(
            &window,
            snapshot_script,
            100,
            Duration::from_millis(200),
            |value| {
                value
                    .get("editorPreview")
                    .and_then(|entry| entry.as_str())
                    .map(|preview| preview.contains("revised by Agent"))
                    .unwrap_or(false)
                    && value
                        .get("successToastText")
                        .and_then(|entry| entry.as_str())
                        .map(|status| status.contains("已写入当前文件"))
                        .unwrap_or(false)
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("Smoke 失败: 确认写回后编辑器未刷新: {}", error);
                fail_smoke!();
            }
        };

        let disk_after_accept = std_fs::read_to_string(&smoke_file).unwrap_or_default();
        if disk_after_accept != after_revision {
            eprintln!(
                "Smoke 失败: 确认写回后磁盘内容未变化，实际内容: {}",
                disk_after_accept
            );
            fail_smoke!();
        }
        let versions_dir = smoke_project.join(".storyforge").join("versions");
        let author_loop_dir = smoke_project.join(".storyforge").join("author-loop");
        if count_files_under(&versions_dir) == 0
            || !contains_file_content_under(&versions_dir, "Agent")
            || !contains_file_content_under(&versions_dir, "shadow-git")
            || !contains_file_content_under(&versions_dir, "Smoke Agent proposed patch")
            || !contains_file_content_under(&versions_dir, "smoke-file-revision")
            || !contains_file_content_under(&versions_dir, "4242")
            || !contains_file_content_under(&versions_dir, "character-1")
            || !contains_file_content_under(&versions_dir, "人物/林岚.md")
        {
            eprintln!("Smoke 失败: 写回前版本快照或 Agent 元数据缺失");
            fail_smoke!();
        }
        let Some(shadow_meta) =
            find_smoke_shadow_version_meta(&versions_dir, "smoke-file-revision")
        else {
            eprintln!("Smoke 失败: 未找到 schema-v2 影子 Git 版本元数据");
            fail_smoke!();
        };
        let shadow_evidence = match shadow_git::verify_smoke_snapshot(
            &app,
            &smoke_project_string,
            &shadow_meta.tree_hash,
            &shadow_meta.record_id,
            "正文/chapter-001.md",
        ) {
            Ok(evidence) => evidence,
            Err(error) => {
                eprintln!("Smoke 失败: 影子 Git tree/ref 验证失败: {}", error);
                fail_smoke!();
            }
        };
        if shadow_evidence.content != before_revision {
            eprintln!(
                "Smoke 失败: 影子 Git 写前正文不匹配，实际内容: {}",
                shadow_evidence.content
            );
            fail_smoke!();
        }
        if count_files_under(&author_loop_dir) == 0
            || !contains_file_content_under(&author_loop_dir, "Smoke Agent proposed patch")
            || !contains_file_content_under(&author_loop_dir, "smoke-file-revision")
            || !contains_file_content_under(&author_loop_dir, "4242")
            || !contains_file_content_under(&author_loop_dir, "character-1")
            || !contains_file_content_under(&author_loop_dir, "人物/林岚.md")
        {
            eprintln!("Smoke 失败: 作者闭环记录缺失或内容不正确");
            fail_smoke!();
        }

        println!(
            "Desktop Tauri smoke result: project={}, files={}, currentFile={}, preview={}, writebackPreview={}, shadowGitVersion={}, shadowGitPath={}, shadowRepositoryPath={}",
            file_list_state
                .get("projectPath")
                .and_then(|entry| entry.as_str())
                .unwrap_or(""),
            file_list_state
                .get("fileCount")
                .and_then(|entry| entry.as_u64())
                .unwrap_or(0),
            editor_state
                .get("currentFile")
                .and_then(|entry| entry.as_str())
                .unwrap_or(""),
            editor_state
                .get("editorPreview")
                .and_then(|entry| entry.as_str())
                .unwrap_or(""),
            writeback_state
                .get("editorPreview")
                .and_then(|entry| entry.as_str())
                .unwrap_or(""),
            shadow_evidence.git_version,
            shadow_evidence.executable_path,
            shadow_evidence.repository_path,
        );
        if let Err(error) =
            cleanup_smoke_probe(&manager, original_path.as_deref(), Some(&smoke_project))
        {
            eprintln!("Smoke 失败: 无法完成成功态清理: {error}");
            std::process::exit(1);
        }
        let _ = app.exit(0);
        std::process::exit(0);
    });
}

fn main() {
    println!("=== StoryForge 桌面 IDE 启动中 ===\n");

    let manager = Arc::new(Mutex::new(ServiceManager::new()));
    let manager_clone = Arc::clone(&manager);
    let manager_for_setup = Arc::clone(&manager);

    // 注册退出处理
    ctrlc::set_handler(move || {
        manager_clone.lock().unwrap().shutdown();
        std::process::exit(0);
    })
    .expect("设置 Ctrl+C 处理器失败");

    println!("本地桌面模式：使用 sidecar + sqlite，无需外部服务。");

    // 检查桌面前端是否已经在运行。
    // Vite dev server 由独立终端或 Tauri devUrl 工作流提供。
    if cfg!(debug_assertions) {
        println!("检查前端服务 (http://localhost:3007)...");
        if reqwest::blocking::get("http://localhost:3007").is_ok() {
            println!("✓ 前端服务已就绪");
        } else {
            eprintln!("错误: 前端服务未运行！请先手动启动:");
            eprintln!("  cd apps/desktop/frontend && npm run dev");
            manager.lock().unwrap().shutdown();
            std::process::exit(1);
        }
    }

    println!("\n=== 所有服务已就绪，正在打开桌面应用 ===\n");

    // 4. 启动 Tauri 应用
    let builder = tauri::Builder::default();
    let builder = if is_smoke_mode() {
        // Smoke 使用隔离 API/data/WebView profile，必须独立运行并产出真实 marker。
        builder
    } else {
        // 必须先注册：第二个进程只负责唤醒首个窗口，不得继续启动自己的 sidecar。
        builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
    };
    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&manager))
        .manage(watcher::WatcherManager::new())
        .manage(shadow_git::ShadowGitState::default())
        .invoke_handler(tauri::generate_handler![
            // 文件系统命令
            fs::read_file,
            fs::read_project_file,
            fs::write_file,
            fs::list_dir,
            fs::delete_path,
            fs::create_dir,
            fs::rename_path,
            fs::path_exists,
            fs::get_file_info,
            fs::copy_into_project,
            fs::read_project_file_base64,
            get_api_config,
            restart_api_server,
            llm_config::get_llm_config,
            llm_config::save_llm_config,
            // 作品版本影子 Git 命令（固定 DTO，不暴露任意 Git 参数）
            shadow_git::create_shadow_snapshot,
            shadow_git::retain_shadow_snapshot,
            shadow_git::release_shadow_snapshot,
            shadow_git::read_shadow_snapshot_file,
            shadow_git::filter_shadow_snapshot_hashes,
            shadow_git::shadow_git_status,
            // 文件监听命令
            watcher::watch_file,
            watcher::stop_watching,
        ])
        .setup(move |app| {
            if is_smoke_mode() {
                // smoke：同步等后端就绪后再跑探针，保持既有时序与断言不变。
                println!("Desktop Tauri smoke mode enabled");
                println!(
                    "Desktop Tauri smoke isolation: {}",
                    runtime_paths::SMOKE_ISOLATION_PROTOCOL
                );
                let smoke_setup = (|| -> Result<()> {
                    start_api_server(
                        app.handle(),
                        &manager_for_setup,
                        true,
                    )?;
                    if runtime_paths::environment_flag(
                        "STORYFORGE_DESKTOP_SMOKE_FORCE_SETUP_FAILURE",
                    ) {
                        anyhow::bail!("已触发 sidecar 启动后 smoke setup 清理回归探针");
                    }
                    let window = app
                        .get_webview_window("main")
                        .context("Smoke 失败: 未找到 main 窗口")?;
                    run_smoke_probe(window, app.handle().clone(), Arc::clone(&manager_for_setup));
                    Ok(())
                })();
                if let Err(error) = smoke_setup {
                    eprintln!("Smoke setup 失败: {error}");
                    shutdown_managed_services(&manager_for_setup);
                    std::process::exit(1);
                }
            } else {
                // 正常启动（#3）：只 spawn 进程（快）即返回，让窗口立刻出帧；就绪在后台线程等。
                // 失败只记日志——窗口已在，StatusBar 会显示「连接中断」，用户可在设置里保存并应用
                // 重试，不再在窗口出现后强杀整个 app。
                if let Err(error) = start_api_server(
                    app.handle(),
                    &manager_for_setup,
                    false,
                ) {
                    eprintln!(
                        "API sidecar 拉起失败（窗口已就绪，可在设置里重试）: {}",
                        error
                    );
                } else {
                    let base_url = desktop_api_base_url();
                    thread::spawn(move || {
                        if let Err(error) = wait_api_ready(&base_url) {
                            eprintln!("API 服务未就绪（可在设置里重试）: {}", error);
                        }
                    });
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用时出错")
        .run(move |_app_handle, event| {
            // 应用退出（含关闭最后一个窗口）时清理子进程；
            // 必须在 RunEvent 里做，`.run()` 之后的尾代码在正常退出路径上不保证执行，
            // 否则打包后端 sidecar 会成为孤儿进程，占用文件锁/端口，导致重装删不掉 exe。
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                manager.lock().unwrap().shutdown();
            }
        });
}
