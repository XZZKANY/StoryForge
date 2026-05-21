# StoryForge 修复后全流程验证报告

生成时间：2026-05-21 21:15:00

## 1. 验证目标

在真实 OpenAI 兼容 API 环境变量存在的情况下，修复并复跑 StoryForge 本地全流程验证，确保测试不被远程模型输出污染，E2E 契约与当前页面边界一致。

## 2. 敏感信息处理

- API 地址：`https://dc.hhhl.cc/v1`
- API Key：已隐藏，未写入本报告、操作日志或源码文件。
- 真实 LLM 冒烟：此前已通过，返回非空中文响应。

## 3. 根因与修复摘要

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| API 单测 `test_judge_repair.py` 在真实密钥下不稳定 | `semantic_judge` 读取 `STORYFORGE_LLM_API_KEY` 后调用远程模型，返回非确定性 span/replacement | 在 `apps/api/tests/conftest.py` 增加 autouse fixture，隔离远程 Judge/LLM 环境变量 |
| E2E Phase 2/3 读取缺失页面 | 契约仍引用已退役或未验证的旧前端入口 | 更新 phase2/phase3 契约到当前保留入口和退役边界证据 |
| Phase 4 首页 marker 不匹配 | 契约文案未跟随当前首页标题 | 将 marker 对齐为 `Retrieval 证据链路`、`Evaluations 评测诊断` |
| workflow pytest 临时目录/SQLite 不稳定 | 默认临时目录和共享 `.runtime` SQLite 会受本地权限或状态污染 | 固定 `.pytest-tmp`，并为每个 workflow 测试注入独立 SQLite 路径 |
## 4. 复跑命令记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `uv run pytest tests/test_judge_repair.py -q` | 通过 | 带真实 LLM 环境变量复跑，`1 passed` |
| `node scripts/run-e2e.mjs tests/e2e/phase2-contract.spec.ts tests/e2e/phase3-contract.spec.ts tests/e2e/phase4-contract.spec.ts` | 通过 | 9 项契约测试全通过，API/workflow 补偿验证通过 |
| `uv run pytest`（`apps/workflow`） | 通过 | 13 项全通过 |
| `pnpm run test` | 通过 | Web 7 项、shared 类型检查、API 147 项、workflow 13 项均通过 |
| `pnpm run e2e` | 通过 | 14 项 Node 契约测试通过；API 补偿 7 项、workflow 补偿 8 项通过 |
| `pnpm openapi` | 通过 | 已生成 `packages/shared/src/contracts/storyforge.openapi.json` |

## 5. 审查清单

- 需求字段完整性：已覆盖目标、范围、交付物、审查要点。
- 原始意图覆盖：真实 API 已验证，本地全流程已修复并复跑。
- 交付物映射：代码、测试契约、操作日志、验证报告均已更新。
- 依赖与风险评估：已处理远程模型污染、E2E 陈旧契约、pytest 临时目录和 SQLite 状态污染。
- 审查结论留痕：本报告包含时间戳、命令记录、评分和结论。
## 6. 评分

### 技术维度评分：94/100

- 代码质量：修复集中在测试隔离、契约对齐和 pytest 配置，未扩大业务能力声明。
- 测试覆盖：targeted、根级 test、E2E、OpenAPI 均本地通过。
- 规范遵循：密钥未落盘，文档和日志为简体中文。

### 战略维度评分：93/100

- 需求匹配：已完成“讨论/修复后复跑”。
- 架构一致：复用现有 provider、pytest fixture、node:test 契约和根脚本。
- 风险评估：当前 Phase 2/3 契约明确记录退役边界，避免误报旧功能仍可用。

### 综合评分：94/100

建议：通过。

## 7. 结论

- 真实 LLM API：通过。
- 本地依赖与容器：此前已通过。
- `pnpm run test`：通过。
- `pnpm run e2e`：通过。
- `pnpm openapi`：通过。
- 当前交付建议：通过，可进入后续审阅或提交阶段。