## 项目上下文摘要（9B 真实 LLM 冒烟）

生成时间：2026-05-27 19:20:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：命令行入口调用服务函数，先做环境变量预检，再执行 BookRun、导出 `book.md` 与 `audit_report.json`。
  - 可复用：`run_phase9b_real_llm_smoke`、`main`、`missing_phase9b_real_llm_env`。
  - 需注意：只允许 `chapter_count` 为 1 或 3；密钥通过环境变量读取，CLI 输出脱敏摘要。
- **实现2**: `apps/api/tests/test_phase9b_real_llm_smoke.py`
  - 模式：使用本地 HTTPServer 模拟 OpenAI 兼容 `/chat/completions`，验证 token、model_run、artifact 和密钥不泄露。
  - 可复用：测试中的环境变量协议与断言边界。
  - 需注意：真实运行不能保存 API Key，失败时保留退出码和错误摘要即可。
- **实现3**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：OpenAI 兼容 Chat Completions HTTP 调用，使用 `STORYFORGE_LLM_*` 环境变量。
  - 可复用：`provider_config` 的默认 provider/model 约定。
  - 需注意：API 侧冒烟脚本要求显式设置 provider/model/base_url/key。
- **实现4**: `apps/workflow/tests/test_llm_provider.py`
  - 模式：通过本地模拟服务验证 provider HTTP 协议，而非返回本地假结果。
  - 可复用：真实协议边界与测试写法。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case，测试函数以 `test_` 开头；领域模块位于 `apps/api/app/domains/*`。
- **文件组织**: API 是业务真相源；BookRun 相关实现位于 `apps/api/app/domains/book_runs`；workflow 侧 provider 客户端位于 `apps/workflow/storyforge_workflow`。
- **导入顺序**: `from __future__`、标准库、第三方库、项目内模块，符合 ruff `I` 规则。
- **代码风格**: Python 3.11，ruff 行宽 120，测试使用 pytest。
### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`: 真实 LLM 冒烟 CLI 与服务函数。
- `apps/api/app/domains/exports/book_markdown_exporter.py`: BookRun Markdown 与审计报告导出。
- `apps/api/app/domains/model_runs/service.py`: model_run 证据记录。
- `apps/api/tests/conftest.py`: API 测试数据库与环境隔离模式。

### 4. 测试策略

- **测试框架**: pytest，配置在 `apps/api/pyproject.toml`，`pythonpath=["."]`。
- **测试模式**: 先运行协议边界测试 `uv run pytest tests/test_phase9b_real_llm_smoke.py -q`，再运行真实 CLI 冒烟。
- **参考文件**: `apps/api/tests/test_phase9b_real_llm_smoke.py`、`apps/workflow/tests/test_llm_provider.py`。
- **覆盖要求**: 环境变量预检、真实协议请求、BookRun completed、token/model_run、artifact 摘要、密钥不泄露。
### 5. 依赖和集成点

- **外部依赖**: OpenAI 兼容 `/chat/completions`；用户提供的 base URL 修正为 `https://yybb.codes`。
- **内部依赖**: Book、Blueprint、BookRun、Scene、ScenePacket、JudgeIssue、ModelRun、Artifact。
- **集成方式**: CLI 在 `apps/api` 下执行 `uv run python -m app.domains.book_runs.phase9b_real_llm_smoke`。
- **配置来源**: 临时进程环境变量 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_PROVIDER`。

### 6. 技术选型理由

- **为什么用这个方案**: README 和 current-phase 已明确真实 LLM 冒烟入口，复用既有 CLI 能保留项目证据链。
- **优势**: 不新增脚本、不持久化密钥、输出摘要脱敏、与现有 API 服务层一致。
- **劣势和风险**: 真实网络可能被沙箱限制；模型名未知需选择兼容默认值；真实调用耗时和 token 成本不可完全预估。

### 7. 关键风险点

- **并发问题**: 当前 CLI 单进程顺序跑章节，无并发写入风险。
- **边界条件**: 缺少环境变量返回退出码 2；真实请求失败返回退出码 1；token 超预算会暂停并失败。
- **性能瓶颈**: 真实 LLM 请求耗时，先跑 1 章再跑 3 章。
- **密钥处理**: API Key 只进入临时环境变量，不写入文件、报告或命令摘要。

### 8. 充分性检查

- 能定义接口契约：是，CLI 参数为 `--chapter-count` 与 `--token-budget`，环境变量为 `STORYFORGE_LLM_*`。
- 理解技术选型：是，复用项目既有真实 LLM 冒烟入口。
- 识别主要风险：是，网络、模型名、预算和密钥泄露。
- 知道如何验证：是，先 pytest 协议测试，再分别运行 1 章与 3 章真实 CLI。
