# StoryForge Desktop IDE 使用指南

## 🚀 快速开始

### 一键启动（推荐）

```bash
# 在项目根目录运行
npm --prefix apps/desktop/frontend install
pnpm desktop:dev
```

**首次运行**会自动：

1. 下载并编译 Rust 依赖（仅首次，耗时明显更长）
2. 启动 Docker 服务（PostgreSQL、Redis、MinIO）
3. 执行数据库迁移
4. 启动 FastAPI，并自动启动/检查 Vite 桌面前端
5. 打开桌面应用窗口

**后续运行**：无需重新编译；窗口打开与 API 就绪是两个状态——正常路径下窗口先开，API readiness 在后台完成（仅 smoke 模式同步等待后端）。具体启动时长取决于机器，不作固定秒数承诺。

### 首次运行详细步骤

```bash
# 1. 确保 Docker Desktop 正在运行
docker ps

# 2. 从项目根目录启动
cd /path/to/StoryForge
pnpm desktop:dev

# 3. 等待启动日志（形如）：
# === StoryForge 桌面 IDE 启动中 ===
# 项目根目录: D:\StoryForge
# 启动 Docker Compose 服务...
# ✓ PostgreSQL 已就绪
# ✓ Redis 已就绪
# ✓ 数据库迁移完成
# ✓ FastAPI 已就绪
# ✓ 前端服务已就绪
# === 正在打开桌面应用 ===

# 4. 桌面窗口自动打开（窗口打开早于后台 API 最终就绪）
# 显示 IDE 界面（文件树、编辑器、面板等）
```

## 🎯 功能特性

### 自动服务管理

- **自动启动**：无需手动开多个终端
- **就绪协调**：窗口打开不等全部服务就绪；API readiness 在后台完成（仅 smoke 模式同步等待）
- **优雅退出**：关闭窗口或 Ctrl+C 时清理由本轮创建且受管的子进程；复用的既有服务与 Docker 容器不随之停止

### 作者主流程（当前主体验）

1. 欢迎页/作品库创建或打开本地小说项目。
2. 工作台用 Monaco 编辑器写作；左侧文件树、版本快照、命令面板可用。
3. 与对话式 Agent 讨论：审稿、定向修订、新文件起草都以 proposed patch 返回。
4. 按项目权限档位处理补丁：`read`/`ask` 逐次确认，`auto`/`full` 免点击但仍走写前快照 → 原子写 → 版本记录的 guarded writeback，可撤销。
5. 「设置 → 模型服务」配置 provider、base URL、model 与 API key（本机 DPAPI 保护），保存即生效。

### 编辑器与项目功能

- **文件编辑**：Monaco Editor，支持语法高亮
- **章节管理**：查看、编辑、排序章节
- **知识/检索面板**：项目级检索与知识条目管理
- **版本记录**：影子 Git 版本快照与历史对比（不是通用 Git 客户端工作流）

## 📝 常见操作

### 启动应用

```bash
pnpm desktop:dev
```

### 停止应用

- **方法 1**：关闭桌面窗口（推荐）
- **方法 2**：在启动终端按 `Ctrl+C`

两种方式都会清理由本轮 dev 工作流创建并受管的进程（Vite、Tauri、其托管的 API 子进程）；被复用的既有服务（`STORYFORGE_DESKTOP_REUSE_API=1` 的外部 API、复用的 Vite）和 Docker 容器不属于受管子进程，不会被停止。

### 查看日志

启动终端会显示所有服务的日志：

- Docker Compose 输出
- 数据库迁移日志
- FastAPI 日志（API 请求）
- Vite 桌面前端日志（页面访问）

### 构建安装包

```bash
# 从项目根目录运行（prepare:git + build:api-sidecar + tauri build）
pnpm.cmd desktop:build
```

生成文件（版本号以 `src-tauri/tauri.conf.json` 为准，当前为 0.1.10；`targets: all` 不代表各平台安装包均已验收）：

- Windows: `src-tauri/target/release/bundle/msi/StoryForge IDE_<version>_x64_en-US.msi`、`.../nsis/StoryForge IDE_<version>_x64-setup.exe`
- macOS: `src-tauri/target/release/bundle/dmg/StoryForge IDE_<version>_x64.dmg`
- Linux: `src-tauri/target/release/bundle/deb/storyforge-ide_<version>_amd64.deb`

## 🔧 故障排查

### 问题：找不到项目根目录

**错误信息**：

