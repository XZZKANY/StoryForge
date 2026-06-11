## 项目上下文摘要（真实 LLM 10 章长程推进）

生成时间：2026-06-04 10:57:09 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：OpenAI 兼容 `chat/completions` 直连，使用 `model`、`messages`、`temperature` 和 Bearer 鉴权。
  - 可复用：`run_phase9b_real_llm_smoke()`、`_evidence_summary()`、`_artifact_text()`、`REQUIRED_REAL_LLM_ENV`。
  - 需注意：真实凭据只来自进程环境；命令行摘要与证据摘要必须脱敏；BookRun 超出 token 预算时不能标记 completed。
- **实现2**: `.codex/run-real-llm-connectivity-probe.ps1`
  - 模式：低成本探针先请求 `/models`，再请求最小 `chat/completions`。
  - 可复用：`gate: pass_connectivity_probe` 作为长程运行前置门禁。
  - 需注意：探针失败时必须停止长程，避免重复制造失败证据。
- **实现3**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：包装 10 章运行，先做环境变量 preflight，再强制执行连通性探针，最后调用长程 runner。
  - 可复用：`-ProbeOnly`、`-ChapterCount`、`-TargetWordCount`、`-TokenBudget`、`-TimeoutSeconds`、`-OuterTimeoutSeconds`。
  - 需注意：只从当前进程环境读取真实配置；运行结束后清理交互注入的敏感变量。
- **实现4**: `.codex/run-real-llm-long-direct.py`
  - 模式：使用一次性 SQLite 数据库执行真实长程 smoke，并写入脱敏 `summary.json`、`book.md`、`audit_report.json`、`run-metadata.json`。
  - 可复用：敏感值扫描、外层超时门禁、质量门禁、审计模板。
  - 需注意：一次性 SQLite 只能证明真实 10 章 smoke 技术链路，不能证明默认 PostgreSQL 生产稳定性。
- **实现5**: `.codex/validate-real-llm-long-evidence.ps1`
  - 模式：独立验收长程脱敏产物，检查章节数、token、artifact ID、hash、质量分、问题数和人工通读记录。
  - 可复用：默认技术 scope 与 `-RequireManualReadthrough` 最终验收模式。
  - 需注意：默认通过只能声明 10 章技术 scope；人工通读完成前不能声明最终验收完成。

### 2. 项目约定

- **命名约定**: Python 使用 `snake_case`；PowerShell 参数使用 PascalCase；Markdown 证据文件使用小写连字符。
- **文件组织**: 临时审计和运行证据写入项目本地 `.codex/`；生产代码位于 `apps/api`、`apps/web`、`apps/workflow`。
- **导入顺序**: Python 先标准库、再第三方、再项目模块；现有 runner 已采用该顺序。
- **代码风格**: Python 使用 Ruff 与 pytest plain assert；Markdown 使用简体中文事实记录。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: 真实章节生成、Judge/Repair、BookRun 完成、导出和摘要。
- `.codex/run-real-llm-connectivity-probe.ps1`: 低成本外部 provider 连通性探针。
- `.codex/run-real-llm-10ch-current-env.ps1`: 10 章长程包装入口。
- `.codex/run-real-llm-long-direct.py`: 脱敏长程运行与产物生成。
- `.codex/validate-real-llm-long-evidence.ps1`: 长程证据验收器。
- `apps/api/tests/test_phase9b_real_llm_smoke.py`: OpenAI 兼容协议、CLI 脱敏、10 章 mock 协议边界测试。
- `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`: 长程 wrapper 敏感扫描、超时和质量门禁测试。
- `apps/api/tests/test_real_llm_long_evidence_validator.py`: 长程证据验收器测试。

### 4. 测试策略

- **测试框架**: API 使用 pytest；脚本测试通过 pytest 调 PowerShell 子进程。
- **测试模式**: 先执行 ProbeOnly 连通性探针；探针通过后执行 10 章真实长程；长程结束后执行证据 validator。
- **参考文件**:
  - `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`
  - `apps/api/tests/test_real_llm_long_evidence_validator.py`
