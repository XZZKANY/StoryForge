## 项目上下文摘要（真实 LLM 验收凭据注入）

生成时间：2026-06-08 10:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-connectivity-probe.ps1`
  - 模式：PowerShell 低成本连通性探针，检查 `/models` 与 `/chat/completions`。
  - 可复用：`Convert-SecureStringToPlainText`、`Read-Host -AsSecureString`、`gate: pass_connectivity_probe`。
  - 需注意：finally 中清理 `STORYFORGE_LLM_API_KEY`，输出必须脱敏。
- **实现2**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：包装脚本先执行连通性探针，再运行真实长程 runner。
  - 可复用：`Set-InteractiveRuntimeEnv`、`Clear-InteractiveRuntimeEnv`、`interactiveInjectedNames`。
  - 需注意：只把交互输入写入当前进程环境，不能写入文件或命令参数。
- **实现3**: `.codex/run-real-llm-parallel.py`
  - 模式：真实并发验收 runner，读取必要环境变量并生成脱敏 evidence。
  - 可复用：`REQUIRED_REAL_LLM_ENV`、`sensitive_hit_count`、`run-metadata.json`。
  - 需注意：验收成功需要检查 `book_run_status`、`actual_chapter_count`、`sensitive_hit_count`。

### 2. 项目约定

- **命名约定**: PowerShell 函数使用 Verb-Noun；Python 测试函数使用 `test_`。
- **文件组织**: 本地验收脚本放在 `.codex/`，脚本契约测试放在 `apps/api/tests/`。
- **导入顺序**: Python 测试沿用标准库导入后定义路径常量。
- **代码风格**: 测试说明、脚本提示和报告均使用简体中文。

### 3. 可复用组件清单

- `.codex/run-real-llm-connectivity-probe.ps1`: 真实 provider 低成本探针。
- `.codex/run-real-llm-parallel.py`: 当前并发真实 runner。
- `apps/api/tests/test_real_llm_connectivity_probe_script.py`: PowerShell wrapper 安全契约测试模式。
- `apps/api/tests/test_phase9b_real_llm_parallel_wrapper.py`: evidence 脱敏与并发 runner 门禁测试。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 静态契约测试 + 本地 HTTP fake provider 冒烟测试 + runner wrapper 回归。
- **参考文件**: `apps/api/tests/test_real_llm_connectivity_probe_script.py`。
- **覆盖要求**: 正常 ProbeOnly、缺环境失败、凭据不泄露、真实 runner 不在 ProbeOnly 启动。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 provider，只在用户交互输入真实凭据后调用。
- **内部依赖**: PowerShell wrapper 调用 connectivity probe；探针通过后调用 `uv run python .codex/run-real-llm-parallel.py`。
- **集成方式**: 当前进程环境变量传递给子进程。
- **配置来源**: 交互输入或当前 PowerShell 进程已有环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: 避免凭据进入聊天、文件、命令行参数和日志，同时复用已验证的真实并发 runner。
- **优势**: 可本地重复、凭据生命周期短、先低成本探针再高成本验收。
- **劣势和风险**: 真实外呼仍依赖用户在本机终端输入凭据、供应商可用性和预算。

### 7. 关键风险点

- **凭据泄露**: 禁止在聊天中粘贴 key；脚本只接受交互输入并清理进程变量。
- **外呼误启动**: `-ProbeOnly` 必须只跑连通性探针，不运行并发 runner。
- **验收误判**: 未执行真实 provider 前不能声明真实验收通过。
- **证据污染**: 正式运行后必须检查 evidence 中 `sensitive_hit_count=0`。
