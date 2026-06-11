## 项目上下文摘要（Provider、预算和暂停原因可视化）

生成时间：2026-06-03 01:16:35 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py:136-158`
  - 模式：BookRun progress 回填时统一合并受控摘要、写入成本统计，并在服务层执行状态门禁。
  - 可复用：`apply_book_run_progress()`、`_budget_from_progress()`、`_checkpoint_from_progress()`。
  - 需注意：`completed` 是运行闭环终态，预算门禁必须避免把它误改为暂停。
- **实现2**: `apps/web/components/home/assistant-tool-node-mapper.ts:20-76`
  - 模式：前端只把 BookRunRead 事实源映射为 AssistantToolNode，不在 UI 层伪造工具完成状态。
  - 可复用：`mapBookRunToAssistantToolNodes()`、`providerSummary()`、`formatTokenLabel()`、`formatBudgetLabel()`。
  - 需注意：Provider 不可用时章节节点必须强制 failed，不能沿用原始 completed/running。
- **实现3**: `apps/web/app/settings/ProviderSettingsPanel.tsx:5-89`
  - 模式：Provider 设置页只把 OpenAI-compatible Base URL 保存到浏览器 localStorage，并通过 `/api/provider-models` 检测模型列表。
  - 可复用：`readStoredSettings()`、`saveProviderSettings()`、`testProviderEndpoint()`。
  - 需注意：API Key 不能进入普通前端本地状态；检测状态不是 Assistant 统一运行时事实源。
- **实现4**: `apps/api/app/domains/book_runs/phase9b_real_llm_smoke.py`
  - 模式：真实 LLM smoke 使用预算、暂停和审计记录控制长运行风险。
  - 可复用：真实 LLM 阶段的预算意识和暂停原因记录模式。
  - 需注意：本阶段没有声明真实 LLM 10 章或 3-5 万字完成，仅补齐 Assistant 可视化与 BookRun 门禁。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；TypeScript 类型字段保持后端 OpenAPI 的 snake_case；前端 helper 使用 camelCase。
- **文件组织**: 后端状态与预算门禁集中在 BookRun service；前端展示逻辑集中在 Assistant tool node mapper；Provider 设置独立在 settings 面板。
- **导入顺序**: 沿用现有文件顺序，未新增外部依赖。
- **代码风格**: 测试描述、注释、日志和报告均使用简体中文；不读取 `.env`，不落盘真实 API Key。

### 3. 可复用组件清单

- `apps/api/app/domains/book_runs/service.py`: `apply_book_run_progress()`、`_budget_exceeded()`、`_budget_from_progress()`。
- `apps/api/app/domains/book_runs/schemas.py`: `BookRunProgressUpdate`、BookRunRead 预算字段。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: Provider、预算、暂停原因到工具树节点的映射。
- `apps/web/app/settings/ProviderSettingsPanel.tsx`: Provider Base URL 保存和 `/api/provider-models` 检测入口。
- `apps/web/tests/assistant-tool-node-mapper.test.ts`: Provider 不可用、预算展示、暂停原因兜底的契约测试。
- `apps/api/tests/test_book_runs.py`: BookRun 创建、进度回填、预算门禁和 completed 防误暂停测试。

### 4. 测试策略

- **测试框架**: 后端使用 pytest；前端使用 `node:test` 契约测试；TypeScript 使用 `tsc --noEmit`。
- **测试模式**: API 服务层/HTTP 回填测试 + 前端 mapper 字符串和状态契约测试 + 设置页源码契约测试。
- **参考文件**: `apps/api/tests/test_book_runs.py`、`apps/web/tests/assistant-tool-node-mapper.test.ts`、`apps/web/tests/settings-page.test.ts`。
- **覆盖要求**: token/time/chapter 预算触顶自动暂停；completed 不被预算门禁误暂停；Provider 不可用不能伪装运行或完成；无预算上限时展示已用量；paused_by_budget 缺原因时显示兜底。

### 5. 依赖和集成点

- **外部依赖**: 无新增外部依赖。
- **内部依赖**: BookRun progress、Provider Gateway resolution summary、AssistantToolNode、Provider settings API。
- **集成方式**: 后端在 BookRun progress 回填时写入 `pause_reason` 与 `budget_exceeded`；前端读取 BookRunRead 的 provider 和预算字段映射为工具树节点。
- **配置来源**: Provider 可用性来自服务端 Provider Gateway 解析摘要；前端设置页只保存 Base URL，不保存 API Key。

### 6. 技术选型理由

- **为什么用这个方案**: 预算门禁放在 BookRun service 可以覆盖 workflow、Assistant 和 HTTP 回填路径；工具树只做事实源映射，避免 UI 伪状态。
- **优势**: 状态来源单一、测试面窄、不会新增大型 Agent 框架或自研安全边界。
- **劣势和风险**: 多预算同时触顶时当前只展示第一个原因，优先级为 token > time > chapter；settings 页仍主要依赖源码契约测试，后续可补浏览器交互测试。

### 7. 关键风险点

- **并发问题**: 多个 workflow 回填同一 BookRun progress 时仍依赖现有数据库事务边界，本阶段未新增锁策略。
- **边界条件**: `BookRunProgressUpdate.progress` 仍是自由字典，预算字段异常时会按既有 `_budget_from_progress()` 归零。
- **性能瓶颈**: 预算门禁为常数时间判断，不引入额外 I/O。
- **安全考虑**: 不读取 `.env`，不写入真实 API Key；ProviderSettings 只保存 `baseUrl`。

