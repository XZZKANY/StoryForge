# StoryForge 项目健康评估设计方案

生成时间：2026-06-01 04:05:00 +08:00

## 1. 背景与目标

StoryForge 已完成 BookRun workflow adapter recorded skill_runs 的本地合并，当前系统具备从 workflow 产出 recorded skill_runs、经 API exporter 投影并由 Web 审计页展示的基础链路。下一步不应马上继续扩大功能面，而应先做一次限时、决策型的项目健康评估，确认主链路、测试边界、架构风险和下一批最高收益任务。

本评估目标不是重构，也不是生成泛泛审计报告，而是在 1 个工作日内产出可执行路线图，回答：

1. 当前主运行链路是否清晰、可跑、可本地验证？
2. 哪些架构债务会阻碍下一阶段真实生产接线？
3. 下一批任务应该按什么优先级推进？

## 2. 设计原则

1. **决策优先**：评估结果必须能直接决定下一步做什么，而不是堆叠观察。
2. **限时边界**：本轮评估控制在 1 个工作日内，不做大规模代码修改。
3. **运行时事实优先**：以本地测试、命令输出、当前源码和已提交计划为准，避免凭印象判断。
4. **主链路优先**：优先评估 BookRun 从 API 创建、workflow 执行、progress 回填、audit/export 到 Web 展示的链路。
5. **风险排序优先**：所有问题必须按影响、紧急度、修复成本排序，避免无差别列债务。
6. **本地可验证优先**：所有结论必须附带本地命令、文件证据或明确的未验证原因。

## 3. 非目标

本轮明确不做：

- 不实现新的 BookRun 生产接线。
- 不把 LangGraph 节点事件映射成章节 skill_runs。
- 不重构 phase9b_real_llm_smoke.py。
- 不修改 API service 的运行语义。
- 不新增外部依赖或新工具链。
- 不清理与评估无关的历史 stash 或个人工作文件。

## 4. 评估范围

### 4.1 主链路

- API BookRun 创建、读取、progress patch、resume。
- workflow BookRun adapter、BookLoop、NovelLoop、NovelSkillRunner。
- audit projection 对 recorded、reconstructed、mixed evidence 的处理。
- exporter 对 book.md、audit_report.json 的生成。
- Web BookRun 审计面板对 skill_chain 的展示。

### 4.2 质量与验证

- workflow pytest 与 ruff。
- API pytest 与 ruff。
- Web contract test。
- 现有 smoke、phase9b、real LLM 脚本与主线测试的边界。
- warning、跳过测试、慢测试、脆弱测试的风险。

### 4.3 架构边界

- API 真相源与 workflow 编排边界。
- SkillRunner 与 LangGraph 的职责边界。
- progress checkpoint、audit projection、export artifacts 的数据边界。
- 静态定义、状态映射、source_refs、诊断层的维护风险。

## 5. 输出物

本轮评估必须产生以下文件：

- `D:\StoryForge\.codex\context-summary-project-health.md`：项目事实摘要和证据索引。
- `D:\StoryForge\.codex\project-health-assessment.md`：完整评估报告、评分、风险排序和路线图。
- `D:\StoryForge\.codex\verification-report.md`：追加本轮本地验证命令和结果。
- `D:\StoryForge\.codex\operations-log.md`：追加执行过程、偏离项和补救记录。

## 6. 评分模型

总分 100 分：

- 主链路可验证性：25 分。
- 架构边界清晰度：20 分。
- 测试覆盖与本地门禁：20 分。
- 审计与数据最小暴露：15 分。
- 维护性与后续扩展成本：10 分。
- 文档与操作留痕：10 分。

结论分级：

- 90-100：可继续推进真实生产接线。
- 80-89：可推进小范围功能，但需先处理 Top 风险。
- 70-79：建议先做治理任务，不建议扩大功能面。
- 70 以下：暂停新功能，先修主链路和验证能力。

## 7. 决策输出格式

评估报告最后必须给出：

1. 当前总体结论。
2. Top 5 架构风险。
3. Top 5 测试或验证缺口。
4. 下一批推荐任务，分为：必做、高收益、可延后、不建议现在做。
5. 明确建议：继续真实接线、先补诊断层、先重构 smoke，或暂停新功能治理基础设施。

## 8. 成功标准

- 所有评估结论均能追溯到本地命令输出或源码路径。
- 报告没有 TBD、TODO、未解释的主观判断。
- 至少覆盖 workflow、API、Web 三个子系统。
- 至少运行 workflow/API 的 lint 与测试，以及 Web 审计相关测试。
- 最终路线图能直接转化为下一份 implementation plan。
