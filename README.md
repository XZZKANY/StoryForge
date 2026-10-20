<h1 align="center">StoryForge</h1>

<p align="center">面向长篇小说创作的桌面 AI 写作 IDE </p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="pnpm 9" src="https://img.shields.io/badge/pnpm-9.15.4-orange.svg" />
  <img alt="Built with Tauri" src="https://img.shields.io/badge/desktop-Tauri-24C8D8.svg" />
</p>

StoryForge 不是一个"一键出书"的自动生成器，而是一个把工程化工作流带进小说创作的本地写作工作台：打开本地小说项目，与对话式 Agent 讨论剧情、做多视角审稿、让它产出修订补丁，作者看清 diff 后决定接不接受——所有落盘都经过快照与版本记录，随时可以回滚。

## 亮点

- **本地项目 IDE**：打开本地小说项目，文件树浏览、Monaco 编辑、项目全文搜索、版本快照、可调外观。
- **对话式 Agent**：用自然语言提要求，Agent 自主调用只读工具（列目录 / 读文件 / 跨文件检索）收集证据，再作答或生成补丁；支持多视角审稿、定向修订、新文件起草、写章检查。
- **行间协作**：Ctrl+K 在光标处改写选中段落，Ctrl+Shift+K 从光标处续写，Alt+Enter 接受。
- **安全的写回链路**：Agent 只产出 proposed patch，从不直接写盘；落盘一律经过写前快照 → 原子写 → 版本记录。项目级权限档位（只读 / 询问 / 自动）决定要不要逐次确认。
- **一致性工具链**：canon 防漂移、机械一致性扫描、文笔静态检查、跨章一致性等确定性工具，挂进 Agent 循环辅助审阅。
- **可定制**：在项目内写 `.storyforge/agent-instructions.md` 就能调整 Agent 的语气、审稿口径和风格禁忌。
- **纯本地**：没有服务端；模型 key 用 Windows 用户级 DPAPI 加密存在本机，只在 Rust 宿主里使用。

## 快速开始

前置条件：Node.js 22、pnpm 9.15.4、Rust 工具链与 Tauri 2 的 Windows 依赖。

```powershell
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
pnpm install
npm --prefix apps/desktop/frontend install
pnpm dev
```

启动后在「设置 → 模型服务」填上自己的 provider / model / API key 即可对话。Windows PowerShell 若拦截 `pnpm.ps1`，改用 `pnpm.cmd dev`。更多说明见 [本地开发](docs/operations/local-start.md) 与 [故障排查](docs/operations/troubleshooting.md)。

## 常用命令

```powershell
pnpm dev             # 启动桌面 IDE
pnpm desktop:build   # 打 NSIS 安装包
pnpm verify          # 提交前总门禁：lint、类型检查、引擎与前端测试、三个浏览器回归
pnpm test            # 加跑 Rust 测试与 Tauri 冒烟
pnpm lint:fix        # 自动修复格式与 lint
```

## 仓库结构

```text
StoryForge/
├── apps/
│   └── desktop/          # Tauri 桌面 IDE：frontend/（React + Monaco）、src-tauri/（Rust 宿主）
├── packages/
│   ├── engine/           # TS 引擎：agent 循环、修订 / 续写、IDE 命令、知识与检查、模型协议
│   └── project-core/     # 路径围栏等共享内核
├── docs/                 # 架构文档、阶段事实源、运维手册
└── scripts/              # 本地门禁与生成脚本
```

技术栈：Tauri 2 + React 18 + Vite + Monaco Editor；TS 引擎在桌面 WebView 里进程内运行，Rust 宿主负责本地文件、SQLite 引擎库、模型出网与影子 git 快照。2026-10 之前业务逻辑在一个 Python（FastAPI）后端里，已逐模块迁到 TS 引擎并删除。

## 项目状态

自研自用（dogfooding）阶段，**还不是成熟商用产品**：

- 2026-10-16 完成后端迁移：业务逻辑全部在 TS 引擎里，仓库里不再有 Python；0.2.0 是第一个这样的装机版（10-17 交付），下一版是 0.2.1。新引擎在作者真实写作里的表现还没有记录，目前只有门禁、浏览器回归、真宿主探针与安装冒烟的证据。
- 真实 LLM 小规模生成（1/3/10 章）smoke 通过且 10 章样例已人工通读；一次 30 章长程人工通读退回——**尚不能宣称稳定生产级长篇质量**。

详细的验证记录、边界声明与未完成项以 [`docs/internal/current-phase.md`](docs/internal/current-phase.md) 为准。

## 路线图

一条"写 → 发 → 收集信号 → 喂回来"的飞轮：

1. **编辑器安全可日更** ✅ 已封板（tag `v0.1.2`）。
2. **在编辑器上写作品** 🚧 进行中：真实连载 dogfood，摩擦驱动打磨。
3. **发布与信号采集**：发布平台、如实标注 AI、采集跟读率与读者信号。
4. **喂回与进化**：读者信号沉淀为 playbook，反哺 Agent 工具与编辑器。

当前下一步入口见 [`docs/internal/TODO.md`](docs/internal/TODO.md)。

## 文档

| 面向 | 入口 |
| --- | --- |
| 当前阶段与验证边界 | [`docs/internal/current-phase.md`](docs/internal/current-phase.md) |
| 工程约定（AI 协作 / 架构规则） | [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) |
| 后端迁移计划与进度 | [`docs/architecture/ts-engine-migration-plan.md`](docs/architecture/ts-engine-migration-plan.md) |
| 本地开发 / 排障 / 发版 | [`docs/operations/`](docs/operations/) |

## 贡献

欢迎 Issue 和 PR。提交前至少跑 `pnpm verify`。注意：

- TypeScript 遵循 ESLint + Prettier；Rust 新代码按 rustfmt 排版（既有文件尚未全量格式化，别顺手重排）。
- 改引擎库 schema 只能在 `packages/engine/src/store/schema.ts` 末尾追加迁移，不改已发布的条目。
- 不要提交真实 provider token、API key 或未脱敏运行日志。

更多约定见 [`CLAUDE.md`](CLAUDE.md)。

## License

[MIT](LICENSE)
