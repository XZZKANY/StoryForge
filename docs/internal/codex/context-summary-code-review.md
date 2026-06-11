## 项目上下文摘要（code-review）

生成时间：2026-06-06 03:58:36 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/book_loop.py:57`
  - 模式：BookLoop 串行驱动章节，遇到 `awaiting_review`、预算触顶或 provider 连续降级时立即暂停。
  - 可复用：`BookLoopRequest`、`BookLoopResult`、`_chapter_progress`、`_paused_by_budget`。
  - 需注意：新增并发路径只顺序提交 progress/checkpoint，不能天然约束已启动章节的外部副作用。
- **实现2**: `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py:163`
  - 模式：adapter 将 dispatch payload 转为 BookLoopRequest，并用 `progress_sink` 回填运行、完成、失败状态。
  - 可复用：`BookRunAdapterRequest`、`BookRunAdapterPorts`、`_emit_result_progress`。
  - 需注意：`run_chapter` 内部调用 `run_single_chapter_loop`，该调用链可能产生模型运行、技能运行和批准记录等持久化副作用。
- **实现3**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py:775`
  - 模式：Phase9B 真实 LLM smoke 通过生成、Judge、Repair、导出审计产物形成可验证证据链。
  - 可复用：`_JudgeRunResult`、`_run_real_judge`、`_record_summary_judge`、`_evidence_summary`。
  - 需注意：当前重构后 `_judge_and_repair_loop` 仍引用旧局部变量，API 定向测试已复现 `NameError`。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；测试函数以 `test_` 开头并用中文 docstring 描述业务意图。
- **文件组织**: API 侧位于 `apps/api/app/domains/*`，workflow 侧位于 `apps/workflow/storyforge_workflow/*`，测试分别位于对应 `tests/`。
- **导入顺序**: Python 文件由 ruff 管理，`apps/api/pyproject.toml` 与 `apps/workflow/pyproject.toml` 均启用 `I` import 规则。
- **代码风格**: Python 3.11，ruff 行宽 120，注释与文档按 AGENTS.md 使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: BookLoop 状态机、预算暂停和 provider 降级暂停逻辑。
- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: workflow dispatch payload 到 BookLoop 的适配和 progress 回填。
- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: 真实 LLM smoke、Judge/Repair、断点续跑和证据摘要入口。
- `apps/api/app/domains/book_runs/service.py`: BookRun progress 应用、timeline 同步和 API 侧真相源。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: API/workflow 分包运行，使用本地 HTTP server、monkeypatch、tmp_path 和 SQLite session fixture。
- **参考文件**: `apps/workflow/tests/test_book_loop_three_chapters.py`、`apps/workflow/tests/test_book_run_adapter.py`、`apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/api/tests/test_real_llm_connectivity_probe_script.py`。
- **覆盖要求**: 正常流程、预算/降级/人工审查暂停、失败回填、断点续跑、真实 LLM 脱敏证据和包装脚本契约。

### 5. 依赖和集成点

- **外部依赖**: pytest、Pydantic v2、LangGraph、SQLAlchemy、标准库 HTTP server/ThreadPoolExecutor。
- **内部依赖**: API BookRun progress 与 workflow BookLoop progress 共享状态口径；Phase9B smoke 依赖 Judge、Repair、ModelRun、Export、ScenePacket。
- **集成方式**: workflow 通过 dispatch payload 运行章节；API 侧通过 `apply_book_run_progress` 和导出服务落审计证据。
- **配置来源**: `package.json` 提供总验证入口，`apps/api/pyproject.toml` 和 `apps/workflow/pyproject.toml` 定义 pytest/ruff 配置。

### 6. 技术选型理由

- **为什么用这个方案**: 本次是 code review，优先读取当前 diff、相关测试和项目事实源，再运行本地定向验证。
- **优势**: 能把可复现失败与推理型风险分开，降低误判。
- **劣势和风险**: 当前会话没有 `desktop-commander`，已用 PowerShell、rg、Context7 和 GitHub search_code 替代，并在报告中记录。

### 7. 关键风险点

- **并发问题**: 章节并发预取可能在前序章节阻塞前启动后续章节并产生持久化副作用。
- **边界条件**: Phase9B Judge/Repair 循环变量回归导致主路径直接 `NameError`。
- **性能瓶颈**: provider 连接复用和并发优化已有测试覆盖，但真实长程仍需小批量观测。
- **安全考虑**: 真实 LLM 凭据不得写入报告；本次验证输出未包含私有凭据。
