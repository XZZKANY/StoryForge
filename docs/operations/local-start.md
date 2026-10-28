# StoryForge 本地开发手册

更新时间：2026-10-16

## 1. 前置工具

- Node.js 22+（引擎测试用到 `node:sqlite`）。
- pnpm：版本以根 `package.json` 的 `packageManager`（`pnpm@9.15.4`）为准；Windows 下 `pnpm.ps1` 被执行策略拦时用 `pnpm.cmd`。
- Rust 工具链（stable）与 Tauri 2 的 Windows 依赖（WebView2、MSVC 构建工具）。
- 不需要 Python、uv、Docker、PostgreSQL、Redis 或 MinIO。

## 2. 安装依赖

```powershell
cd D:/StoryForge
pnpm install --frozen-lockfile
npm --prefix apps/desktop/frontend install
```

`apps/desktop/frontend` 是独立 npm 工程，有自己的 `package-lock.json`；根 pnpm workspace 管 `packages/engine`、`packages/project-core` 与 `apps/desktop`。

## 3. 启动桌面 IDE

```powershell
pnpm dev
```

`pnpm dev` 等价于 `pnpm desktop:dev`：先准备随包 MinGit，再由 Tauri 启动桌面 Vite（`http://localhost:3007`）和桌面窗口。TS 引擎在窗口里进程内运行，不需要任何后台服务。

首次运行可以在欢迎页「创建示例项目」，生成带正文、大纲与人物的小项目，用于试打开项目、对话、补丁与写回。

## 4. 模型配置

在应用内「设置 → 模型服务」填 provider、base URL、model 和 API key，保存即生效（不用重启）。配置写在 `%APPDATA%\com.storyforge.ide\llm-provider.json`，key 由 Rust 宿主用 Windows 用户级 DPAPI（`windows-dpapi-user-v1`）加密，只在 Rust 里解开去发请求；WebView、引擎库、日志与证据里只出现占位符。

## 5. 本机数据

如果默认配置目录不支持原子替换（例如 Windows 返回 `os error 17`），可在启动进程前设置
`STORYFORGE_CONFIG_DIR` 为另一个非空绝对目录路径。未设置时仍使用系统默认配置目录；
设置为空或相对路径会报错，不静默回退。只改变模型配置位置，不迁移现有配置、数据库或作品。
API key 仍由 Windows DPAPI 加密，已有配置须在同一 Windows 用户环境下迁移或重新填写。

smoke 模式的 `STORYFORGE_DESKTOP_SMOKE_CONFIG_DIR` 始终优先：即使日常覆盖值无效也不读取它，
缺少或非法的 smoke 隔离目录仍报错，不回落到日常目录。配置错误提示中的系统原因可用于诊断，
但仅凭错误 17 或目录的 Encrypted 属性不能断定底层文件系统原因。

| 路径 | 内容 |
| --- | --- |
| `%LOCALAPPDATA%\com.storyforge.ide\storyforge-engine.sqlite3` | 引擎库：会话、消息、工具调用、agent 运行与事件、知识提议、检查历史 |
| `%LOCALAPPDATA%\com.storyforge.ide\storyforge.sqlite3` | 旧版（Python 时期）的库；新引擎第一次打开时只读导入一次，之后不再读写 |
| `%LOCALAPPDATA%\com.storyforge.ide\shadow-git\` | 影子 git：写回前快照与版本历史 |
| `%APPDATA%\com.storyforge.ide\llm-provider.json` | 模型配置（key 加密） |
| 项目目录下 `.storyforge/` | 作品档案、canon、连载计划、agent 指令等项目级数据（跟着项目走） |

## 6. 本地门禁

```powershell
pnpm verify                                   # 提交前必跑，8 道门
npm --prefix apps/desktop run test:rust       # Rust 宿主测试
npm --prefix apps/desktop run verify:tauri-smoke   # 开发档 Tauri 冒烟（会构建并启动一个隔离的桌面窗口）
```

- `pnpm verify` 的组成见 `README.md`（本目录）第 3 节。
- `pnpm hooks:install` 启用 pre-push：lint + 前端单测 + TS 引擎。
- 单独跑某个前端测试：`npm --prefix apps/desktop/frontend run test -- tests/xxx.test.ts`；引擎：`pnpm --filter @storyforge/engine test`。

## 7. 真宿主探针

浏览器回归不经过真宿主；改了引擎与宿主之间的接口（读写口、引擎库、模型出网）要用真宿主探针验：

```powershell
cd D:/StoryForge/apps/desktop/frontend
node scripts/verify-engine-p0-native.mjs --agent-only
```

探针会构建一个 debug 宿主，用隔离的数据目录、合成项目与合成模型服务启动真 WebView。其它模式：`--cpu-only`、`--context-only`、`--reader-only`、`--llm-only`、`--assistant-only`；`--assistant-real` / `--agent-real` 复制作者的模型配置、会产生真实调用费用。本机有 StoryForge 在跑时探针按设计拒绝启动，先关掉应用。证据写在 `output/ts-engine-p*/native/`（不入库）。

## 8. Git 检查

每轮提交前：

```powershell
git status --short --branch
git diff --numstat
git diff --ignore-all-space --numstat   # 两者不一致说明改出了行尾噪音
```

仓库常驻本机脚手架与 `output/` 产物，提交一律用显式路径，不用 `git add -A`。
