## 项目上下文摘要（架构改造第一轮）

生成时间：2026-05-18 20:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/scene_packets/service.py`
  - 模式：服务层函数接收 Pydantic schema，组装结构化上下文并返回 Read schema。
  - 可复用：预算估算、检索证据链接、Scene Packet 槽位思想。
  - 需注意：现有逻辑只做检索片段裁剪，不提供竞品级注入策略、丢弃原因和调试视图。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：确定性 chunk、关键词评分、rank 输出，服务层可纯本地测试。
  - 可复用：`RetrievalHitRead`、score、rank、source_ref、chunk_id。
  - 需注意：Phase 5 后续要替换为真实 embedding/reranker，但本轮不引入外部调用。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/worldbuilding/service.py`
  - 模式：聚合资产、系列记忆、连续性记录为只读中心。
  - 可复用：世界观中心聚合边界，API 仍是真相源。
  - 需注意：静态聚合无法表达 Novelcrafter 式 Progression 和按章节有效的事实版本。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_phase4_service_acceptance.py`
  - 模式：服务层验收使用 SQLite 内存库和 pytest，避免 TestClient 阻塞。
  - 可复用：新增架构契约测试优先使用纯服务层 pytest。

### 2. 项目约定

- **命名约定**: Python 模块 snake_case，Pydantic 类 PascalCase，服务函数动词短语。
- **文件组织**: 新增领域放入 `apps/api/app/domains/*`，测试放入 `apps/api/tests/*`。
- **导入顺序**: `__future__`、标准库、第三方库、本地 app 模块。
- **代码风格**: 文档、注释、错误消息使用简体中文；代码标识符保持英文。

### 3. 可复用组件清单

- `RetrievalHitRead`: 作为 Context Compiler 的检索证据输入之一。
- `ScenePacket` 思想：保留 Scene Packet 作为编译上下文的下游消费方。
- `WorldbuildingCenterRead` 思想：Story Memory 后续可向世界观中心供给版本化事实。

### 4. 测试策略

- **测试框架**: pytest + `python -m compileall`。
- **测试模式**: 本轮新增纯服务层契约测试，不依赖 HTTP TestClient。
- **参考文件**: `apps/api/tests/test_phase4_service_acceptance.py`、`apps/api/tests/test_provider_gateway.py`。
- **覆盖要求**: 上下文预算裁剪、丢弃原因、score threshold、章节有效区间、事实冲突检测、Agent Proposal 禁止直接写真相源。

### 5. 依赖和集成点

- **内部依赖**: `context_compiler` 依赖 schema 输入，不直接依赖数据库；`story_memory` 提供未来数据库模型前的契约层。
- **集成方式**: 后续由 `scene_packets` 调用 Context Compiler，由 `workflow` 仅保存 `compiled_context_id` 和 revision 引用。
- **配置来源**: 本轮不新增环境变量。

### 6. 技术选型理由

- 采用 Sudowrite 的上下文优先级/排除顺序思想。
- 采用 Novelcrafter 的 Progressions 与系列级 Codex 思想。
- 采用 NovelAI 的 Token Budget、Reserved Tokens、Insertion Position、Context Debug 思想。
- 采用 SillyTavern 的 score threshold、chunk、injection position 思想。
- 采用 LangGraph 的 checkpoint/state/store 分层，Graph State 只存引用。

### 7. 关键风险点

- **边界风险**: 本轮不做数据库迁移，避免与现有未提交变更叠加。
- **性能风险**: Context Compiler 必须先做预算裁剪，避免真实 RAG 接入后 TTFT 变长。
- **一致性风险**: MemoryAtom 必须带章节有效区间，否则无法表达角色和世界观变化。
