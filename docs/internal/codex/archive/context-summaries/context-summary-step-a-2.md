## 项目上下文摘要（Step A-2）

生成时间：2026-05-25 21:15:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/judge/service.py`
  - 模式：领域服务函数先校验本地输入，再通过 `semantic_judge()` 获取结构化问题，失败时回退确定性规则。
  - 可复用：`JudgeIssueCreate`、`DetectedIssue`、`_issues_from_provider_items()` 与 `_issue_from_llm_item()`。
  - 需注意：无 API key 必须返回空列表；远程异常当前返回空列表，不能让测试访问真实网络。
- **实现2**: `apps/api/tests/test_judge_semantic.py`
  - 模式：pytest 直接构造 payload 或通过 TestClient 调 API，断言结构化字段。
  - 可复用：`DetectedIssue` 精确对象断言、中文测试说明、`monkeypatch` 环境变量隔离。
  - 需注意：`tests/conftest.py` 默认删除远程 LLM 环境变量，单测需显式 setenv。
- **实现3**: `apps/workflow/storyforge_workflow/provider_client.py`
  - 模式：OpenAI 兼容 Chat Completions 请求结构，包含 model、messages、temperature、Authorization header。
  - 可复用：请求体结构与环境变量读取方式。
  - 需注意：该文件仍用 urllib，本步骤只改 API judge，不扩大到 workflow。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case，测试函数以 `test_` 开头，类型注解保持显式。
- **文件组织**: API 领域逻辑位于 `apps/api/app/domains/<domain>/service.py`，测试位于 `apps/api/tests/`。
- **导入顺序**: `from __future__ import annotations` 后依次标准库、第三方库、项目模块。
- **代码风格**: 现有注释与测试说明使用简体中文；服务函数倾向小函数拆分并保持异常回退。

### 3. 可复用组件清单

- `apps/api/app/domains/judge/service.py:_issues_from_provider_items`: 统一将模型或测试替身返回值规整为 `DetectedIssue`。
- `apps/api/app/domains/judge/service.py:_issue_from_llm_item`: 对模型 JSON 字段做边界规整。
- `apps/api/tests/conftest.py:isolate_remote_llm_env`: 确保默认测试不依赖真实 LLM，需要单测内显式覆盖环境变量。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 优先单元测试 `semantic_judge()`，使用 monkeypatch 替换网络客户端，避免真实 HTTP。
- **参考文件**: `apps/api/tests/test_judge_semantic.py`、`apps/api/tests/test_judge_repair.py`、`apps/api/tests/test_db_session.py`。
- **覆盖要求**: 校验 URL、Authorization header、JSON payload、timeout 环境变量与响应解析。

### 5. 依赖和集成点

- **外部依赖**: `httpx`，Context7 `/encode/httpx` 文档确认 `httpx.Client(timeout=...)` 支持连接复用，`client.post(..., json=..., headers=...)` 支持 JSON 请求与 header。
- **内部依赖**: `semantic_judge()` 被 `create_judge_issues()` 调用；测试通过 provider 注入或本地替身隔离远程调用。
- **配置来源**: `STORYFORGE_JUDGE_LLM_API_KEY`、`STORYFORGE_LLM_API_KEY`、`STORYFORGE_JUDGE_LLM_BASE_URL`、`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_JUDGE_LLM_MODEL`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS`。
### 6. 技术选型理由

- **为什么用这个方案**: `.dev_plan.md` 明确要求替换 urllib 为 httpx；httpx 是 FastAPI 生态常用同步/异步 HTTP 客户端，Client 提供连接复用和统一 timeout。
- **优势**: 请求参数更直接，测试替身更容易捕获 `post()` 入参，减少手写 bytes 和 `urlopen` 资源管理。
- **劣势和风险**: 本步骤仍是同步远程调用，长耗时请求需由 A-3 的后台任务处理；异常仍按现有契约吞掉并返回空列表。

### 7. 关键风险点

- **并发问题**: 单次调用创建 Client 可获得标准连接管理，但无法解决批量评审的长请求阻塞。
- **边界条件**: 模型返回非列表、缺少 choices、JSON 无效、HTTP 客户端异常时必须返回空列表。
- **性能瓶颈**: 每次调用创建 Client 的连接池生命周期较短；后续如需更高吞吐可抽象共享客户端，但本步骤不引入额外复杂度。
- **安全考虑**: 本任务仅说明配置来源与默认测试隔离，不把安全需求设为验收条件。

### 8. 检索限制记录

- 已尝试发现 GitHub `search_code` 工具，但当前会话未暴露该工具；未使用网页替代，以避免偏离本地计划执行。