```
无法找到项目根目录。请设置环境变量 STORYFORGE_ROOT 或从项目目录运行
```

**解决方案**：

```bash
# 方法 1：从项目根目录运行
cd /path/to/StoryForge
pnpm desktop:dev

# 方法 2：设置环境变量
export STORYFORGE_ROOT=/path/to/StoryForge
pnpm desktop:dev
```

### 问题：Docker 服务启动失败

**错误信息**：

```
Docker 服务启动失败: 执行 docker compose up 失败
```

**解决方案**：

1. 确保 Docker Desktop 正在运行
2. 检查 Docker 守护进程：`docker ps`
3. 手动启动服务测试：`docker compose up -d postgres redis minio`

### 问题：端口被占用

**错误信息**：

```
Bind for 0.0.0.0:8000 failed: port is already allocated
```

**解决方案**：

```bash
# Windows
netstat -ano | findstr "8000"
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:8000 | xargs kill -9
```

### 问题：API 服务启动失败

**错误信息**：

```
API 服务启动失败: API 服务未在 60 秒内就绪
```

**解决方案**：

1. 检查数据库是否正常：`docker compose ps postgres`
2. 手动启动 API 查看详细错误：
   ```bash
   cd apps/api
   uv run uvicorn app.main:app --reload
   ```

### 问题：数据库迁移失败

**错误信息**：

```
数据库迁移失败: 执行 alembic upgrade 失败
```

**解决方案**：

1. 检查 PostgreSQL 连接：
   ```bash
   docker compose exec postgres psql -U storyforge -d storyforge -c "SELECT 1;"
   ```
2. 手动执行迁移查看详细错误：
   ```bash
   cd apps/api
   uv run alembic upgrade head
   ```

### 问题：Rust 编译失败

**错误信息**：

```
error: failed to compile `storyforge-desktop`
```

**解决方案**：

1. 更新 Rust：`rustup update`
2. 清理缓存：`cd apps/desktop/src-tauri && cargo clean`
3. 重新编译：`cargo build`

## 🐛 调试模式

### 查看完整日志

启动命令会实时输出所有日志，无需额外配置。

### 手动启动服务（逐步调试）

如果自动启动有问题，可以手动分步启动：

```bash
# 1. 启动 Docker
docker compose up -d postgres redis minio

# 2. 迁移数据库
cd apps/api
uv run alembic upgrade head

# 3. 启动 API
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 4. 启动桌面前端（新终端）
cd apps/desktop/frontend
npm run dev

# 5. 启动桌面应用（新终端）
cd apps/desktop
pnpm tauri dev
```

### 单机无 Docker 模式（`STORYFORGE_DESKTOP_SKIP_SERVICES=1`）

该变量**只跳过 Docker 服务检查与 Alembic 迁移**，数据库改用本机 SQLite；桌面主进程**仍会自己启动 API 子进程**，并不是「只开 Tauri、复用已在跑的 API」。

要复用本机已有 API，需同时显式设置 `STORYFORGE_DESKTOP_REUSE_API=1`，且仅当已有 API 与应用版本一致时才会复用；否则为保证 key 不注入错误后端，主进程可能终止占用 `127.0.0.1:8000` 的旧进程再启动自己的 API。诊断已有进程状态时不要再用旧版「仅测试 Tauri」的说法操作。

```powershell
# Windows PowerShell
cd apps/desktop
$env:STORYFORGE_DESKTOP_SKIP_SERVICES = "1"
pnpm tauri dev

# 复用已在跑的同版本 API（追加）
$env:STORYFORGE_DESKTOP_REUSE_API = "1"
```

```bash
# bash / macOS / Linux
cd apps/desktop
STORYFORGE_DESKTOP_SKIP_SERVICES=1 pnpm tauri dev
```

## 📚 相关文档

- [README.md](./README.md) - 项目概览、使用语境与环境要求
- [STATUS.md](./STATUS.md) - 2026-06 原型阶段报告（历史记录，非当前能力清单）
- [CLAUDE.md](../../CLAUDE.md) - 项目整体架构

## 💡 提示

- **首次编译时间**：Rust 首次编译耗时明显更长，请耐心等待；后续启动无需重编译
- **推荐配置**：16GB+ 内存，SSD 硬盘
- **开发建议**：默认开发模式保持 Docker Desktop 运行；无 Docker 时用 `STORYFORGE_DESKTOP_SKIP_SERVICES=1` 单机模式
