# StoryForge Desktop IDE

本地桌面 IDE 应用，提供 Cursor 风格的写作体验。

## ✨ 特性

- **一键启动**：自动管理基础服务、API 和桌面前端
- **原生体验**：独立桌面窗口，无需浏览器
- **IDE-first**：桌面 IDE 是当前主产品体验，Web 保留为维护和调试入口

## 环境要求

- Docker Desktop（必需）
- Rust 1.94+（必需）
- Node.js 20+（必需）
- Python 3.11+ with `uv`（必需）
- pnpm 9.x（必需）

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

**首次运行**需要等待 Rust 编译（5-10 分钟），之后秒开。

## 手动启动（调试用）

如果自动启动失败，可以手动分步启动：

```bash
# 1. 启动 Docker 服务
docker compose up -d postgres redis minio

# 2. 执行数据库迁移
cd apps/api
uv run alembic upgrade head

# 3. 启动 API
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
cd apps/desktop
pnpm tauri build
```

生成的安装包位于 `src-tauri/target/release/bundle/`

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
