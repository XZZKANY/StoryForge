## 项目上下文摘要（storyforge-vscode-ide-p3-memory）

生成时间：2026-05-28 04:43:12

### 1. 相似实现分析

- **实现1**: pps/api/app/domains/story_memory/service.py
  - 模式：Story Memory 真相源已存在，提供 create_memory_atom、list_memory_atoms、get_active_memory_atoms、detect_memory_conflicts、pply_arbitration_decision。
  - 可复用：MemoryAtom 契约、MemoryAtomRecord 持久化、冲突检测与仲裁逻辑。
  - 需注意：当前 MemoryFactType 仍是 Phase 9 初版短枚举，P3 IDE 只能消费与映射，不应重写 Phase 9。
- **实现2**: pps/api/app/domains/ide/router.py / service.py / schemas.py
  - 模式：IDE 聚合端点集中在 /api/ide，schema/service/router 三层追加，不破坏旧端点。
  - 可复用：response_model、SessionDependency、404/查询参数风格。
  - 需注意：上一轮部分中文 docstring 因编码被写成问号，本轮会顺手修正触达文件。
- **实现3**: pps/web/components/ide/views/ContextInspector.tsx 与 pps/web/tests/ide-components.test.tsx
  - 模式：IDE 视图为 SSR-safe 纯组件，使用 node:test +
enderToStaticMarkup 验证文案和结构。
  - 可复用：只读卡片、列表与空状态展示方式。
  - 需注意：新增组件必须加入 pps/web/scripts/phase1-contract-test.mjs 转译列表。

### 2. 项目约定

- API 按 pps/api/app/domains/<domain>/schemas.py|service.py|router.py 分层；新增 IDE 端点追加到既有 IDE domain。
- Python 使用类型标注、Pydantic schema、简体中文 docstring。
- Web 当前组织在 pps/web/components/ide，不是计划中的 pps/web/src/ide。
- Web 测试使用
ode:test 与
eact-dom/server，测试 runner 需手工登记新 runtime module。

### 3. 可复用组件清单

- MemoryAtomRecord: pps/api/app/domains/story_memory/models.py
- MemoryAtom, MemoryConflict: pps/api/app/domains/story_memory/schemas.py
- list_memory_atoms, detect_memory_conflicts: pps/api/app/domains/story_memory/service.py
- EventLog/
ecord_event: 可作为后续审计事件来源；P3 本轮先覆盖冲突查询，不强行制造写操作。
- SidePanel / ActivityBar: IDE 左侧入口集成点。

### 4. 测试策略

- API：新增 pps/api/tests/test_ide_story_memory.py，用内存 SQLite 创建 Book 与 MemoryAtom，验证过滤、章节区间、冲突状态。
- Web：扩展 pps/web/tests/ide-components.test.tsx，SSR 验证 StoryMemoryExplorer 空状态、过滤摘要、冲突队列提示。
- 契约：运行 pnpm openapi，确认新增 /api/ide/story-memory/query。

### 5. 依赖和集成点

- 外部依赖：无新增依赖；先不用虚拟列表库，避免超出最小 P3 投影。
- 内部依赖：IDE service 调用 Story Memory service；Web Shell 左侧增加 memory 入口。
- 配置来源：现有 API main 已 include ide_router；OpenAPI 生成脚本会读取 FastAPI app。

### 6. 技术选型理由

- P3 明确“消费 Phase 9 Story Memory v2”，所以使用 MemoryAtomRecord 与现有服务，不新增存储表。
- POST /api/ide/story-memory/query 用请求体承载过滤条件，后续可扩展 entity/fact_type/chapter/conflict 状态。
- 冲突仲裁沿用 Phase 9 设计，本轮提供 conflict_queue 查询投影，写入审计的具体仲裁命令留给 P5 CommandRegistry 正式化。

### 7. 关键风险点

- 主计划 fact_type 标准枚举与现有 MemoryFactType 不完全一致，需在报告中标注“消费现有 Phase 9 枚举，P3 不重命名”。
- .codex/operations-log.md 可能仍被占用，必要时写补充日志。
- 当前工作区有大量未提交变更，本轮只做目标相关追加，避免覆盖无关文件。
