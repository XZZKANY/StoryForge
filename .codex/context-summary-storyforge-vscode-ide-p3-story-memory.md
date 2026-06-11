## 项目上下文摘要（StoryForge VS Code IDE P3 Story Memory）

生成时间：2026-05-28 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/ide/service.py`
  - 模式：`_BUILTIN_COMMANDS` 注册命令，`execute_ide_command_by_id` 统一返回 `IdeCommandResult`。
  - 可复用：`IdeCommandDefinition`、`execute_ide_command_by_id`、写命令 `audit_event_id` 前缀。
  - 需注意：当前命令是审计薄壳，payload 只回显 args，不做真实业务状态写回。

- **实现2**: `apps/api/tests/test_ide_commands.py`
  - 模式：通过 `TestClient.post('/api/ide/commands/{id}')` 验证写命令审计 ID 和 payload args。
  - 可复用：`judge.approve` 审计契约测试结构。
  - 需注意：新增 `memory.resolve_conflict` 测试应沿用同一断言风格。

- **实现3**: `apps/web/components/ide/views/StoryMemoryExplorer.tsx`
  - 模式：纯渲染组件消费 `StoryMemoryResult`，通过 `data-command-id` 和 `data-command-args` 暴露命令入口。
  - 可复用：现有 conflict_queue 渲染与 JSON.stringify 参数方式。
  - 需注意：当前参数缺少 `left_memory_id`、`right_memory_id`、`resolution`、`winner_memory_id` 和 `source_refs`。
### 2. 项目约定

- **命名约定**：Python 使用 snake_case；TypeScript 类型与组件使用 PascalCase，属性使用 camelCase 或后端契约字段原名。
- **文件组织**：IDE 聚合端点位于 `apps/api/app/domains/ide/*`；Story Memory 真相源位于 `apps/api/app/domains/story_memory/*`；前端 IDE 视图位于 `apps/web/components/ide/views/*`。
- **导入顺序**：标准库、第三方库、项目内部模块分组；现有文件不强制字母序但保持局部一致。
- **代码风格**：Pydantic 契约类带简短中文 docstring；React 组件使用只读类型和静态渲染契约测试。

### 3. 可复用组件清单

- `apps/api/app/domains/ide/service.py`: `execute_ide_command_by_id` 统一命令执行和审计 ID 生成。
- `apps/api/app/domains/ide/schemas.py`: `IdeCommandRequest`、`IdeCommandResult`、`IdeStoryMemoryQueryResult`。
- `apps/api/app/domains/story_memory/service.py`: `detect_memory_conflicts`、`arbitrate_proposal`、`apply_arbitration_decision`。
- `apps/web/components/ide/commands/registry.ts`: `CommandRegistry.execute` 统一远程命令入口。
- `apps/web/components/ide/views/StoryMemoryExplorer.tsx`: Story Memory 过滤结果与冲突队列展示。

### 4. 测试策略

- **测试框架**：后端使用 pytest + Starlette TestClient；前端使用 `node:test`、React `renderToStaticMarkup`。
- **测试模式**：后端契约测试直接断言 JSON；前端组件测试断言静态 HTML 中的机器可读属性。
- **参考文件**：`apps/api/tests/test_ide_commands.py`、`apps/api/tests/test_ide_story_memory.py`、`apps/web/tests/ide-components.test.tsx`。
- **覆盖要求**：保留查询过滤测试；新增冲突仲裁命令审计 payload 和前端完整命令 args。
### 5. 依赖和集成点

- **外部依赖**：FastAPI 使用 `response_model` 和 Pydantic 模型序列化；Context7 已查询 `/fastapi/fastapi`。
- **内部依赖**：`StoryMemoryExplorer` 消费 `IdeStoryMemoryQueryResult` 同构字段；写操作通过 `CommandRegistry` 和 `/api/ide/commands/{id}`。
- **集成方式**：只读查询走 `/api/ide/story-memory/query`；冲突仲裁按钮暴露 `data-command-*` 供命令系统接管。
- **配置来源**：OpenAPI 由后端 schema 生成；本切片若不改 schema 则无需刷新。

### 6. 技术选型理由

- **为什么用这个方案**：主计划要求写操作统一经命令链；现有命令薄壳已经覆盖审计 ID 生成，最小补强可避免新增绕路写接口。
- **优势**：复用既有命令治理、测试样式和前端机器可读属性，改动面小。
- **劣势和风险**：`story_memory.models.py` 当前只有 `MemoryAtomRecord`，没有冲突仲裁持久化表；本切片只能记录仲裁意图和审计 ID，不能宣称真实冲突状态已消除。

### 7. 关键风险点

- **并发问题**：真实冲突状态写回未来需要版本或事务保护；当前不改状态，因此无新增并发写风险。
- **边界条件**：按钮默认选择 `keep_left`，必须在 args 中明确 `winner_memory_id`，避免后端无法复盘人工选择。
- **性能瓶颈**：本切片仅增加少量 JSON 字段，无列表性能影响。
- **安全考虑**：按项目规则不新增安全控制；仅记录不绕过审计链的操作路径。

### 8. 检索缺口记录

- `github.search_code` 未在当前工具集中暴露；已通过 `tool_search` 搜索确认没有可调用工具。本次以项目内 3 个以上既有实现和 Context7 官方文档作为依据。
## 补充上下文：页面真实查询接入

生成时间：2026-05-28 00:00:00

- `apps/web/app/ide/page.tsx` 已按 `inspector` URL 参数读取 Context Snapshot，使用 `readJson` 和本地类型守卫验证响应。
- `apps/web/components/ide/shell/ide-store.ts` 是 IDE 初始状态单一入口，适合追加 `storyMemoryResult`。
- `apps/web/components/ide/shell/IdeShell.tsx` 负责把初始状态传给 `SidePanel`、`EditorArea` 等区域。
- `apps/web/components/ide/shell/SidePanel.tsx` 当前在 `activePanel === 'memory'` 时渲染空 `StoryMemoryExplorer`。
- 只读 Story Memory 查询应复用 REST，不通过 `CommandRegistry`；写操作仍只通过 `memory.resolve_conflict` 命令。