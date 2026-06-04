## 项目上下文摘要（真实外部 LLM 推进）

生成时间：2026-06-03 10:28:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py:49-188`
  - 模式：真实外部 LLM smoke 的权威执行入口，preflight 要求运行时环境变量齐全，支持 `chapter_count`、`token_budget`、`target_word_count`、章节字数上下限、BookRun 进度、Markdown artifact 和 audit artifact。
  - 可复用：`missing_phase9b_real_llm_env()`、`run_phase9b_real_llm_smoke()`、CLI `main()` 与 `_result_summary()`。
  - 需注意：会从运行时环境变量读取 provider 配置；本线程不得把 URL/key 写入命令、代码、日志或报告。

- **实现2**: `apps/api/tests/test_phase9b_real_llm_smoke.py:59-200`
  - 模式：用本地 HTTPServer 模拟 OpenAI 兼容协议，覆盖缺配置 preflight、1 章、10 章、目标字数、usage 记录和 audit 不含密钥。
  - 可复用：断言结构、产物字段、密钥不进入审计报告的检查思路。
  - 需注意：模拟服务通过不等于真实外部 LLM 长程完成。

- **实现3**: `apps/workflow/storyforge_workflow/provider_client.py:8-64`
  - 模式：workflow 侧 OpenAI 兼容 Chat Completions client，运行时读取配置，向 `/chat/completions` 提交 `model`、`messages`、`temperature` 等字段。
  - 可复用：环境变量读取边界、超时字段、空响应失败策略。
  - 需注意：调用边界会构造 ??? 头；任何日志与产物都不得记录该头或密钥。

- **实现4**: `apps/workflow/storyforge_workflow/runtime/provider_adapter.py:16-120`
  - 模式：ProviderRequest/ProviderResponse 不可变快照，统一记录 provider/model、latency、token_usage、prompt/completion token、cost_estimate。
  - 可复用：响应摘要字段、错误映射和 cost/token 估算思想。
  - 需注意：真实长程报告必须区分 provider_usage 与 estimated token_usage 来源。

### 2. 项目约定

- **命名约定**: 文档与日志标题使用中文；代码字段保留 `book_run_id`、`tokens_used`、`chapter_count`、`audit_artifact_id` 等既有字段名。
- **文件组织**: 本线程新增上下文、操作日志、验证报告只写入项目本地 `.codex/`；真实产物目录按阶段隔离，禁止覆盖历史产物。
- **导入顺序**: 本阶段不改业务代码；若后续改脚本，沿用 Python `from __future__`、stdlib、第三方、本地模块顺序。
- **代码风格**: 简体中文注释和文档；禁止“修改说明式”代码注释；日志记录事实、门禁与验证结果。
- **安全约定**: 不读取 `.env`；不输出、落盘或复述 ??、???、??、密钥前缀、供应商 URL 或可复原凭据片段。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: 真实 LLM BookRun smoke runner 与 CLI。
- `apps/api/app/domains/exports/book_markdown_exporter.py`: Markdown 与 audit artifact 导出能力，由 runner 间接复用。
- `apps/api/app/domains/judge/service.py`: Judge 语义与确定性检测，由 runner 间接复用。
- `apps/api/app/domains/repair/service.py`: Repair Patch 生成与写回，由 runner 间接复用。
- `apps/workflow/storyforge_workflow/provider_client.py`: OpenAI 兼容请求边界。
- `.codex/operations-log.md` 与 `.codex/verification-report.md`: 阶段审计与评分格式。

### 4. 测试策略

- **测试框架**: API 使用 `uv run pytest`；Workflow 使用 `uv run pytest`；Web 使用 pnpm/Node 测试。本阶段优先运行定向 API 测试和 runner preflight，不跑无关全量门禁。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/workflow/tests/test_llm_provider.py`、`apps/workflow/tests/test_provider_adapter.py`。
- **验证模式**:
  - 运行前：检查安全运行时环境变量是否存在，只输出存在/缺失，不输出值。
  - 1 章 smoke：真实外部 LLM，`chapter_count=1`，检查 CLI 退出码、JSON 摘要、BookRun 状态、Markdown/audit 产物、token_usage、质量风险和人工通读待办。
  - 3 章 smoke：仅在 1 章成功后执行，记录累计成本和跨章衔接风险，不宣称长程完成。
  - 10 章或 3-5 万字：仅在 3 章成本、质量和稳定性可接受后执行，必须附人工通读证据后才能声明完成。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 Chat Completions 协议；Context7 官方 API 参考确认 `model`、`messages`、`temperature`、`max_completion_tokens` 与 `usage.total_tokens` 字段。
