## 项目上下文摘要（Provider Gateway 配置真实化）

生成时间：2026-05-18 17:11:48 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/provider_gateway/service.py:1-47`
  - 模式：服务层负责数据库 provider 创建、列表和能力解析。
  - 可复用：`list_provider_configs`、`resolve_provider`、`ProviderGatewayError`。
  - 需注意：现有数据库 provider 排序必须保持优先级和 id 稳定。
- **实现2**: `apps/api/app/domains/retrieval/service.py:1-204`
  - 模式：Phase 4 使用确定性 `_fake_embedding` 与关键词评分保持本地可验证。
  - 可复用：无真实密钥时保留本地 deterministic/local 回退的边界表达。
  - 需注意：本轮不替换检索索引与 chunk 逻辑。
- **实现3**: `apps/workflow/storyforge_workflow/runtime/provider_execution.py:1-35`
  - 模式：workflow runtime 通过 `simulate_provider_execution` 生成确定性 provider 结果。
  - 可复用：确定性 provider 名称和模型别名的回退思路。
  - 需注意：本轮不接入真实网络模型调用。
### 2. 项目约定

- **命名约定**: Python 使用 snake_case；环境变量使用 `STORYFORGE_*` 大写下划线；API 能力使用小写字符串。
- **文件组织**: Provider Gateway 相关实现放在 `apps/api/app/domains/provider_gateway/`；测试放在 `apps/api/tests/`；审计文件放在项目本地 `.codex/`。
- **导入顺序**: 标准库、第三方库、本地 `app.*` 模块分组。
- **代码风格**: 用户可见错误、注释、测试说明和审计记录使用简体中文。

### 3. 可复用组件清单

- `ProviderConfig`: 保存数据库 provider 真相源与 `credential_ref`。
- `ProviderResolutionRead`: 对外返回 provider 解析结果。
- `list_provider_configs`: 保持全局 provider 与工作区 provider 的合并排序。
- `simulate_provider_execution`: 后续 workflow 调用链的确定性回退参考。
### 4. 测试策略

- **测试框架**: 根级 `pnpm run test:api` 实际执行 Python `compileall`；目标 pytest 在当前 Python 环境缺少 `pytest` 时需记录限制。
- **参考文件**: `apps/api/tests/test_provider_gateway.py`、`apps/api/tests/test_phase3_service_acceptance.py`、`apps/api/tests/test_phase4_service_acceptance.py`。
- **覆盖要求**: 数据库 provider 优先、LLM 环境配置、embedding 回退、reranker 回退、未知能力拒绝。

### 5. 依赖和集成点

- **外部依赖**: 使用既有 `pydantic`，不新增 `pydantic-settings` 或真实 provider SDK。
- **内部依赖**: `provider_gateway.service` 调用新增运行时配置解析；后续 Phase 5 可接入 embedding、reranker 和 workflow ModelRun。
- **配置来源**: `.env.example` 已定义 `STORYFORGE_LLM_*`、`STORYFORGE_EMBEDDING_*`、`STORYFORGE_RERANKER_*`。
### 6. 技术选型理由

- **为什么用这个方案**: P1 要求先区分 LLM、embedding、reranker，并保证未配置密钥时稳定回退；在 Provider Gateway 域内解析环境变量能最小化影响面。
- **优势**: 不触碰 Phase 1-4 主线，不引入外网调用，保留数据库 provider 优先级，并让后续真实客户端有明确配置入口。
- **劣势和风险**: 当前仍不执行真实模型调用；目标 pytest 因环境缺少 pytest 无法运行，只能用 compileall 和轻量 smoke 补偿。

### 7. 关键风险点

- **边界条件**: 未知 capability 必须拒绝，避免静默落入错误 provider。
- **性能瓶颈**: 环境解析为本地轻量读取，无明显 I/O 风险。
- **验证风险**: 当前 Python 环境缺少 `pytest`、`sqlalchemy`，服务层完整 pytest 需在依赖环境可用后补跑。
- **不重复 Phase 1-4**: 本轮只扩展 Phase 5 配置解析，不重做既有工程闭环。
