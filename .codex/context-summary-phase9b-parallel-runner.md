## 项目上下文摘要（Phase9B 并发真实 LLM runner）

生成时间：2026-06-07 19:14:06 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`
  - 模式：`run_book_loop()` 在 `chapter_parallelism > 1` 且无 `chapter_budget` 时进入 `ThreadPoolExecutor` 并发预取分支。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`run_book_loop()`、`progress.integration_metrics.concurrent_chapter_utilization`。
  - 需注意：并发分支只按章节顺序提交 progress/checkpoint；真实章节执行函数必须自行保证线程安全。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：`NovelLoopPorts` 通过端口注入 `compile_context/generate_scene/judge_scene/repair_scene/approve_scene/record_model_run`。
  - 可复用：`NovelLoopRequest`、`NovelLoopResult`、`NovelLoopPorts`、`run_single_chapter_loop()`。
  - 需注意：`generate_scene()` 只返回正文字符串，phase9b 的 token、latency、prompt 元数据需要由胶水层暂存给 `record_model_run()`。
- **实现3**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：direct 串行真实 LLM 冒烟，创建 Book/Blueprint/BookRun，逐章执行 generate/approve/model_run/judge/repair，最后导出 `book.md` 与 `audit_report.json`。
  - 可复用：`_assert_preflight`、`_create_smoke_book`、`_seed_consistency_data`、`_blueprint_payload`、`_chapter`、`_generate_chapter`、`_approve_scene`、`_record_model_run`、`_record_scene_packet`、`_judge_and_repair_loop`、`_evidence_summary`。
  - 需注意：direct smoke 的 `context_cache_hit_rate` 为投影算法，新的并发 runner 不得沿用它伪装真实并发缓存命中。
- **实现4**: `apps/api/app/domains/book_runs/workflow_prompt_bridge.py`
  - 模式：API venv 不直接依赖 workflow 包，通过文件路径加载 workflow 纯函数模块，并预置 `storyforge_workflow` stub 包。
  - 可复用：跨 apps 边界的动态加载方式。
  - 需注意：`apps/api` 环境中直接 `import storyforge_workflow` 会失败，新增胶水模块必须沿用桥接方式。

### 2. 项目约定

- **命名约定**: Python 文件、函数和变量使用 `snake_case`；JSON 指标字段使用小写下划线。
- **文件组织**: API 真实 LLM 胶水位于 `apps/api/app/domains/book_runs/`；本地真实运行驱动位于 `.codex/`。
- **导入顺序**: `from __future__ import annotations` 后按标准库、第三方、本地依赖分组。
- **代码风格**: pytest plain `assert`；测试说明、注释、日志、报告使用简体中文。

### 3. 可复用组件清单

- `run_book_loop()`：workflow BookLoop 并发事实源。
- `NovelLoopPorts` / `run_single_chapter_loop()`：单章端口闭环。
- `phase9b_real_llm_smoke` 私有 helper：真实 LLM generate/judge/repair/approve 的既有事实链。
- `apply_book_run_progress()`：BookRun progress/status/budget 回填入口。
- `export_book_run_markdown()` / `export_book_run_audit_report()`：导出证据事实源。
- `.codex/run-real-llm-long-direct.py`：证据 bundle 与脱敏摘要参考。

### 4. 测试策略

- **测试框架**: `cd apps/api; uv run pytest`。
- **红灯**: 新增 `tests/test_phase9b_parallel_ports.py`，先因缺少 `app.domains.book_runs.phase9b_parallel_ports` 失败。
- **绿灯**: 新模块提供每章独立 session 的并发 BookLoop helper，替身测试断言 `concurrent_chapter_utilization > 0.6` 与 session 不复用。
- **回归**: 目标测试、现有 phase9b smoke/wrapper 测试、相关 ruff、`py_compile`。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy、pytest、PowerShell、Python 标准库。
- **内部依赖**: API 侧 `BookRun`、`Chapter`、`Scene`、`ModelRun`、`Artifact`，workflow 侧 `BookLoop` 与 `NovelLoop`。
- **集成方式**: 新并发 runner 创建初始 BookRun 后，由 BookLoop 并发执行章节，每章通过 `session_factory()` 独立创建 ORM session，最终通过 `apply_book_run_progress()` 回填并导出。
- **配置来源**: `.codex/run-real-llm-parallel.py` 参数和当前进程环境变量，不把 provider 密钥写入源码、日志或证据正文。

### 6. 技术选型理由

- **为什么用这个方案**: 项目已有 BookLoop 并发事实源和 phase9b 真实 LLM direct 能力；新增胶水模块比新增第二套并发编排器更小、更可审计。
- **优势**: 保留既有审计链、复用现有导出和门禁，能用替身测试验证并发/session 行为，再用真实 provider 小规模实测。
- **劣势和风险**: phase9b direct helper 是私有函数，后续若签名变化需要同步；真实 LLM provider 延迟和限流会影响实测结果。

### 7. 关键风险点

- **并发问题**: SQLAlchemy 官方文档说明 `Session` 非线程安全；必须采用每线程独立 session。
- **边界条件**: `BookLoop` 并发分支在 `chapter_budget` 非空时不会启用，因此并发 runner 不能把 `chapter_budget` 传给 BookLoop。
- **性能瓶颈**: `chapter_generation_time_p50` 受模型 reasoning 延迟支配，真实记录即可，不作为本次伪绿目标。
- **安全考虑**: provider key/base URL/model 私密配置只从运行环境读取，不进入证据输出。

### 8. 外部资料与工具记录

- Context7 查询 SQLAlchemy ORM 文档：`Session` 不是线程安全对象，并发模型应为 “Session per thread”。
- GitHub `search_code` 查询 `Session per thread ThreadPoolExecutor SQLAlchemy`：结果低相关，仅作为参考，未引入外部实现。
- 当前工具列表未暴露 desktop-commander；本地检索使用 PowerShell 和 `rg` 替代并在本摘要记录。
