# StoryForge Desktop IDE

本地桌面 IDE 应用，提供 IDE 风格的写作体验。

## ✨ 特性

- **一键启动**：自动管理基础服务、API 和桌面前端
- **原生体验**：独立桌面窗口，无需浏览器
- **IDE-first**：桌面 IDE 是当前唯一主产品体验，旧 Web 入口已退场

## 使用语境

- **已安装应用（作者）**：NSIS 安装包内嵌 API sidecar 与 MinGit，双击即用，不需要 Docker / Node / Python / Rust。
- **源码开发（默认模式）**：`pnpm desktop:dev` 由 Tauri 主进程检查 Docker（PostgreSQL/Redis/MinIO）、执行 Alembic 迁移并启动或复用 API。
- **源码开发（无 Docker 单机）**：`STORYFORGE_DESKTOP_SKIP_SERVICES=1` 跳过 Docker 与迁移检查，API 走 SQLite；语义细节见 `USAGE.md`。

## 环境要求（仅源码开发需要）

- Docker Desktop（默认开发模式必需；单机 SQLite 模式不需要）
- Rust 1.94+
- Node.js 20+
- Python 3.11+ with `uv`
- pnpm 9.x

## 🚀 一键启动（推荐）

```bash
# 从项目根目录运行
npm --prefix apps/desktop/frontend install
pnpm desktop:dev
```

**自动完成**：

1. ✅ 启动 Docker Compose（PostgreSQL、Redis、MinIO）
2. ✅ 等待基础服务就绪
3. ✅ 执行数据库迁移（alembic upgrade head）
4. ✅ 启动 FastAPI（:8000）
5. ✅ 自动启动并检查 Vite 桌面前端（:3007）
6. ✅ 打开桌面应用窗口

首次运行需要编译 Rust 依赖，耗时明显长于后续启动；具体时长取决于机器，不作固定承诺。注意窗口打开与 API 就绪是两个状态：正常路径下窗口先开，API readiness 在后台等待。

## 手动启动（调试用）

如果自动启动失败，可以手动分步启动（注意：一键启动实际由 Tauri 主进程经 `apps/api/run_windows.py` 起 API、非 reload 模式；下面的 uvicorn 仅是手动调试路径）：

```bash
# 1. 启动 Docker 服务
docker compose up -d postgres redis minio

# 2. 执行数据库迁移
cd apps/api
uv run alembic upgrade head

# 3. 启动 API（手动调试）
uv run uvicorn app.main:app --reload

# 4. 启动桌面前端（新终端）
cd apps/desktop/frontend
npm run dev

# 5. 启动桌面应用（新终端）
cd apps/desktop
pnpm tauri dev
```

## 构建生产版本

```bash
# 从项目根目录运行；会先准备随包 MinGit、再用 PyInstaller 重打 API sidecar，最后 tauri build
pnpm.cmd desktop:build
```

生成的安装包位于 `src-tauri/target/release/bundle/`；版本号以 `src-tauri/tauri.conf.json` 为准。直接 `pnpm tauri build` 会跳过 MinGit 与 sidecar 准备，不要用它出分发包。发布前验收分档见 `docs/operations/release-checklist.md`。

## 架构

```
desktop/
├── src-tauri/       Rust 后端
│   ├── src/
│   │   └── main.rs  自动启动服务 + Tauri 应用
│   └── tauri.conf.json  窗口配置
└── package.json     npm 脚本
```

前端通过 `devUrl: http://localhost:3007` 加载 `apps/desktop/frontend` 的 Vite + Monaco IDE。`tauri dev` 会通过 `beforeDevCommand` 自动启动或复用该 Vite 服务；Web 版入口不再作为桌面 IDE 的主体验来源。

## 故障排查

### 找不到项目根目录

设置环境变量：

```bash
export STORYFORGE_ROOT=/path/to/StoryForge
pnpm desktop:dev
```

### Docker 服务启动失败

确保 Docker Desktop 正在运行：

```bash
docker ps
```

### API/桌面前端端口被占用

检查并关闭占用端口的进程：

```bash
# Windows
netstat -ano | findstr "8000"
netstat -ano | findstr "3007"

# 关闭进程
taskkill /PID <PID> /F
```

### 数据库迁移失败

手动执行迁移查看详细错误：

```bash
cd apps/api
uv run alembic upgrade head
```
