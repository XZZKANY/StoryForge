# StoryForge 项目总结

生成时间：2026-06-21 00:00:00 +08:00

## 1. 项目定位

StoryForge 是面向长篇小说生产的可验证创作流水线。它把生成、检索、评审、修复、批准、回写、运行日志、制品和评测摘要串成可追溯证据链，目标是支撑可审计、可恢复、可验证的长篇创作流程，而不是只输出孤立文本。

当前产品重心已转为 Desktop IDE-first：`apps/desktop` 是主产品入口，`apps/web` 已退场。

## 2. 当前验证状态

| 验证项 | 当前结果 | 说明 |
| ------ | -------- | ---- |
| 本地 lint 门禁 | 通过 | 2026-06-20 本轮 `pnpm.cmd lint` 通过；仍有 4 个非阻断 warning，需后续清理但不阻断退出码。 |
| Desktop 定向契约 | 收口中 | Web 源码契约已从当前门禁退场，Desktop frontend typecheck/unit/smoke 承接前端验证。 |
| 真实 LLM smoke | 通过 | 1 章、3 章和 10 章 smoke 已有脱敏证据；10 章 smoke 已完成人工通读，最终门禁为 `gate: pass_for_real_10ch_final_acceptance`。 |
| 真实长程链路 | 链路通过、质量退回 | 30 章真实长程运行已完成并导出 Markdown、EPUB 和审计报告；人工通读结论为“退回重跑”。 |
| Desktop IDE Agent | 本地验证通过 | 后端 IDE Agent Orchestrator、真实修订、多视角审稿、范围控制和确认写回防御已有单元/前端冒烟记录；真实 Tauri 写回端到端未跑。 |
| 远端 E2E | 有历史通过证据 | 上一次记录的远端 `master` E2E run `26944063055` 已通过；这不是 2026-06-20 最新远端状态声明。 |

## 3. 技术栈与仓库结构

- 仓库：`https://github.com/XZZKANY/StoryForge.git`，主分支 `master`。
- 包管理器：`pnpm@9.15.4`。
- API：FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL/pgvector、Redis。
- Desktop IDE：Tauri、Vite、React、Monaco Editor、本地文件系统集成。
- Workflow：LangGraph 或本地兼容运行时，负责长任务、checkpoint、运行态记录和模型调用边界。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json`。

## 4. 当前产品边界

| 区域 | 当前对象 | 当前证据 | 当前动作 |
| ---- | -------- | -------- | -------- |
| Desktop IDE | 本地项目、文件树、Monaco、版本记录、命令面板 | 桌面前端 typecheck/unit/smoke、Rust cargo check 记录 | 打开项目、编辑文件、保存快照、触发 Agent 对话 |
| Desktop Agent | 当前文件、审稿报告、修订范围、proposed patch | `test_ide_agent_orchestrator.py`、`verify:agent-conversation` | 审稿、修订、解释、确认写回事件 |
| BookRun | Blueprint、章节计划、长程生成、导出制品 | 1/3/10 章 smoke、30 章长程、golden 回测 | 生成、审稿、修复、导出、审计 |
| API/Workflow | 业务真相源、模型调用、checkpoint、导出 | pytest、ruff、OpenAPI、golden | 持久化、验证、运行编排和制品输出 |

## 5. 当前不能承诺的能力

- 不能宣称真实 3-5 万字长程质量验收通过；30 章真实长程已完成运行但人工退回重跑。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能宣称真实 Tauri 桌面端到端写回确认链路已经完成。
- 不能承诺完整多人协作、生产级对象存储签名下载、多租户认证或全步骤 Studio 编排已经完成。

## 6. 发布前验证入口

```powershell
cd D:/StoryForge
pnpm.cmd lint
pnpm verify
pnpm e2e
pnpm test
pnpm openapi
```

验证报告必须写入 `.codex/verification-report.md`，并单独列出页面级读取、API Key 注入、Desktop IDE Agent、真实 API e2e、远程 LLM smoke、真实长程验收、远端 CI/E2E 状态、未联通能力和 OpenAPI 变化说明。

## 7. 事实来源

- 当前阶段事实以 `docs/internal/current-phase.md` 为准；PROJECT_SUMMARY 只保留项目总览、验证状态摘要和交接视角。
- `README.md`
- `docs/internal/current-phase.md`
- `docs/internal/TODO.md`
- `docs/internal/dev-plan.md`
- `.codex/verification-report.md`
