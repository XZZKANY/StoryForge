## 项目上下文摘要（真实 LLM 低成本连通性探针）

生成时间：2026-06-04 03:40:00 +08:00

### 1. 相似实现分析

- **实现1**: `.codex/run-real-llm-smoke-interactive.ps1`
  - 模式：使用 `Read-Host -AsSecureString` 获取供应商凭据，转为当前进程环境变量后运行真实 smoke。
  - 可复用：`Test-Present`、`Convert-SecureStringToPlainText`、`Redact-PrivateRuntimeText`、finally 清空 API key 的安全模式。
  - 需注意：该脚本会直接启动 BookRun smoke，不适合做长程前的低成本连通性探针。
- **实现2**: `.codex/run-real-llm-10ch-current-env.ps1`
  - 模式：只从当前 PowerShell 进程读取运行时变量，缺变量时输出 `gate: fail_preflight` 并停止。
  - 可复用：`STORYFORGE_LLM_*` 必需变量清单、present/missing 预检、脱敏输出边界。
  - 需注意：该脚本直接调用 10 章包装；历史 10 章 SSL 握手超时说明它前面需要更轻的探针。
- **实现3**: `apps/web/app/api/provider-models/provider-models.ts`
  - 模式：规范化 Provider Base URL，请求 OpenAI 兼容 `/v1/models`，提取模型 ID 并返回结构化结果。
  - 可复用：先探测模型列表，再判断模型是否存在；只返回 endpoint 与模型名，不处理密钥。
  - 需注意：Web 设置页不渲染 API key，不能验证带鉴权的 chat completions。
- **实现4**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：调用 OpenAI 兼容 `/chat/completions`，使用 `Authorization: Bearer` 与 JSON payload。
  - 可复用：请求体字段、timeout 环境变量、空内容失败策略。
  - 需注意：workflow 客户端用于生产生成，不应被复制成新的业务 provider 客户端；探针只做 `.codex` 工具。
- **实现5**: `apps/workflow/tests/test_llm_provider.py` 与 `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - 模式：通过本地 HTTPServer 模拟 OpenAI 兼容响应，验证协议字段和密钥不泄露。
  - 可复用：测试命名、fake provider、Authorization 断言和脱敏断言思路。
  - 需注意：本轮新增脚本测试优先做文本契约和缺环境 preflight，避免启动真实外部请求。

### 2. 项目约定

- **命名约定**: `.codex` 运行脚本使用 `run-real-llm-*.ps1`；PowerShell 函数使用 PascalCase 动词短语。
- **文件组织**: 工具脚本放在 `.codex/`，脚本契约测试放在 `apps/api/tests/`，审计记录写入 `.codex/operations-log.md` 与 `.codex/verification-report.md`。
- **导入顺序**: Python 测试保持标准库优先，pytest 断言用 plain assert。
- **代码风格**: 文档、提示、错误信息和注释使用简体中文；脚本不写 provider 私有值。

### 3. 可复用组件清单

- `.codex/run-real-llm-smoke-interactive.ps1`: SecureString、脱敏、finally 清空 key。
- `.codex/run-real-llm-10ch-current-env.ps1`: 当前进程环境变量 preflight。
- `apps/web/app/api/provider-models/provider-models.ts`: `/v1/models` 探测协议。
- `apps/workflow/storyforge_workflow/provider_client.py`: `/chat/completions` 协议。
- `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`: 通过测试加载 `.codex` 脚本的相邻模式。

### 4. 测试策略

- **测试框架**: API 使用 `uv run pytest`。
- **测试模式**: 先新增脚本文本契约测试，红灯证明探针脚本不存在；再新增脚本让测试通过。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_long_wrapper.py`、`apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/workflow/tests/test_llm_provider.py`。
- **覆盖要求**: 测试覆盖脚本存在、`/models`、`/chat/completions`、SecureString、preflight、脱敏输出、finally 清空 API key、源码不含实际私有 endpoint/key。

### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 `/models` 与 `/chat/completions`；当前进程或交互输入提供真实运行配置。
- **内部依赖**: 只依赖 PowerShell 内置 HTTP 能力，不修改 API/Web/Workflow 生产代码。
- **集成方式**: 作为真实 10 章长程前置门禁，由 `.codex/real-llm-smoke-gate.md` 引用。
- **配置来源**: 当前进程环境变量或交互式 `Read-Host -AsSecureString`；不读取 `.env`。

### 6. 技术选型理由

- **为什么用这个方案**: 历史 10 章失败发生在 SSL handshake timeout，说明在 BookRun 之前应先用极低成本 HTTP 探针验证 provider 连接和模型可用性。
- **优势**: 请求少、成本低、失败快，能把网络、鉴权、模型和 chat 协议问题从长程运行中提前剥离。
- **劣势和风险**: 探针通过不代表 10 章能完成；供应商可能对 `/models` 与 `/chat/completions` 权限分开控制。

### 7. 关键风险点

- **并发问题**: 工作区已有大量未提交改动，本轮只新增 `.codex` 脚本、测试和审计文档。
- **边界条件**: 缺环境变量时必须 fail_preflight；非交互模式不得提示输入或发外部请求。
- **性能瓶颈**: 探针超时默认短，长程超时仍由 10 章包装脚本控制。
- **安全考虑**: 不得把 provider URL、key、Authorization、Bearer token 或可还原片段写入命令、日志、报告、测试输出或产物。
