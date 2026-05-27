## 项目上下文摘要（Phase 9C-3a 章节节奏标签）

生成时间：2026-05-27 12:08:54 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/blueprints/service.py`
  - 模式：从 `BookBlueprint.metadata_` 读取 `pov`、`location`、`title_seed` 等规划参数。
  - 可复用：`BookBlueprint.metadata_` JSON 扩展点。
  - 需注意：不新增表结构即可扩展 metadata。
- **实现2**: `apps/api/app/domains/scene_packets/context_pipeline.py`
  - 模式：`build_packet()` 后追加 `memory_context`，再附加 compiled context 调试字段。
  - 可复用：`assemble_scene_context()` 的 packet 后处理位置。
  - 需注意：新增字段应在缓存写入前完成。
- **实现3**: `apps/api/app/domains/scene_packets/retrieval_bridge.py`
  - 模式：把场景目标、资产、连续性和检索材料转为可解释上下文块。
  - 可复用：保持 Scene Packet 层只汇总上下文，不把业务规则散到测试或路由。
  - 需注意：pacing 指令先作为 packet 槽位进入，后续可再扩展为 context block。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；模型字段对数据库保留字使用 `metadata_`。
- **文件组织**: API 领域代码位于 `apps/api/app/domains/<domain>/`，测试位于 `apps/api/tests/`。
- **导入顺序**: `from __future__ import annotations`、第三方库、本地 app 模块。
- **代码风格**: 简短中文 docstring；服务函数保持小粒度；不新增外部依赖。

### 3. 可复用组件清单

- `BookBlueprint.metadata_`: Blueprint metadata JSON 来源。
- `Chapter.blueprint_id`: 目标章节关联蓝图的现有外键。
- `assemble_scene_packet()` / `assemble_scene_context()`: Scene Packet 装配入口。
- `ScenePacketCreate`: 服务层测试构造上下文包的既有输入契约。
### 4. 测试策略

- **测试框架**: pytest + SQLAlchemy 内存 SQLite fixture。
- **测试模式**: 服务层直接调用 `assemble_scene_packet()`，断言 `packet.packet` 固定槽位。
- **参考文件**: `tests/test_context_compiler_memory_injection.py`、`tests/test_scene_packet.py`、`tests/test_blueprint_api.py`。
- **覆盖要求**: 红灯测试先验证 climax 章节包缺少 `pacing_directive`；绿灯后跑目标测试、Scene Packet 回归和 ruff。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy JSON 字段；Context7 已确认 SQLAlchemy 2.0 支持 `mapped_column(JSON)` 存储 dict/list。
- **内部依赖**: `scene_packets.context_pipeline` 需要读取 `BookBlueprint`；`Chapter.blueprint_id` 决定是否能解析 Blueprint metadata。
- **集成方式**: 在 `build_packet()` 后、`attach_compiled_context()` 前注入 `packet["pacing_directive"]`。
- **配置来源**: `BookBlueprint.metadata_["pacing_tag"]`。

### 6. 技术选型理由

- **为什么用这个方案**: Blueprint 已有 JSON metadata 扩展点，Scene Packet 已有追加上下文槽位的模式。
- **优势**: 无迁移、改动面小、与 9C-1a memory_context 注入一致。
- **劣势和风险**: pacing_tag 格式未在旧代码定义，需要 helper 支持字符串、列表和章节序号映射。

### 7. 关键风险点

- **边界条件**: 缺失 blueprint_id、缺失 metadata、非法 tag 时不注入。
- **性能瓶颈**: 每次装配最多增加一次主键查询，当前可接受。
- **安全考虑**: 本任务不新增认证、鉴权或远程调用。
