## 项目上下文摘要（Phase 9B 真实 LLM 冒烟入口）

生成时间：2026-05-27 18:48:00 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/book_runs/deterministic_smoke.py`: 9A deterministic 冒烟已能创建 Book、Blueprint、BookRun、Scene、ModelRun、JudgeIssue，并导出 `book.md` 与 `audit_report.json`。
- `apps/workflow/storyforge_workflow/provider_client.py`: 通过 OpenAI 兼容 `/chat/completions` 调用真实模型，缺少 `STORYFORGE_LLM_API_KEY` 时显式失败。
- `apps/workflow/tests/test_llm_provider.py`: 用本地 HTTPServer 验证 OpenAI 兼容协议，不接触真实密钥。

### 2. 项目约定

- Python 服务模块使用 `from __future__ import annotations`、类型标注和简体中文 docstring。
- API 服务层直接接收 SQLAlchemy `Session`，错误类型继承既有 `InputError` / `RuntimeError` 风格。
- 测试使用 pytest、内存 SQLite、`session_factory` 夹具和本地 HTTPServer 模拟外部协议。

### 3. 可复用组件清单

- `create_book_blueprint()` / `lock_book_blueprint()` / `trigger_chapter_plan()`：复用 Blueprint 到章节计划链路。
- `create_book_run()` / `apply_book_run_progress()`：复用 BookRun 状态、预算和 checkpoint 回填。
- `create_model_run()`：复用模型运行真表与 token 记录。
- `export_book_run_markdown()` / `export_book_run_audit_report()`：复用导出制品。

### 4. 测试策略

- 先新增 `apps/api/tests/test_phase9b_real_llm_smoke.py`，导入尚不存在的模块以获得红灯。
- 用本地 HTTPServer 模拟 OpenAI 兼容响应，验证会真实发起 HTTP 请求、记录 token、完成 BookRun 并导出制品。
- 再验证缺少真实 LLM 环境变量时返回明确缺口，且不打印密钥。

### 5. 依赖和集成点

- 输入：私有环境变量 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER`。
- 输出：BookRun completed、ModelRun token 记录、approved Scene、`book.md`、`audit_report.json`。
- 风险：真实 provider token usage 可能缺失；实现应使用 provider usage 优先，缺失时记录保守估算并在 payload 标明来源。
## 项目上下文摘要（Phase 9B 真实 LLM smoke 10 章与字数参数）

生成时间：2026-06-02 18:05:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：真实 OpenAI 兼容端点通过 `urllib.request` 调用，`run_phase9b_real_llm_smoke` 串联蓝图、BookRun、章节生成、Judge/Repair、Markdown 与 audit 导出。
  - 可复用：`_call_llm`、`_generate_chapter`、`_judge_and_repair_loop`、`_result_summary`。
  - 需注意：当前 `_assert_preflight` 与 CLI `choices=[1, 3]` 限制章节数；`_blueprint_payload` 固定推导 `target_word_count` 与章节字数上下限。
- **实现2**: `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - 模式：本地 `HTTPServer` 模拟 Chat Completions，记录请求头和 payload，避免真实 LLM 调用。
  - 可复用：`_Phase9BChatHandler.requests` 记录所有请求；测试断言 `Authorization` 只在请求头中出现，audit/CLI 摘要不泄露密钥。
  - 需注意：新增 10 章测试会产生 10 次生成请求与 10 次 Judge 请求。
- **实现3**: `apps/api/app/domains/book_runs/deterministic_smoke.py`
  - 模式：`run_phase9a_deterministic_smoke` 已支持 `chapter_count=10` 与 `target_word_count=50000`。
  - 可复用：蓝图载荷显式接收 `target_word_count` 的参数化方式。
  - 需注意：真实 LLM smoke 保留私有环境 preflight、token budget 与网络模拟边界，不抽取公共模块。
- **实现4**: `apps/api/tests/test_phase9a_deterministic_smoke.py`
  - 模式：验证 10 章导出、Markdown 章节标题、audit chapters 数量。
  - 可复用：10 章断言结构与 audit 章节完整性断言。
  - 需注意：真实 LLM 测试不统计真实长正文词数，重点验证目标字数进入蓝图/prompt。

### 2. 项目约定

- **命名约定**: Python 使用 `snake_case` 函数、参数和局部变量；类名使用 `PascalCase`。
- **文件组织**: 领域逻辑位于 `apps/api/app/domains/book_runs/`，对应测试位于 `apps/api/tests/`。
- **导入顺序**: `from __future__`、标准库、第三方库、项目内模块。
- **代码风格**: pytest 使用 plain `assert`；错误提示、docstring 与注释使用简体中文。

### 3. 可复用组件清单

- `create_book_blueprint` / `lock_book_blueprint` / `trigger_chapter_plan`: 创建并锁定蓝图，生成章节计划。
- `create_book_run` / `apply_book_run_progress`: 创建和推进 BookRun。
- `assemble_prompt_injection` / `build_draft_prompt_from_state`: 将蓝图和章节约束注入 prompt。
- `export_book_run_markdown` / `export_book_run_audit_report`: 导出最终制品。
- `_Phase9BChatHandler`: 本地 HTTPServer 模拟真实协议边界。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 单测/集成式本地模拟；不运行真实 LLM，不写入任何密钥。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/api/tests/test_phase9a_deterministic_smoke.py`、`apps/api/tests/test_book_exporter.py`。
- **覆盖要求**: 10 章完成、字数参数进入蓝图和 prompt、audit 10 章、CLI 参数透传、密钥不进入输出或 audit。

### 5. 依赖和集成点

- **外部依赖**: Python 标准库 `argparse`、`urllib.request`、`HTTPServer`；pytest；SQLAlchemy。
- **内部依赖**: 蓝图、BookRun、Books、ModelRun、Judge、Repair、Export 领域模块。
- **集成方式**: `run_phase9b_real_llm_smoke` 是主编排函数；`main` 负责 CLI 参数解析和脱敏摘要输出。
- **配置来源**: `STORYFORGE_LLM_*` 环境变量；测试中使用局部 env 字典和本地 HTTPServer URL。

### 6. 技术选型理由

- **为什么用这个方案**: 沿用现有 smoke 编排与测试服务器，避免新增依赖或自研模拟框架。
- **优势**: 覆盖真实 HTTP 协议边界，同时不会触发外部网络或真实密钥。
- **劣势和风险**: 10 章测试请求数增加，执行时间高于 1 章；通过短响应和本地 HTTPServer 控制成本。

### 7. 关键风险点

- **并发问题**: `HTTPServer` 在测试线程中运行，需 `shutdown` 和 `join` 清理。
- **边界条件**: `chapter_count` 应限制为 1..10；字数参数必须为正数，且章节最小值不能大于最大值。
- **性能瓶颈**: 真实 LLM 10 章会消耗更多 token，仍由 `token_budget` 和显式章节上限控制。
- **安全考虑**: 密钥只放入请求头；audit、ModelRun payload、CLI 输出不得包含密钥。
