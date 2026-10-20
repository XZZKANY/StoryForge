# StoryForge Desktop IDE 使用指南

## 快速开始

```bash
# 在项目根目录运行
pnpm install
npm --prefix apps/desktop/frontend install
pnpm desktop:dev
```

桌面窗口打开后即可使用；TS 引擎在窗口里进程内运行，不需要 Docker、数据库或任何后台服务。首次运行要编译 Rust 依赖，耗时明显更长。

## 作者主流程

1. 欢迎页 / 作品库创建或打开本地小说项目（可「创建示例项目」先试）。
2. 工作台用 Monaco 编辑器写作；左侧文件树、手稿视图、观测镜、版本快照、命令面板可用。
3. 与对话式 Agent 讨论：审稿、定向修订、新文件起草都以 proposed patch 返回；Ctrl+K 行间改写、Ctrl+Shift+K 光标处续写。
4. 按项目权限档位（对话输入框下方的下拉）处理补丁：「只读」只读项目、只回答，不产生任何改动（Ctrl+K / Ctrl+Shift+K 也不能发起）；「询问」每个补丁都要你在 diff 里点接受；「自动」免点击直接写盘，但仍走写前快照 → 原子写 → 版本记录的 guarded writeback，可撤销。旧的「完全放行」档按「自动」显示。
5. 「设置 → 模型服务」配置 provider、base URL、model 与 API key（Windows 用户级 DPAPI 加密存本机），保存即生效。

## 常见操作

### 停止应用

关闭桌面窗口，或在启动终端按 `Ctrl+C`。窗口关闭时宿主会等前端停手、在途写回结算完再退出（有 10 秒期限）；没结算完的写回下次打开时会提示只读核对。

### 查看日志

启动终端里是 Vite 与 Rust 宿主的输出。Agent 运行的事件、工具调用与生成来源记录在引擎库里（`%LOCALAPPDATA%\com.storyforge.ide\storyforge-engine.sqlite3`）。

### 构建安装包

```bash
pnpm.cmd desktop:build
```

Windows 安装包在 `src-tauri/target/release/bundle/nsis/StoryForge IDE_<version>_x64-setup.exe`（版本号以 `src-tauri/tauri.conf.json` 为准）。`targets: all` 不代表各平台安装包都已验收；当前只验 Windows NSIS。

## 故障排查

### 端口被占用

桌面 Vite 用 `3007`：

```bash
netstat -ano | findstr "3007"   # Windows
lsof -i :3007                   # macOS / Linux
```

确认占用的是自己的 Vite 再关；`tauri dev` 会复用已在 `3007` 上的 Vite。

### Rust 编译失败

```bash
rustup update
cd apps/desktop/src-tauri
cargo clean
cargo build
```

更多排障见 [`docs/operations/troubleshooting.md`](../../docs/operations/troubleshooting.md)。

## 相关文档

- [README.md](./README.md) - 应用概览、结构与环境要求
- [STATUS.md](./STATUS.md) - 2026-06 原型阶段报告（历史记录，非当前能力清单）
- [CLAUDE.md](../../CLAUDE.md) - 项目整体架构与协作约定
