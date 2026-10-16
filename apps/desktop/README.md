# StoryForge Desktop IDE

本地桌面 IDE 应用：界面（React + Monaco）、TS 引擎（`packages/engine`，在 WebView 里进程内运行）与 Rust 宿主都在这一个应用里，不起任何后端进程。

## 使用语境

- **已安装应用（作者）**：NSIS 安装包内嵌 MinGit，双击即用，不需要 Node / Rust。
- **源码开发**：`pnpm desktop:dev`（等价 `pnpm dev`）启动桌面 Vite 与 Tauri 窗口。

## 环境要求（仅源码开发需要）

- Rust（stable）与 Tauri 2 的 Windows 依赖（WebView2、MSVC 构建工具）
- Node.js 22
- pnpm 9.x

## 启动

```bash
# 从项目根目录运行
pnpm install
npm --prefix apps/desktop/frontend install
pnpm desktop:dev
```

`tauri dev` 先经 `prepare:git` 准备随包 MinGit，再通过 `beforeDevCommand`（`scripts/dev-frontend.mjs`）启动或复用桌面 Vite（`http://localhost:3007`），然后打开窗口。首次运行要编译 Rust 依赖，明显慢于后续启动。

## 构建安装包

```bash
pnpm.cmd desktop:build
```

安装包在 `src-tauri/target/release/bundle/nsis/`；版本号以 `src-tauri/tauri.conf.json` 为准。直接 `pnpm tauri build` 会跳过 MinGit 准备，不要用它出分发包。发版步骤见 `docs/operations/release-checklist.md`。

## 结构

```
desktop/
├── frontend/          React + Monaco 界面；src/lib/api 是进引擎的唯一入口，src/lib/engine 装配引擎的原生读写口
├── src-tauri/         Rust 宿主
│   └── src/           fs（项目读写口）、engine_db（引擎库）、engine_llm / llm_config_store（模型出网与加密配置）、
│                      shadow_git（快照与版本）、host_close（退出握手）、smoke_ui（冒烟）
└── scripts/           Tauri 冒烟、NSIS 安装校验、随包 git 准备
```

## 验证

```bash
npm --prefix apps/desktop run test:rust          # Rust 测试
npm --prefix apps/desktop run verify:tauri-smoke # 开发档 Tauri 冒烟
npm --prefix apps/desktop run verify             # 前端全套 + Rust + Tauri 冒烟
```

真宿主探针与排障见 `docs/operations/local-start.md`、`docs/operations/troubleshooting.md`。

## 故障排查

### 桌面前端端口被占用

```bash
netstat -ano | findstr "3007"
taskkill /PID <PID> /F
```

确认占用的是自己的 Vite 再关；`tauri dev` 会复用已在 `3007` 上的 Vite。
