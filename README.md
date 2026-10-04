<h1 align="center">StoryForge</h1>

<p align="center">面向长篇小说创作的桌面 AI 写作 IDE </p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="Python 3.11+" src="https://img.shields.io/badge/python-3.11%2B-blue.svg" />
  <img alt="pnpm 9" src="https://img.shields.io/badge/pnpm-9.15.4-orange.svg" />
  <img alt="Built with Tauri" src="https://img.shields.io/badge/desktop-Tauri-24C8D8.svg" />
</p>

StoryForge 不是一个"一键出书"的自动生成器，而是一个把工程化工作流带进小说创作的本地写作工作台：打开本地小说项目，与对话式 Agent 讨论剧情、做多视角审稿、让它产出修订补丁，作者看清 diff 后决定接不接受——所有落盘都经过快照与版本记录，随时可以回滚。

## 亮点

- **本地项目 IDE**：打开本地小说项目，文件树浏览、Monaco 编辑、项目全文搜索、版本快照、明暗双主题。
- **对话式 Agent**：用自然语言提要求，Agent 自主调用只读工具（列目录 / 读文件 / 跨文件检索）收集证据，再作答或生成补丁；支持多视角审稿、定向修订、新文件起草。
- **安全的写回链路**：后端绝不直接写盘，一切修订都是 proposed patch；落盘一律经过写前快照 → 原子写 → 版本记录。项目级权限档位（只读 / 询问 / 自动 / 完全放行）决定要不要逐次确认。
- **一致性工具链**：canon 防漂移、机械一致性扫描、文笔静态检查、场景承重分析等确定性工具，挂进 Agent 循环辅助审阅。
- **可定制**：在项目内写 `.storyforge/agent-instructions.md` 就能调整 Agent 的语气、审稿口径和风格禁忌，不改代码即生效。
- **可审计的生成流水线**（后台工具）：设定 → 章节目标 → 检索证据 → 逐章生成 → 审稿修复 → 制品导出（Markdown / EPUB / 审计报告），作为后台 Writing Run 保留，不是主产品入口。

## 快速开始

前置条件：Node.js、pnpm 9.15.4、Python 3.11+、uv、Docker Compose。

```powershell
git clone https://github.com/XZZKANY/StoryForge.git
cd StoryForge
Copy-Item .env.example .env
pnpm install
npm --prefix apps/desktop/frontend install
docker compose up -d postgres redis minio
pnpm dev
```

- Desktop IDE：`pnpm dev`（devUrl http://localhost:3007）
- API：http://localhost:8000；MinIO Console：http://localhost:9001
- 本地默认走 deterministic/mock provider，无需真实 LLM 密钥即可跑通基础验证
- Windows PowerShell 若拦截 `pnpm.ps1`，改用 `pnpm.cmd dev`

更多说明见 [本地启动](docs/operations/local-start.md) 与 [故障排查](docs/operations/troubleshooting.md)。

## 常用命令

```powershell
pnpm dev             # 启动桌面 IDE 主体验
pnpm desktop:build   # 构建桌面安装包
pnpm verify          # 提交前总门禁：lint + typecheck + 各栈测试 + sidecar smoke + OpenAPI 漂移
pnpm test            # 全量跑 Desktop、Shared、project-core、API 测试
pnpm e2e             # 秒级契约断言（不重复跑 pytest）
pnpm openapi         # 重新生成 OpenAPI 契约
pnpm lint:fix        # 自动修复格式与 lint
```

## 仓库结构

```text
StoryForge/
├── apps/
│   ├── api/        # FastAPI 业务 API：领域模型、运行时、迁移和测试
│   └── desktop/    # Tauri 桌面 IDE，唯一主产品体验
├── packages/
│   └── shared/     # OpenAPI 生成类型、共享契约
├── docs/           # 架构文档、阶段事实源、运维手册
├── scripts/        # 本地验证、OpenAPI 生成、开发启动脚本
└── tests/          # 跨服务 e2e 与契约测试
```

技术栈：Tauri + React + Vite + Monaco Editor，FastAPI + SQLAlchemy + Alembic，PostgreSQL + pgvector / Redis / MinIO，pnpm + uv + pytest + Ruff；API 与客户端之间以 OpenAPI 为硬契约。

## 项目状态

当前处于自研自用（dogfooding）阶段，核心方向已经收敛为桌面 IDE，但**还不是成熟商用产品**：

- 已完成两轮真实 Tauri 桌面端到端验收并锁版 `v0.1.2`；此后以真实写作驱动小步打磨，未发新版。
- 真实 LLM 小规模生成（1/3/10 章）smoke 通过且 10 章样例已人工通读；一次 30 章长程跑通链路并导出制品，但人工通读退回——**尚不能宣称稳定生产级长篇质量**。
- 全权限档位 GUI、安装器和多 provider 的端到端验收仍在补全，见 [当前阶段事实源](docs/internal/current-phase.md)。

详细的验证记录、边界声明与未完成项均以 [`docs/internal/current-phase.md`](docs/internal/current-phase.md) 为唯一事实源，本文件不逐日更新。

## 路线图

一条"写 → 发 → 收集信号 → 喂回来"的飞轮：

1. **编辑器安全可日更** ✅ 已封板（tag `v0.1.2`）。
2. **在编辑器上写作品** 🚧 进行中：手稿保险 + 真实连载 dogfood，摩擦日志驱动 QoL 打磨。
3. **发布与信号采集**：发布平台、如实标注 AI、采集跟读率与读者信号。
4. **喂回与进化**：读者信号沉淀为 playbook，反哺 Agent 工具与编辑器。

当前下一步入口见 [`docs/internal/TODO.md`](docs/internal/TODO.md)。

## 文档

| 面向 | 入口 |
| --- | --- |
| 当前阶段与验证边界 | [`docs/internal/current-phase.md`](docs/internal/current-phase.md) |
| 工程约定（AI 协作 / 架构规则） | [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) |
| 产品方向说明 | [`docs/architecture/ide-first-product-direction.md`](docs/architecture/ide-first-product-direction.md) |
| 本地启动 / 排障 / 发布检查 | [`docs/operations/`](docs/operations/) |

## 贡献

欢迎 Issue 和 PR。提交前至少跑 `pnpm verify`（总门禁，含各栈测试与 OpenAPI 漂移检查）。注意：

- Python 遵循 Ruff，TypeScript 遵循 ESLint + Prettier。
- 改路由 / DTO / OpenAPI 输出后必须跑 `pnpm openapi` 并检查契约 diff。
- 涉及数据库变更必须有 Alembic migration（保持单 head，提供可用 downgrade）。
- 不要提交真实 provider token、API key 或未脱敏运行日志。

更多约定见 [`CLAUDE.md`](CLAUDE.md)。

## License

[MIT](LICENSE)