- **内部依赖**: Book/Chapter/Scene、Blueprint、BookRun、ModelRun、ScenePacket、Judge、Repair、Artifacts、DB Session。
- **集成方式**: `phase9b_real_llm_smoke.py` 在单个数据库 session 内创建 smoke book、seed 一致性数据、创建/锁定 blueprint、生成章节、记录 ModelRun、导出制品。
- **配置来源**: 只允许当前进程运行时环境变量；不读取 `.env`，不把配置写入仓库文件。

### 6. 阶段预算门禁

#### 6.1 1 章真实 smoke（下一步优先）

- 预算授权：用户本线程确认真实外部 LLM 预算暂不封顶；工程门禁仍设置 token/time/chapter 中止条件。
- 章节数：1。
- 目标字数：约 1200 字；章节字数下限 600，上限 1600。
- token 预算：60000。
- 单请求超时：60 秒。
- BookRun 时间预算：900 秒。
- 外层命令超时：1200 秒。
- 中止条件：安全环境变量缺失；preflight 失败；HTTP/Provider 错误；空响应；token 超过预算；BookRun 非 completed；缺 Markdown 或 audit artifact；audit 缺章节证据；Judge 降级或高严重度质量问题未记录；任何输出疑似包含凭据。
- 预期产物：隔离目录中的 `book.md`、`audit_report.json`、脱敏运行摘要、operations-log 条目、verification-report 阶段报告、人工通读待办。

#### 6.2 3 章真实 smoke（1 章通过后）

- 章节数：3。
- 目标字数：约 3600 字；章节字数下限 600，上限 1600。
- token 预算：180000。
- 单请求超时：60 秒。
- BookRun 时间预算：2700 秒。
- 外层命令超时：3600 秒。
- 中止条件：沿用 1 章门禁，并额外检查跨章衔接、累计成本和重复/漂移风险。
- 预期产物：3 章 Markdown、audit、每章 token/quality 记录、阶段成本统计、质量风险与人工通读待办。

#### 6.3 10 章或 3-5 万字真实长程（3 章通过后再决策）

- 章节数：10。
- 目标字数：50000；章节字数下限 3000，上限 5000。
- token 预算：先按 3 章真实消耗估算后确定，初始硬中止建议不低于 800000；执行前必须重新写入最终预算。
- 单请求超时：执行前按模型实际响应时间重新确认，默认不低于 60 秒。
- BookRun 时间预算：执行前按 3 章真实耗时线性估算并加缓冲；默认不低于 9000 秒。
- 外层命令超时：执行前单独确认。
- 完成声明条件：真实运行证据、产物、审计报告、成本统计、质量风险记录、人工通读证据全部齐备；缺任一项只能记录“未完成”。

### 7. 关键风险点

- **凭据泄露**: 最大风险；所有命令、日志、报告和测试输出必须避免 URL/key/???/??。
- **短 smoke 误用**: 1 章/3 章只能证明连接与局部链路，不能证明 10 章或 3-5 万字完成。
- **成本不可控**: 用户授权预算暂不封顶，但工程上仍需 token/time 中止，运行后必须统计消耗。
- **质量不可证**: audit 产物不能替代人工通读；长程声明必须有人工通读证据。
- **运行污染**: 当前 `.codex` 有大量历史产物；本线程产物必须隔离目录，避免覆盖或混淆历史证据。
- **配置来源混淆**: 禁止使用旧线程 provider 信息；只接受本线程安全注入的运行时环境变量。

