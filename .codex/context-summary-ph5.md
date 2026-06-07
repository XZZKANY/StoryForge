## 项目上下文摘要（PH5 集成验证）

生成时间：2026-06-07 04:20:00

### 1. PH5 来源与目标

- **原始目标**：附件中的 PH5 定义为“集成验证”，要求跑 30 章真实 LLM BookRun，记录总耗时、查询次数、召回命中率、arc completion，并执行金丝雀发布前验证。
- **硬门禁**：30 章 `audit_report` 或脱敏证据中必须出现 `context_cache_hit_rate > 0.95`、`memory_recall_budget_used < 8000`。
- **当前事实源**：`current-phase.md` 仍声明真实 3-5 万字长程未完成，禁止宣称生产级长篇闭环已经稳定。
- **本轮可交付范围**：补齐真实长程 wrapper 与 evidence validator 的集成指标证据契约和本地门禁，让真实 LLM 30 章运行一旦完成即可自动验收；当前环境不伪造真实 30 章成功。

### 2. 相似实现分析

- **实现1**: `.codex/run-real-llm-long-direct.py`
  - 模式：一次性 SQLite、真实 LLM runner、脱敏证据目录、`summary.json`、`run-metadata.json`、`quality-risk.md`、`human-readthrough-todo.md`。
  - 可复用：`_gate_failures`、`_metadata`、`_write_audit_templates`、`_sensitive_hit_count`。
  - 需注意：当前门禁覆盖 token、hash、章节质量，但未覆盖 PH5 指标字段。
- **实现2**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：读取 `summary.json` 与 `run-metadata.json`，聚合 `$failures` 后输出 `gate: pass...` 或 `gate: fail`。
  - 可复用：文件存在性检查、质量分检查、人工通读开关、PowerShell 本地可重复验收。
  - 需注意：当前 gate 名称仍偏 10 章 smoke；30 章集成验证需要独立输出范围。
- **实现3**: `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`
  - 模式：`importlib` 动态加载 `.codex` runner，使用 `tmp_path`、`monkeypatch` 和替身 runner 验证长程入口。
  - 可复用：`_load_long_wrapper`、质量门禁测试、resume 目录测试、敏感值扫描测试。
  - 需注意：新增集成指标测试应直接调用 `_gate_failures`，不触发真实 LLM。
- **实现4**: `apps/api/tests/test_real_llm_long_evidence_validator.py`
  - 模式：构造最小脱敏证据目录，用 `subprocess.run` 调 PowerShell 验证器，断言 stdout 和退出码。
  - 可复用：`_write_minimal_long_evidence`、`_run_validator`。
  - 需注意：测试数据需要默认写入达标 `integration_metrics`，另写缺失/不达标红灯。
- **实现5**: `apps/api/tests/test_phase1_context_optimization_verify.py`
  - 模式：SQLAlchemy event 统计 Scene 查询次数。
  - 可复用：PH5 指标名 `db_query_count_per_chapter` 的来源依据。
  - 需注意：该测试依赖真实 LLM 环境，PH5 本轮只把结果作为证据字段验收。

### 3. 项目约定

- **命名约定**：Python 函数与变量使用 `snake_case`；PowerShell 参数使用 PascalCase；JSON 字段使用小写下划线。
- **文件组织**：真实 LLM 运行脚本和验证脚本位于项目本地 `.codex/`；API 侧测试位于 `apps/api/tests/`。
- **导入顺序**：Python 文件保持 `from __future__ import annotations` 首行，标准库、第三方、本地导入分组。
- **代码风格**：测试使用 pytest plain `assert`；测试说明、失败信息、日志和报告使用简体中文。

### 4. 可复用组件清单

- `_gate_failures(summary, token_budget=...)`：长程 runner 成功门禁聚合入口。
- `_metadata(...)`：把脱敏摘要写入 `run-metadata.json` 的统一入口。
- `_write_minimal_long_evidence(...)`：PowerShell 验证器测试的最小证据构造器。
- `validate-real-llm-long-evidence.ps1` 的 `$failures` 聚合：本地证据验收事实源。
- `BookRunWorkflowPlanningRefs.arc_completion_ratio`：PH3 已建立的 arc completion 数据口径。
- `test_phase2_memory_recall_fix.py`：memory recall 命中率指标的回归证据来源。
- `test_phase1_context_optimization_verify.py`：DB query count 指标的回归证据来源。

### 5. 测试策略

- **测试框架**：pytest；项目入口为 `cd apps/api; uv run pytest`。
- **红灯 1**：新增 wrapper 测试，缺失或不达标 `integration_metrics` 时 `_gate_failures` 必须返回中文失败项。
- **绿灯 1**：`.codex/run-real-llm-long-direct.py` 提取、保留并校验 `integration_metrics`。
- **红灯 2**：新增 validator 测试，缺失集成指标时 PowerShell 验证器必须 `gate: fail`。
- **绿灯 2**：`.codex/validate-real-llm-long-evidence.ps1` 输出指标并在 30 章达标时输出 `pass_for_real_30ch_integration_scope`。
- **最终验证**：运行目标 pytest、相关 Python ruff、`git diff --check`。

### 6. 依赖和集成点

- **外部依赖**：Python 标准库、SQLAlchemy、pytest、PowerShell，均为既有依赖。
- **内部依赖**：真实 LLM 运行仍通过 `run_phase9b_real_llm_smoke` / `resume_phase9b_real_llm_smoke`，证据摘要仍来自 `_evidence_summary`。
- **集成方式**：`summary.json` 顶层新增 `integration_metrics`；`run-metadata.json` 的 `summary` 镜像同样保留该字段；PowerShell 验证器读取同一字段。
- **配置来源**：runner 参数 `chapter-count`、`max-chapter-count`、`token-budget`、`target-word-count`；validator 参数 `ExpectedChapterCount`、`TokenBudget` 和新增指标阈值。

### 7. 技术选型理由

- **为什么用这个方案**：项目已有真实长程 wrapper 和证据验证器，PH5 应强化既有证据门禁，而不是新增第二套脚本或只写报告。
- **优势**：改动集中、可本地复跑、不触碰真实 provider 密钥、不破坏当前 10 章 smoke 证据链。
- **劣势和风险**：本轮不能替代真实 30 章 LLM 执行；如果真实 `audit_report.json` 暂未写入指标，30 章运行会被门禁拒绝，这是符合 PH5 的失败显性化。

### 8. 关键风险点

- **真实环境缺口**：当前会话没有私有真实 LLM provider 配置，不能执行 30 章真实运行。
- **指标来源不完整**：现有 `_evidence_summary` 没有 PH5 指标；需要先从 audit payload 或 summary payload 透传，缺失即失败。
- **兼容边界**：10 章 smoke 验证仍应可用，但 PH5 30 章应输出独立 gate，避免扩大宣称范围。
- **安全考虑**：不得把 `STORYFORGE_LLM_API_KEY`、base URL 等私密配置写入证据或日志。

### 9. 外部资料与工具记录

- Context7 查询 pytest 官方文档：确认 `tmp_path` 适合为每个测试提供独立临时目录，`monkeypatch` 会在测试结束后回滚对象与环境变量，适合当前 wrapper 测试模式。
- GitHub `search_code` 查询 `audit_report arc_completion pytest`：无同域可复用实现。
- GitHub `search_code` 查询 `quality_gate_failures summary.json pytest`：仅命中低相关集成测试，未采用。
- `desktop-commander` 当前会话未暴露；已使用 PowerShell、`rg`、Context7、GitHub MCP 作为替代并记录缺口。
