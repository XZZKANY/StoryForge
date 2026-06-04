## 项目上下文摘要（StoryForge 总计划续推）

生成时间：2026-06-04 03:20:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：真实 LLM smoke 核心 runner，统一处理章节数、token 预算、目标字数、BookRun、Markdown artifact、audit artifact 和脱敏 summary。
  - 可复用：`run_phase9b_real_llm_smoke()`、`_evidence_summary()`、`_artifact_text()`。
  - 需注意：依赖当前进程环境变量，不读取 `.env`，不得输出或落盘 provider URL/key。
- **实现2**: `.codex/run-real-llm-long-direct.py`
  - 模式：10 章真实 LLM 长程包装脚本，负责隔离 SQLite、全产物落盘、敏感扫描、外层超时和运行后质量 gate。
  - 可复用：`_sensitive_hit_count()`、`_raise_if_outer_timeout_exceeded()`、`_gate_failures()`。
  - 需注意：当前历史 10 章目录均 `runner_exit_code=1` 且 `summary_present=false`，不能作为完成证据。
- **实现3**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：只从当前 PowerShell 进程读取运行时变量，再调用长程包装脚本。
  - 可复用：present/missing 预检与安全提示。
  - 需注意：必须由同一进程安全注入 `STORYFORGE_LLM_*` 与确认变量后才能执行。
- **实现4**: `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`
  - 模式：pytest 覆盖长程包装脚本的敏感扫描、外层超时和运行后 gate。
  - 可复用：通过 `importlib.util.spec_from_file_location()` 加载 `.codex` 脚本进行单元测试。
  - 需注意：该测试只证明门禁逻辑，不证明真实外部 LLM 长程完成。

### 2. 项目约定

- **命名约定**: Python 函数使用 `snake_case`，测试使用 `test_*`；文档和报告文件使用 `.codex/context-summary-*.md`。
- **文件组织**: 真实 LLM 运行证据统一写入 `.codex/real-llm-*`；上下文摘要、操作日志、验证报告必须写入项目本地 `.codex/`。
- **导入顺序**: Python 文件保持标准库、第三方库、本地模块分组；`.codex` 运行脚本通过 `sys.path.insert(0, apps/api)` 复用 API 模块。
- **代码风格**: 文档、注释、日志、错误提示使用简体中文；不新增 provider 客户端，不绕过既有 runner。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: 真实 LLM BookRun smoke 入口。
- `.codex/run-real-llm-long-direct.py`: 10 章真实 LLM 长程包装与门禁。
- `.codex/run-real-llm-10ch-current-env.ps1`: 当前进程环境变量包装入口。
- `.codex/validate-real-llm-smoke-evidence.ps1`: 脱敏产物验收脚本。
- `.codex/real-llm-smoke-gate.md`: 真实 LLM smoke 阶段门禁说明。

### 4. 测试策略

- **测试框架**: API 使用 `uv run pytest`，根门禁使用 `pnpm verify`。
- **测试模式**: 长程包装脚本通过 pytest 单元测试覆盖门禁；真实 LLM 运行通过脚本产物、summary、metadata、脱敏扫描和人工通读共同验收。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/api/tests/test_phase9b_real_llm_long_wrapper.py`。
- **覆盖要求**: 真实 10 章完成声明必须同时具备 runner 0 退出、summary present、BookRun completed、实际章节数匹配、敏感命中为 0、artifact hash 存在、逐章质量达标、人工通读完成。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 LLM endpoint，当前进程必须提供 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER`、`STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD`。
- **内部依赖**: BookRun、Blueprint、ModelRun、Judge、Repair、Markdown exporter、audit exporter。
- **集成方式**: 真实 smoke runner 在一次性 SQLite 会话内复用 API domain service，不新增服务。
- **配置来源**: 只允许当前进程环境变量；本轮未读取 `.env`，也未把用户提供的 provider 信息写入命令、代码、日志或产物。

### 6. 技术选型理由

- **为什么用这个方案**: 既有 runner 已覆盖真实生成链路，长程包装脚本已补齐脱敏、超时和质量门禁，复用它比新增脚本更安全。
- **优势**: 可审计、可脱敏、失败产物隔离，且能防止 10 章失败被误标记成功。
- **劣势和风险**: 当前 Codex 工具进程没有继承 provider 环境变量；聊天中的凭据不能被写入命令或文件，因此无法由本进程安全启动真实 10 章调用。

### 7. 关键风险点

- **并发问题**: 当前工作区存在大量未提交改动，继续开发必须只触碰任务相关文件。
- **边界条件**: 历史 `.codex/real-llm-10ch-20260603-192512` 与 `.codex/real-llm-10ch-20260603-193901` 都失败，不能作为 10 章完成证据。
- **性能瓶颈**: 历史失败为 SSL handshake timeout，长程重跑前应先做低成本连通性或 1 章/3 章递进验证。
- **安全考虑**: 不得把 provider URL、key、Authorization、Bearer token 或可还原片段写入命令、日志、报告、测试输出或产物。

### 8. 充分性检查

- 能定义接口契约：是，真实长程入口为当前进程环境变量加 `.codex/run-real-llm-10ch-current-env.ps1` 或 `.codex/run-real-llm-long-direct.py` 参数。
- 理解技术选型理由：是，复用既有 runner 与门禁包装，不新增 provider 客户端。
- 识别主要风险点：是，当前最大阻塞是运行时变量缺失与历史 10 章 SSL 超时失败。
- 知道如何验证实现：是，先 pytest 验证门禁，再运行真实 smoke，最后检查 summary、metadata、敏感扫描、人工通读和验证报告。
