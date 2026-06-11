## 项目上下文摘要（当前小说运行验证）

生成时间：2026-06-01 14:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/deterministic_smoke.py:30`
  - 模式：API 侧用独立服务函数构造 Book、Blueprint、章节、Scene、ModelRun、Judge 记录，并导出 `book.md` 与 `audit_report.json`。
  - 可复用：`run_phase9a_deterministic_smoke()`、`count_markdown_body_words()`。
  - 需注意：这是 deterministic/mock 三章闭环，不调用真实外部 LLM，适合作为当前本地可重复验证。
- **实现2**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py:85`
  - 模式：真实 OpenAI 兼容 LLM 冒烟入口，先做环境变量 preflight，再运行 1 章或 3 章 BookRun。
  - 可复用：`run_phase9b_real_llm_smoke()`、CLI `main()`、`missing_phase9b_real_llm_env()`。
  - 需注意：必须配置 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER`，否则应停止，不触碰外部网络。
- **实现3**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py:35`
  - 模式：Workflow 侧 `run_book_loop()` 顺序驱动每章 NovelLoop，并在预算、人工审查或 provider 降级时暂停。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、预算与 checkpoint 结构。
  - 需注意：该层不依赖 API ORM，保持调度边界。
- **实现4**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py:78`
  - 模式：消费 API dispatch payload，构造 workflow BookRun 请求并通过 progress sink 回填。
  - 可复用：`run_book_run_dispatch_payload()`、`CallableProgressSink`、`CapturingProgressSink`。
  - 需注意：真实外部 worker/HTTP sink 仍是后续部署层，不是本次最小本地运行的阻塞项。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case 函数与变量、PascalCase 数据类和异常；测试函数以 `test_` 开头。
- **文件组织**: API 真相源在 `apps/api/app/domains/*`；workflow 编排在 `apps/workflow/storyforge_workflow/orchestrators`；测试分别在 `apps/api/tests` 和 `apps/workflow/tests`。
- **导入顺序**: `from __future__ import annotations`、标准库、第三方库、项目内模块，符合 ruff `I` 规则。
- **代码风格**: Python 3.11，ruff 行宽 120，中文注释和中文测试说明。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/deterministic_smoke.py`: deterministic 三章 BookRun 冒烟与导出。
- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: 真实 LLM 1/3 章冒烟入口和环境变量检查。
- `apps/api/app/domains/exports/book_markdown_exporter.py`: BookRun Markdown、EPUB、审计报告导出。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: 顺序章节编排、预算暂停和 checkpoint。
- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: API dispatch payload 到 workflow adapter 的边界。

### 4. 测试策略

- **测试框架**: pytest，仓库用 `uv run pytest` 执行 API/workflow 测试。
- **测试模式**: API 测试使用 SQLite 内存数据库和 `Base.metadata.create_all()`；真实 LLM 测试用本地 HTTPServer 模拟 OpenAI 兼容端点。
- **参考文件**:
  - `apps/api/tests/test_phase9a_deterministic_smoke.py:12`
  - `apps/api/tests/test_phase9b_real_llm_smoke.py:58`
  - `apps/workflow/tests/test_book_loop_three_chapters.py:12`
- **覆盖要求**: 至少覆盖 deterministic 三章 completed、真实 LLM preflight、真实协议模拟、BookLoop completed/paused/resume。

### 5. 依赖和集成点

- **外部依赖**: FastAPI、SQLAlchemy、pytest、LangGraph、pydantic；真实 LLM 走 OpenAI 兼容 `/chat/completions`。
- **内部依赖**: BookRun 依赖 locked Blueprint、Chapter 计划、Scene、ModelRun、JudgeIssue 与 Artifact。
- **集成方式**: API 生成 dispatch payload；workflow 消费 payload 并通过 progress sink 回填；deterministic smoke 直接在 API 服务层内构造完整可审计闭环。
- **配置来源**: `.env.example`、`apps/api/app/db/session.py`、`apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`。

### 6. 技术选型理由

- **为什么用这个方案**: 用户只问当前能否跑小说，最小可重复验证应先用 deterministic 三章闭环生成真实制品，再检查真实 LLM 入口是否具备配置。
- **优势**: 不产生外部模型费用；能产出 `book.md` 与 `audit_report.json`；和现有测试完全一致。
- **劣势和风险**: deterministic 正文不是真实模型创作质量；真实 LLM 需要私有环境变量和模型服务，不能在缺配置时强行运行。

### 7. 关键风险点

- **并发问题**: 本次单进程内存数据库运行，无并发写入风险。
- **边界条件**: 真实 LLM 入口只允许 1 章或 3 章；token_budget 必须为正数；缺少私有变量时必须退出。
- **性能瓶颈**: 完整真实 3 章会消耗 token 和时间；本次优先 deterministic 三章与真实 LLM preflight。
- **安全考虑**: 不读取、不打印、不写入真实密钥；真实 LLM 命令只输出脱敏摘要。
