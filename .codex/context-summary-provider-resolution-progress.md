## 项目上下文摘要（Provider 预检真实写入）

生成时间：2026-06-02 17:34:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py`
  - 模式：BookRun service 层负责创建、读取、暂停、恢复、停止和进度回填。
  - 可复用：`create_book_run()` 初始化 `progress`；`pause_book_run()`、`stop_book_run()`、`resume_book_run()` 均采用复制现有 progress 后整体赋值。
  - 需注意：`apply_book_run_progress()` 接收 workflow payload 后需要保留创建期 `provider_resolution`，除非 payload 明确提供新的 Provider 摘要。
- **实现2**: `apps/api/app/domains/provider_gateway/service.py`
  - 模式：Provider Gateway 统一解析数据库 provider、环境 provider 和 fallback provider，并带 Redis 缓存。
  - 可复用：`resolve_provider(session, "llm")` 返回 `ProviderResolutionRead`，包含 `provider_name`、`resolution_source`、`credential_status` 和 `resolution_summary`。
  - 需注意：不得在 BookRun progress 中写入 `credential_ref` 或真实 API Key。
- **实现3**: `apps/web/components/home/assistant-tool-node-mapper.ts`
  - 模式：前端工具树只读取 BookRunRead 真相源并映射节点状态。
  - 可复用：`progress.provider_resolution.ok === false` 时 Provider 节点 failed，章节节点不伪装 running/completed。
  - 需注意：后端字段需要保持 `ok`、`provider_name`、`unavailable_reason` 等既有消费契约。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；Pydantic/SQLAlchemy 模型字段沿用现有 lower_snake_case。
- **文件组织**: BookRun 创建逻辑放在 `apps/api/app/domains/book_runs/service.py`，Provider 解析逻辑保留在 `provider_gateway` 域。
- **导入顺序**: 标准库、第三方、应用内模块分组；本次只新增应用内 provider_gateway 导入。
- **代码风格**: 使用中文 docstring 描述业务意图；服务函数提交后 `session.refresh()`。

### 3. 可复用组件清单

- `app.domains.provider_gateway.service.resolve_provider`: 统一 Provider 解析入口。
- `app.domains.provider_gateway.schemas.ProviderResolutionRead`: Provider 解析返回 schema。
- `apps/api/tests/test_book_runs.py::seed_locked_blueprint`: BookRun API 测试夹具。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: Provider 预检摘要消费方。

### 4. 测试策略

- **测试框架**: pytest、FastAPI TestClient、Node TAP。
- **测试模式**: API 契约测试先红后绿；前端 mapper 回归验证。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/api/tests/test_provider_gateway.py`、`apps/web/tests/assistant-tool-node-mapper.test.ts`。
- **覆盖要求**: 默认 deterministic 可用场景、真实 LLM provider 缺 key fallback 场景、脱敏字段不包含 `credential_ref`。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy ORM、FastAPI、pytest。
- **内部依赖**: BookRun service 依赖 Provider Gateway service，但 Provider Gateway 不依赖 BookRun。
- **集成方式**: `create_book_run()` 创建时调用 `resolve_provider(session, "llm")`，将脱敏摘要写入 `progress.provider_resolution`。
- **配置来源**: `STORYFORGE_LLM_PROVIDER`、`STORYFORGE_LLM_MODEL`、`STORYFORGE_LLM_API_KEY` 等环境变量由 Provider Gateway 读取。

### 6. 技术选型理由

- **为什么用这个方案**: 复用现有 Provider Gateway，避免 BookRun 自行解析环境变量或凭据；回填时沿用既有 progress 整体赋值模式，但先补齐必须跨阶段保留的 Provider 摘要。
- **优势**: 字段来自后端真实事实源；前端已有 mapper 可直接消费；不会泄露凭据。
- **劣势和风险**: workflow 若显式传入新的 `provider_resolution` 会覆盖创建期摘要，后续需要确保该新摘要同样脱敏。

### 7. 关键风险点

- **并发问题**: BookRun 创建是单次写入，Provider Gateway 有缓存，当前无新增并发写冲突。
- **边界条件**: provider 配置存在但缺少密钥时，`credential_status=missing_fallback` 且 `ok=false`。
- **性能瓶颈**: 创建 BookRun 时多一次 provider 解析；Provider Gateway 已有 Redis 和 LRU 缓存，影响可控。
- **安全考虑**: progress 只保存脱敏摘要，不保存 API Key、`credential_ref` 或密钥值。