### 8. 上下文充分性检查

- □ 我能说出至少 3 个相似实现路径：是，见第 1 节 4 个实现。
- □ 我理解项目实现模式：是，真实 LLM runner 复用 BookRun/Blueprint/Judge/Repair/Artifacts，不新增 Agent 框架。
- □ 我知道可复用组件：是，见第 3 节。
- □ 我理解命名与风格：是，中文日志/文档，代码字段沿用既有契约。
- □ 我知道如何测试：是，按 preflight、1 章真实 smoke、3 章 smoke、长程门禁分级验证。
- □ 我确认不重复造轮子：是，直接复用 `phase9b_real_llm_smoke.py` 和既有审计格式。
- □ 我理解依赖和集成点：是，见第 5 节。

## 项目上下文摘要（真实 LLM summary 多章字符统计）

生成时间：2026-06-03 11:46:37 +08:00

### 相似实现分析

- pps/api/app/domains/exports/book_markdown_exporter.py：Markdown 导出使用 ## 第 N 章 标题 作为章节分隔，正文来自已批准 scene content。
- pps/api/app/domains/book_runs/phase9b_real_llm_smoke.py：CLI runner 已负责真实 LLM 冒烟、预算门禁、摘要输出和审计制品引用。
- pps/api/tests/test_phase9b_real_llm_smoke.py：pytest 使用 fake session 与 runner stub 验证 CLI 摘要不泄露私有配置，并验证 summary.json 脱敏字段。

### 项目约定

- Python 使用 snake_case、私有 helper、pytest 断言和 Ruff 门禁。
- 审计产物必须写入 .codex/operations-log.md 与 .codex/verification-report.md。
- 真实 provider 配置仅允许通过运行时环境变量进入，不写入仓库文件。

### 可复用组件清单

- _artifact_text()：统一读取 artifact payload 文本。
- _body_char_count()：保留单章正文字符统计行为。
- export_book_run_markdown()：定义 Markdown 章节结构事实源。

### 测试策略

- 目标测试覆盖 --summary-output 与多章逐章字符统计。
- 全文件测试覆盖真实 LLM smoke runner 的 preflight、预算、CLI 摘要和 schema 注册。
- Ruff 与 diff check 作为格式和空白门禁。

### 依赖和集成点

- summary.json 是后续真实 10 章或 3-5 万字验收的脱敏证据入口。
- 后续真实运行仍需记录产物 ID、审计报告 ID、成本统计、质量风险和人工通读待办。

### 风险点

- 不能用本地测试或 1/3 章 smoke 宣称长程完成。
- 多章字符统计只证明 Markdown 产物结构可审计，不替代真实外部 LLM 运行证据。

## 项目上下文摘要（真实 LLM 1 章 smoke 验收）

生成时间：2026-06-03 15:18:14 +08:00

### 1. 当前证据

- 真实 1 章产物目录：.codex/real-llm-1ch-20260603-142925
- BookRun 状态：completed
- 实际章节数：1
- token 消耗：3047
- 正文字符数：2364
- Markdown artifact ID：1
- audit artifact ID：2
- 脱敏验收 gate：pass_for_current_smoke_scope

### 2. 项目约定

- 不读取 .env。
- 不输出或落盘 provider URL/key。
- 1 章 smoke 不能代表 3 章或长程完成。
- 进入 3 章前必须补人工通读结论。

### 3. 风险点

- 实际模型与脚本默认模型不同，后续必须继续记录。
- 本次使用一次性 SQLite 数据库，不能证明默认 Postgres 或跨卷生产稳定性。
- 真实 10 章或 3-5 万字仍缺运行证据、产物、审计报告、成本统计、质量风险和人工通读证据。

### 4. 下一步

- 完成人工通读并更新 human-readthrough-todo.md。
- 若人工通读通过，再执行 3 章真实 smoke。
