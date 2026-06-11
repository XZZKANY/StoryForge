## 项目上下文摘要（运行全流程）

生成时间：2026-05-21 20:09:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：workflow 侧通过标准库 `urllib.request` 调用 OpenAI 兼容 `chat/completions`。
  - 可复用：`generate_text` 与 `provider_config`。
  - 需注意：真实调用依赖 `STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_MODEL`。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/workflow/tests/test_llm_provider.py`
  - 模式：本地 HTTPServer 模拟 OpenAI 兼容响应，验证请求协议。
  - 可复用：测试约定和环境变量注入方式。
  - 需注意：测试使用 `monkeypatch`，不会接触真实密钥。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/run-e2e.mjs`
  - 模式：Node 脚本编排 OpenAPI 刷新、契约测试、API 验证、workflow 验证。
  - 可复用：根脚本 `pnpm run e2e`。
  - 需注意：脚本会刷新共享 OpenAPI 契约文件。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/scripts/verify-local.ps1`
  - 模式：本地依赖和 Docker 容器预检。
  - 可复用：根脚本 `pnpm run verify`。
  - 需注意：Docker 未运行时会失败。
### 2. 项目约定

- **命名约定**：Python 使用 `snake_case`，TypeScript/Node 脚本使用 `camelCase`，包名采用 `@storyforge/*`。
- **文件组织**：API 位于 `apps/api`，Web 位于 `apps/web`，Workflow 位于 `apps/workflow`，共享契约位于 `packages/shared`。
- **导入顺序**：Python 先 `__future__`、标准库、项目模块；Node 脚本先 `node:*` 内置模块。
- **代码风格**：项目文档和注释使用简体中文；验证入口由根 `package.json` 统一暴露。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/provider_client.py`: OpenAI 兼容 LLM 调用客户端。
- `scripts/verify-local.ps1`: 本地依赖和容器预检。
- `scripts/run-e2e.mjs`: 契约、API 与 workflow 验证编排。
- `package.json`: 根级 `verify`、`test`、`e2e`、`openapi` 脚本。

### 4. 测试策略

- **测试框架**：Web/shared 使用 pnpm filter 脚本；API/workflow 使用 `uv run pytest`；E2E 使用 Node 内置测试和 Python pytest。
- **测试模式**：单元测试、服务层验收、契约验证、OpenAPI 刷新验证。
- **参考文件**：`apps/workflow/tests/test_llm_provider.py`、`scripts/run-e2e.mjs`。
- **覆盖要求**：真实 LLM 冒烟、根级测试、E2E、OpenAPI 生成均需本地记录退出码。
### 5. 依赖和集成点

- **外部依赖**：Node.js、pnpm、Python 3.11+、uv、Docker、OpenAI 兼容 LLM 端点。
- **内部依赖**：workflow provider client 由环境变量读取模型配置；E2E 会调用 API 与 workflow 测试。
- **集成方式**：本次只使用进程级环境变量注入，不修改 `.env.example` 或源代码。
- **配置来源**：`.env.example` 描述 `STORYFORGE_LLM_*`，运行时以进程环境覆盖。

### 6. 技术选型理由

- **为什么用这个方案**：仓库已有真实 provider client 和根级验证脚本，直接复用可避免重复造轮子。
- **优势**：不落盘密钥；验证命令与项目 README、package.json 保持一致；结果可审计。
- **劣势和风险**：网络受限、端点模型名不兼容或 Docker 未启动会导致部分验证失败。

### 7. 关键风险点

- **敏感信息**：API Key 不写入文件、日志、报告或命令输出。
- **网络问题**：当前沙箱网络可能限制真实端点访问，必要时按权限机制升级执行。
- **环境问题**：Docker 容器、uv 或 Python 版本缺失可能阻塞部分验证。
- **文件变化**：`pnpm run e2e` 与 `pnpm openapi` 可能刷新 OpenAPI 契约，需要检查 diff。