- **覆盖要求**: 成功路径需包含 `summary.json`、`book.md`、`audit_report.json`、artifact ID、hash、章节数和质量分；失败路径需记录 runner 退出码、失败 gate、脱敏 stderr 和 `sensitive_hit_count=0`。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 `chat/completions` 与 `/models` 端点；真实配置由当前进程环境变量提供。
- **内部依赖**: BookRun、Blueprint、Chapter、Scene、ModelRun、Judge、Repair、Artifacts 和 Markdown/Audit 导出。
- **集成方式**: `.codex/run-real-llm-10ch-current-env.ps1` 调用连通性探针，通过后调用 `.codex/run-real-llm-long-direct.py`；runner 内部复用 `run_phase9b_real_llm_smoke()`。
- **配置来源**: 当前进程环境变量；不得读取 `.env`，不得把私有地址或凭据写入仓库。

### 6. 技术选型理由

- **为什么用现有 wrapper**: 已有脚本覆盖 preflight、探针、超时、长程运行、脱敏摘要和证据验证，复用它能避免新增自研入口。
- **优势**: 失败和成功证据都可复验；敏感扫描已覆盖主要文本产物；默认技术 scope 与最终人工通读 scope 分离。
- **劣势和风险**: 历史 10 章运行均因 SSL 握手超时失败；真实外部接口耗时和成本不可忽略；一次性 SQLite 不能代表生产数据库稳定性。

### 7. 关键风险点

- **并发问题**: 本轮使用一次性 SQLite 目录运行，避免与当前本地服务和 PostgreSQL 状态互相污染。
- **边界条件**: ProbeOnly 失败必须停止；长程失败不得更新完成声明；token 预算达到或超过门禁必须失败。
- **性能瓶颈**: 10 章至少包含生成和 Judge 两类真实调用，网络超时是主要瓶颈；本轮将单请求超时提高到 600 秒、外层超时提高到 7200 秒。
- **安全考虑**: 私有凭据和私有接口地址只进入进程环境；上下文摘要、日志、验证报告只记录模型名、gate、目录和脱敏错误类型。

### 8. 历史 10 章失败证据

- `.codex/real-llm-10ch-20260603-192512/run-metadata.json`: `runner_exit_code=1`，`summary_present=false`，`sensitive_hit_count=0`。
- `.codex/real-llm-10ch-20260603-192512/stderr.log`: SSL handshake timeout。
- `.codex/real-llm-10ch-20260603-193901/run-metadata.json`: `runner_exit_code=1`，`summary_present=false`，`sensitive_hit_count=0`。
- `.codex/real-llm-10ch-20260603-193901/stderr.log`: SSL handshake timeout。
- 两个历史目录均缺少 `summary.json`、`book.md` 和 `audit_report.json`，不能作为真实 10 章完成证据。

### 9. 上下文充分性检查

- **能定义接口契约**: 是。输入为当前进程环境变量和 wrapper 参数；输出为脱敏运行目录与 validator gate。
- **理解技术选型理由**: 是。复用既有 wrapper/runner/validator，避免新增调用链。
- **识别主要风险点**: 是。历史 SSL 握手超时、token 成本、长耗时、人工通读未完成。
- **知道如何验证实现**: 是。ProbeOnly、长程 wrapper、validator、敏感扫描与目标测试组合验证。

### 10. 外部资料来源与用途

- Context7 `/websites/developers_openai_api`: 核对 Chat Completions 使用 `model`、`messages`、`Authorization: Bearer` 和 JSON body 的标准请求形态。
- GitHub `search_code`: 检索 PowerShell 与 OpenAI 兼容 `chat/completions` 的公开实现，辅助确认当前 wrapper 使用 Bearer 鉴权和 REST JSON 调用属于常见边界。
