# StoryForge 当前阶段事实源

生成时间：2026-05-27 19:10:00 +08:00

## 当前阶段

StoryForge 当前处于 Phase 9 本地闭环补强阶段。Phase 9A、Phase 9B 本地控制面、Phase 9C 本地增强项已有本地验证证据；真实 LLM、远端 CI/E2E、真实长篇和人工通读仍未完成。

## 已完成的本地能力边界

- **BookRun 最小全书闭环**：本地 deterministic/mock provider 可从 Blueprint 章节计划驱动 3 章 BookRun，并导出 `book.md` 与 `audit_report.json`。
- **BookRun 控制面**：已具备 checkpoint resume、token/时间/章节预算暂停、provider 连续降级暂停和成本摘要。
- **长程质量增强**：Story Memory 注入/抽取、Character Bible、Timeline Guard、Style Guard、章节 pacing 和审计页已纳入本地测试。
- **出版制品**：BookRun 可生成 Markdown、EPUB 与审计报告制品索引。

## 真实 LLM 冒烟入口

设置私有环境变量后，可执行以下命令验证 9B-4a 与 9B-4b：

```powershell
cd apps/api
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 1 --token-budget 8000
uv run python -m app.domains.book_runs.phase9b_real_llm_smoke --chapter-count 3 --token-budget 24000
```

当前环境中 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER` 均未设置，因此 9B-4a 与 9B-4b 仍未完成。

## 仍未完成的验收项

- 真实 LLM 下 3 章 BookRun 自动 completed。
- 远端 GitHub Actions `CI` 与 `E2E` 通过证据。
- 真实 LLM 跑完 3-5 万字短篇。
- 人工通读记录写入 `.codex/verification-report.md`，且无明显人物、世界观或时间线矛盾。

## 禁止宣称范围

在上述未完成项补齐前，只能宣称 StoryForge 已具备本地可验证的最小整书闭环和审计增强；不能宣称真实模型下已能稳定产出一本最小可审计小说，也不能宣称具备稳定生产级长篇生产闭环。

## 证据源

- `.dev_plan.md`：Phase 9 计划、勾选状态和完成判定。
- `.codex/verification-report.md`：本地测试、红绿记录、真实 LLM 环境缺口和质量评分。
- `README.md`：面向使用者的能力边界摘要。
