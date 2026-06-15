// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs;
mod watcher;
mod menu;

use anyhow::{Context, Result};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;
use std::sync::{Arc, Mutex};
use std::net::TcpStream;

/// 全局状态：保存所有启动的子进程，用于退出时清理
struct ServiceManager {
    children: Vec<Child>,
}

impl ServiceManager {
    fn new() -> Self {
        Self { children: Vec::new() }
    }

    fn add(&mut self, child: Child) {
        self.children.push(child);
    }

    fn shutdown(&mut self) {
        println!("正在停止所有服务...");
        for child in &mut self.children {
            if let Err(e) = child.kill() {
                eprintln!("停止进程失败: {}", e);
            }
        }
        println!("所有服务已停止");
    }
}

/// 检测 TCP 端口是否可达
fn check_port(host: &str, port: u16, timeout_secs: u64) -> bool {
    let addr = format!("{}:{}", host, port);
    for _ in 0..(timeout_secs * 2) {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

/// 检测命令是否存在
fn command_exists(cmd: &str) -> bool {
    let checker = if cfg!(target_os = "windows") { "where" } else { "which" };
    Command::new(checker)
        .arg(cmd)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 启动并等待 Docker Compose 服务
fn start_docker_services(project_root: &str) -> Result<()> {
    if !command_exists("docker") {
        anyhow::bail!("未找到 docker 命令，请安装 Docker Desktop");
    }

    println!("启动 Docker Compose 服务（postgres, redis, minio）...");

    let status = Command::new("docker")
        .args(&["compose", "up", "-d", "postgres", "redis", "minio"])
        .current_dir(project_root)
        .status()
        .context("执行 docker compose up 失败")?;

    if !status.success() {
        anyhow::bail!("docker compose up 执行失败");
    }

    println!("等待 PostgreSQL (55432) 可达...");
    if !check_port("127.0.0.1", 55432, 30) {
        anyhow::bail!("PostgreSQL 未在 30 秒内启动");
    }

    println!("✓ PostgreSQL 已就绪");

    println!("等待 Redis (6379) 可达...");
    if !check_port("127.0.0.1", 6379, 30) {
        anyhow::bail!("Redis 未在 30 秒内启动");
    }

    println!("✓ Redis 已就绪");
    println!("✓ Docker 服务全部就绪");

    Ok(())
}

/// 执行数据库迁移
fn run_migrations(project_root: &str) -> Result<()> {
    if !command_exists("uv") {
        anyhow::bail!("未找到 uv 命令，请安装：https://github.com/astral-sh/uv");
    }

    println!("执行数据库迁移 (alembic upgrade head)...");

    let api_dir = format!("{}/apps/api", project_root);
    let status = Command::new("uv")
        .args(&["run", "alembic", "upgrade", "head"])
        .current_dir(&api_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .context("执行 alembic upgrade 失败")?;

    if !status.success() {
        anyhow::bail!("数据库迁移失败");
    }

    println!("✓ 数据库迁移完成");
    Ok(())
}

/// 启动 FastAPI 服务
fn start_api_server(project_root: &str, manager: &Arc<Mutex<ServiceManager>>) -> Result<()> {
    println!("启动 FastAPI 服务 (uvicorn :8000)...");

    let api_dir = format!("{}/apps/api", project_root);
    // 使用 .venv 中的 Python 运行 Windows 兼容脚本
    let venv_python = if cfg!(windows) {
        format!("{}/.venv/Scripts/python.exe", api_dir)
    } else {
        format!("{}/.venv/bin/python", api_dir)
    };

    let child = Command::new(&venv_python)
        .args(&["run_windows.py"])  // 使用 Windows 兼容脚本
        .current_dir(&api_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .context("启动 uvicorn 失败")?;

    manager.lock().unwrap().add(child);

    println!("等待 API 服务就绪 (http://localhost:8000/health/ready)...");
    for i in 0..30 {
        thread::sleep(Duration::from_secs(2));
        if let Ok(resp) = reqwest::blocking::get("http://localhost:8000/health/ready") {
            if resp.status().is_success() {
                println!("✓ FastAPI 已就绪");
                return Ok(());
            }
        }
        if i % 5 == 4 {
            println!("等待中... ({}/30)", i + 1);
        }
    }

    anyhow::bail!("API 服务未在 60 秒内就绪")
}

/// 获取项目根目录（从当前可执行文件向上查找）
fn find_project_root() -> Result<String> {
    let mut current = std::env::current_exe()
        .context("无法获取当前可执行文件路径")?;

    // 开发模式：apps/desktop/src-tauri/target/debug/storyforge-desktop.exe
    // 向上查找包含 package.json 和 docker-compose.yml 的目录
    for _ in 0..10 {
        current.pop();
        let package_json = current.join("package.json");
        let docker_compose = current.join("docker-compose.yml");

        if package_json.exists() && docker_compose.exists() {
            return Ok(current.to_string_lossy().to_string());
        }
    }

    // 回退方案：使用环境变量
    if let Ok(root) = std::env::var("STORYFORGE_ROOT") {
        return Ok(root);
    }

    anyhow::bail!(
        "无法找到项目根目录。请设置环境变量 STORYFORGE_ROOT 或从项目目录运行"
    )
}

fn main() {
    println!("=== StoryForge 桌面 IDE 启动中 ===\n");

    let manager = Arc::new(Mutex::new(ServiceManager::new()));
    let manager_clone = Arc::clone(&manager);

    // 注册退出处理
    ctrlc::set_handler(move || {
        manager_clone.lock().unwrap().shutdown();
        std::process::exit(0);
    })
    .expect("设置 Ctrl+C 处理器失败");

    // 查找项目根目录
    let project_root = match find_project_root() {
        Ok(root) => {
            println!("项目根目录: {}\n", root);
            root
        }
        Err(e) => {
            eprintln!("错误: {}", e);
            eprintln!("\n提示: 请从项目根目录运行，或设置环境变量：");
            eprintln!("  export STORYFORGE_ROOT=/path/to/StoryForge");
            std::process::exit(1);
        }
    };

    // 1. 启动 Docker 服务
    if let Err(e) = start_docker_services(&project_root) {
        eprintln!("Docker 服务启动失败: {}", e);
        std::process::exit(1);
    }

    // 2. 执行数据库迁移
    if let Err(e) = run_migrations(&project_root) {
        eprintln!("数据库迁移失败: {}", e);
        manager.lock().unwrap().shutdown();
        std::process::exit(1);
    }

    // 3. 启动 API 服务
    if let Err(e) = start_api_server(&project_root, &manager) {
        eprintln!("API 服务启动失败: {}", e);
        manager.lock().unwrap().shutdown();
        std::process::exit(1);
    }

    // 4. 检查桌面前端是否已经在运行。
    // Vite dev server 由独立终端或 Tauri devUrl 工作流提供。
    println!("检查前端服务 (http://localhost:3007)...");
    if reqwest::blocking::get("http://localhost:3007").is_ok() {
        println!("✓ 前端服务已就绪");
    } else {
        eprintln!("错误: 前端服务未运行！请先手动启动:");
        eprintln!("  cd apps/desktop/frontend && npm run dev");
        manager.lock().unwrap().shutdown();
        std::process::exit(1);
    }

    println!("\n=== 所有服务已就绪，正在打开桌面应用 ===\n");

    // 5. 启动 Tauri 应用
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatcherManager::new())
        .invoke_handler(tauri::generate_handler![
            // 文件系统命令
            fs::read_file,
            fs::write_file,
            fs::list_dir,
            fs::delete_path,
            fs::create_dir,
            fs::rename_path,
            fs::path_exists,
            fs::get_file_info,
            // 文件监听命令
            watcher::watch_file,
            watcher::stop_watching,
        ])
        .setup(|app| {
            // 创建菜单
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            // 监听菜单事件
            app.on_menu_event(|app, event| {
                menu::handle_menu_event(app, event.id().as_ref());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");

    // 应用退出时清理
    manager.lock().unwrap().shutdown();
}
