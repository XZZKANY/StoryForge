## 项目上下文摘要（ScenePacket接入ContextCompiler）

生成时间：2026-05-18 21:15:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/scene_packets/service.py`
  - 模式：`assemble_scene_packet` 聚合章节、场景、资产、连续性记录、检索命中后写入 `ScenePacket.packet`。
  - 可复用：`_estimate_tokens`、`_fit_retrieval_snippets`、`EvidenceLinkRead`、检索命中自动转证据链接。
  - 需注意：当前 packet 没有 compiled_context_id、dropped context 或 Context Inspector 调试字段。
- **实现2**: `apps/api/app/domains/context_compiler/service.py`
  - 模式：纯服务函数 `compile_context` 接收 `ContextCompileRequest`，输出 `CompiledContext`。
  - 可复用：`ContextBlock`、`score_threshold`、`DroppedContextBlock`、`ContextBudgetReport`。
  - 需注意：需要保持 Scene Packet 兼容，不能替换既有中文槽位。
- **实现3**: `apps/api/tests/test_phase4_service_acceptance.py`
  - 模式：SQLite 内存库服务层验收，构造 workspace/series/book/chapter/scene/assets/retrieval 后调用服务函数。
  - 可复用：测试夹具和数据构造方式。
  - 需注意：本轮新增测试要先失败，验证 TDD RED。

### 2. 项目约定

- **命名约定**: Python 文件 snake_case，测试 `test_*.py`，Pydantic schema PascalCase。
- **文件组织**: 只修改 `scene_packets/service.py` 和新增服务层测试。
- **代码风格**: 中文 docstring/错误提示，服务层函数优先，避免新增数据库迁移。

### 3. 可复用组件清单

- `ContextBlock` / `ContextCompileRequest` / `compile_context`
- `RetrievalHitRead` 的 `score`、`rank`、`source_ref`
- Scene Packet 现有 `packet` 字段作为兼容扩展载体

### 4. 测试策略

- 先新增 `apps/api/tests/test_scene_packet_context_compiler.py`，断言 packet 中出现 `compiled_context_id`、`上下文注入`、`上下文裁剪`、`上下文预算`。
- 先运行测试确认失败，再实现。
- 验证 `uv run pytest tests/test_scene_packet_context_compiler.py tests/test_context_compiler.py tests/test_story_memory_contract.py -q`。

### 5. 依赖和集成点

- `scene_packets` 调用 `context_compiler`，不反向依赖。
- 本轮不改数据库模型，不改 `ScenePacketRead` schema。

### 6. 技术选型理由

保持现有 Scene Packet 兼容，同时把竞品成熟做法落入 packet 调试字段，使后续 Context Inspector 可以直接消费。

### 7. 关键风险点

- 预算太小可能导致 required block 超预算，因此测试需设置合理预算。
- 新增字段不能破坏既有 Phase 1/4 断言。
