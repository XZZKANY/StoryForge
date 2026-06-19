# StoryForge Desktop IDE 使用指南

## 🚀 快速开始

### 一键启动（推荐）

```bash
# 在项目根目录运行
npm --prefix apps/desktop/frontend install
pnpm desktop:dev
```

**首次运行**会自动：

1. 下载并编译 Rust 依赖（5-10 分钟，仅首次）
2. 启动 Docker 服务（PostgreSQL、Redis、MinIO）
3. 执行数据库迁移
4. 启动 FastAPI，并自动启动/检查 Vite 桌面前端
5. 打开桌面应用窗口

**后续运行**：秒开（约 2-3 秒）

### 首次运行详细步骤

```bash
# 1. 确保 Docker Desktop 正在运行
docker ps

# 2. 从项目根目录启动
cd /path/to/StoryForge
pnpm desktop:dev

# 3. 等待启动日志
# 你会看到：
# === StoryForge 桌面 IDE 启动中 ===
# 项目根目录: D:\StoryForge
# 启动 Docker Compose 服务...
# ✓ PostgreSQL 已就绪
# ✓ Redis 已就绪
# ✓ 数据库迁移完成
# ✓ FastAPI 已就绪
# ✓ 前端服务已就绪
# === 所有服务已就绪，正在打开桌面应用 ===

# 4. 桌面窗口自动打开
# 显示 IDE 界面（文件树、编辑器、面板等）
```

## 🎯 功能特性

### 自动服务管理

- **自动启动**：无需手动开多个终端
- **健康检查**：确保所有服务真正就绪后才打开窗口
- **优雅退出**：关闭窗口或 Ctrl+C 时自动停止所有服务

### IDE 功能

- **文件编辑**：Monaco Editor，支持语法高亮
- **章节管理**：查看、编辑、排序章节
- **实时预览**：编辑即时渲染
- **版本控制**：集成 Git 工作流

## 📝 常见操作

### 启动应用

```bash
pnpm desktop:dev
```

### 停止应用

- **方法 1**：关闭桌面窗口（推荐）
- **方法 2**：在启动终端按 `Ctrl+C`

两种方式都会自动停止由桌面 dev 工作流拉起的前端和桌面进程；API 服务由桌面主进程管理时也会随之停止。

### 查看日志

启动终端会显示所有服务的日志：

- Docker Compose 输出
- 数据库迁移日志
- FastAPI 日志（API 请求）
- Vite 桌面前端日志（页面访问）

### 构建安装包

```bash
cd apps/desktop
pnpm tauri build
```

生成文件：

- Windows: `src-tauri/target/release/bundle/msi/StoryForge IDE_0.1.0_x64_en-US.msi`
- macOS: `src-tauri/target/release/bundle/dmg/StoryForge IDE_0.1.0_x64.dmg`
- Linux: `src-tauri/target/release/bundle/deb/storyforge-ide_0.1.0_amd64.deb`

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

### 跳过服务启动（仅测试 Tauri）

如果服务已经在运行，可以直接启动桌面应用：

```bash
cd apps/desktop
STORYFORGE_DESKTOP_SKIP_SERVICES=1 pnpm tauri dev
```

## 📚 相关文档

- [README.md](./README.md) - 项目概览和环境要求
- [STATUS.md](./STATUS.md) - 开发进度和技术细节
- [CLAUDE.md](../../CLAUDE.md) - 项目整体架构

## 💡 提示

- **首次编译时间**：Rust 编译需要 5-10 分钟，请耐心等待
- **后续启动时间**：约 2-3 秒（服务启动 + 健康检查）
- **推荐配置**：16GB+ 内存，SSD 硬盘
- **开发建议**：保持 Docker Desktop 始终运行，避免每次重启容器
