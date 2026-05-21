# StoryForge 项目总结

生成时间：2026-05-21 00:00:00 +08:00

## 1. 项目定位

StoryForge 是面向长篇小说生产的可验证创作流水线。它把生成、检索、评审、修复、批准、回写、运行日志、制品和评测摘要串成可追溯证据链，目标是支撑可审计、可恢复、可验证的长篇创作流程，而不是只输出孤立文本。

## 2. 技术栈与仓库结构

- 仓库：`https://github.com/XZZKANY/StoryForge.git`，主分支 `master`。
- 包管理器：`pnpm@9.15.4`。
- API：FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL/pgvector、Redis。
- Web：Next.js App Router、React、TypeScript。
- Workflow：LangGraph 或本地兼容运行时，负责长任务、checkpoint 和运行态记录。
- 共享契约：`packages/shared/src/contracts/storyforge.openapi.json`。

## 3. 当前页面边界

| 页面 | 当前对象 | 当前证据 | 当前动作 |
| --- | --- | --- | --- |
| Studio | 作品、章节、Scene Packet、Repair Patch | Judge 评审、批准摘要、失败恢复摘要 | 批准写回、刷新后复核 |
| Retrieval | 资料源、刷新任务、搜索请求 | Retrieval Hit、证据锚点 | 跳转锚点、核对检索来源 |
| Runs | JobRun | Checkpoint、ModelRun 摘要 | 查看恢复边界 |
| Artifacts | Artifact | 详情、payload 下载摘要 | 下载摘要核对 |
| Evaluations | Evaluation Run | 趋势摘要、失败样例 | 反馈入口核对 |

## 4. 当前不能承诺的能力

- Studio 还不是全步骤交互编排器。
- Retrieval 还没有独立证据详情路由和重排状态详情。
- Runs retry 只代表创建恢复任务，不代表立即续跑 workflow。
- Artifacts 还没有对象存储签名 URL、上传资料执行、快照 diff 和报告详情。
- Evaluations 还没有复杂图表、评测集管理和失败样例自动反馈执行。

## 5. 发布前验证入口

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web lint
pnpm run test
pnpm openapi
```

验证报告必须写入 `.codex/verification-report.md`，并单独列出页面级读取、API Key 注入、Studio 批准写回、Artifacts/Evaluations 读取、未联通能力和 OpenAPI 变化说明。

## 6. 事实来源

- `README.md`
- `docs/architecture/phase6-workbench-contract.md`
- `TODO.md`
- `.codex/current-phase.md`
- `.codex/operations-log.md`
- `.codex/verification-report.md`
