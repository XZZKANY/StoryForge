## 项目上下文摘要（P2 真实 LLM 长程验收门禁）

生成时间：2026-06-03 02:38:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：真实 LLM smoke 入口支持 `chapter_count`、`token_budget`、`target_word_count`、章节字数范围，并在 preflight 缺少运行配置时失败。
  - 可复用：真实运行参数、BookRun progress、Markdown/audit artifact 摘要字段。
  - 需注意：测试中的 10 章能力使用本地 HTTPServer 模拟协议，不等同于真实外部 LLM 长程验收。
- **实现2**: `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - 模式：通过本地模拟服务验证 10 章、目标字数和 audit 字段，不触碰真实凭据。
  - 可复用：证据字段结构、密钥不进入 audit 的断言思路。
  - 需注意：不能把模拟协议测试当作真实模型产物。
- **实现3**: `.codex/verification-report.md`
  - 模式：每个阶段记录目标、范围、交付物、验证命令、评分和残留风险。
  - 可复用：本地验证报告格式和 `Scoring` 块。
  - 需注意：真实 LLM 长程缺少产物、审计报告和人工通读证据时，只能记录“门禁未满足”。

### 2. 项目约定

- **命名约定**: 文档标题使用中文阶段名；字段名保留代码契约原名，如 `book_run_id`、`tokens_used`。
- **文件组织**: 门禁上下文写入项目本地 `.codex/`；计划状态写入 `docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md`。
- **代码风格**: 本阶段不改运行代码，不读取 `.env`，不运行真实外部 LLM。
- **安全规则**: 不写入 API Key、Authorization、Bearer token、密钥前缀或可复原凭据片段。

### 3. 可复用组件清单

- `phase9b_real_llm_smoke.py`: 真实 smoke 参数与产物摘要入口。
- `test_phase9b_real_llm_smoke.py`: 模拟协议覆盖 10 章和目标字数。
- BookRun export audit: 真实长程声明必须附带 Markdown artifact 和 audit artifact。
- Judge/Repair 结果：真实长程声明必须附带质量风险和修复轮次。

### 4. 测试策略

- **本阶段验证**: 文档一致性、敏感信息扫描、`git diff --check`。
- **不执行项**: 不读取 `.env`，不运行真实外部 LLM，不用聊天中的密钥拼接命令。
- **后续真实验收**: 仅在运行环境安全注入凭据、预算齐全、产物和人工通读证据齐全时执行。

### 5. 真实 LLM 长程声明必需证据

- **运行参数**: 脱敏 Provider、脱敏 Base URL 标识、模型名、运行开始/结束时间、命令参数摘要。
- **规模参数**: `chapter_count`、`target_word_count`、每章字数范围、实际总字数统计口径。
- **预算参数**: `token_budget`、`time_budget_sec`、`chapter_budget`、completion token 上限。
- **消耗结果**: `tokens_used`、`elapsed_time_sec`、`estimated_cost`、暂停/失败原因。
- **产物引用**: `book_run_id`、`markdown_artifact_id`、`audit_artifact_id`、产物路径或 artifact download 引用。
- **质量证据**: 每章 Judge 分数、平均分、Judge issue 数、Repair rounds、降级或空响应记录。
- **人工通读**: 通读人、时间、结论、主要问题、是否允许对外声明。
- **脱敏证明**: 报告、日志、audit、CLI 输出均不包含 API Key、Authorization、Bearer token 或可复原密钥片段。

### 6. 技术选型理由

- **为什么用门禁模板**: 当前没有真实 10 章或 3-5 万字外部 LLM 产物，先把“允许声明”的证据边界固化，防止把 deterministic 或模拟协议误报为真实长程能力。
- **优势**: 不消耗真实模型预算，不引入凭据泄露风险，给后续真实验收留下可重复检查清单。
- **劣势和风险**: 文档门禁不能替代真实运行；仍需后续在安全环境中执行真实长程验收。

### 7. 关键风险点

- **安全风险**: 聊天中出现过真实接口信息，后续报告和命令不得复述或落盘任何密钥。
- **质量风险**: 1 章和 3 章真实 smoke 不能外推到 10 章或 3-5 万字。
- **统计风险**: deterministic 3-5 万字当前按现有统计口径验证，不等同于真实中文质量验收。
- **声明风险**: 长篇稳定生产必须同时满足真实运行、审计报告、成本、质量风险和人工通读。

### 8. 本轮本地模拟预检记录

更新时间：2026-06-03 06:05:00 +08:00。

- `uv run pytest tests/test_phase9b_real_llm_smoke.py -q`：7 passed。
- 覆盖范围：缺少私有运行配置时 preflight 阻止；pytest 内本地 HTTP 模拟服务覆盖 1 章与 10 章路径；目标字数和章节字数范围进入蓝图与请求 payload；Markdown 与 audit artifact 可生成；CLI 摘要保持脱敏，不输出高风险凭据字段值。
- 边界：本轮只运行 pytest 内本地模拟协议测试，不读取 `.env`，不运行真实外部 LLM，不代表真实 10 章或 3-5 万字长程验收完成。
