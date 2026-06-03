## 项目上下文摘要（伏笔生命周期读侧消费）

生成时间：2026-06-02 20:30:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/scene_packets/context_pipeline.py`
  - 模式：服务层将实体定位后交给 `assemble_scene_context`，由该函数统一串联检索、长效记忆召回、固定槽位和 compiled context。
  - 可复用：`assemble_scene_context` 已同时拥有 `session`、`payload.book_id`、`chapter`、`scene`、`assets`。
  - 需注意：同一 `assets` 会进入 `build_packet` 和 `attach_compiled_context`，适合作为读侧过滤的共同入口。
- **实现2**: `apps/api/app/domains/scene_packets/budget.py`
  - 模式：`build_packet` 从资产列表中按 `asset_type` 派生固定槽位。
  - 可复用：`asset_summary` 保留 `id`、`type`、`name`、`payload`，无需改动即可展示过滤后的资产载荷。
  - 需注意：当前 `"未回收伏笔"` 直接读取所有 `asset_type == "foreshadowing"` 的资产。
- **实现3**: `apps/api/app/domains/scene_packets/retrieval_bridge.py`
  - 模式：`build_context_blocks` 将同一资产列表转为 compiled context 的 asset block。
  - 可复用：`asset_context_blocks` 已统一处理 style 与非 style 资产。
  - 需注意：旧 asset payload 会作为 `kind="memory_atom"` 注入 compiled context，因此上游过滤更稳妥。
- **实现4**: `apps/api/app/domains/story_memory/service.py`
  - 模式：`list_foreshadow_lifecycle(session, book_id, foreshadow_id)` 读取同一伏笔按 revision 排序的 lifecycle 历史。
  - 可复用：最新状态取返回列表最后一项；`foreshadow_id` 使用资产 `lineage_key`。
  - 需注意：`paid_off` 和 `abandoned` 是终态，`planted` 和 `reinforced` 仍可保留。

### 2. 项目约定

- **命名约定**: Python 使用 `snake_case` 函数和变量，测试函数以 `test_` 开头。
- **文件组织**: scene packet 领域拆分为 service、assembly、context_pipeline、budget、retrieval_bridge。
- **导入顺序**: `from __future__ import annotations` 后按标准库、第三方、项目模块分组。
- **代码风格**: 类型标注明确，函数级简体中文 docstring 描述意图。

### 3. 可复用组件清单

- `app.domains.story_memory.service.list_foreshadow_lifecycle`: 查询伏笔 lifecycle 历史。
- `app.domains.scene_packets.budget.build_packet`: 固定槽位构造。
- `app.domains.scene_packets.retrieval_bridge.attach_compiled_context`: compiled context 注入。
- `app.domains.story_memory.service.apply_foreshadow_lifecycle_transition`: 测试中推进 lifecycle 状态。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: API 级 `TestClient` 与服务层 `assemble_scene_packet` 混合验证。
- **参考文件**: `apps/api/tests/test_scene_packet.py`、`apps/api/tests/test_scene_packet_context_compiler.py`、`apps/api/tests/test_foreshadow_lifecycle.py`。
- **覆盖要求**: paid_off 终态不进入 `"未回收伏笔"`；abandoned 终态旧 payload 不进入 `"上下文注入"` 或 `"上下文裁剪"` 的 asset block。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy ORM `Session.scalars(select(...)).all()`，Context7 确认为标准读取模式。
- **内部依赖**: scene packet 读侧依赖 assets、continuity、retrieval、story_memory、context_compiler。
- **集成方式**: 在 `assemble_scene_context` 开头生成 scoped assets，并传给检索、记忆召回、固定槽位与 compiled context。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 上游过滤一次即可覆盖固定槽位和 compiled context，避免在 `budget.py` 与 `retrieval_bridge.py` 重复判断。
- **优势**: 写集小、行为集中、复用 story_memory 公开服务。
- **劣势和风险**: 每个伏笔资产会触发一次 lifecycle 查询；scene packet 缓存键仍不包含 lifecycle revision。

### 7. 关键风险点

- **并发问题**: 其他代理正在改动大量文件，本任务仅写允许写集。
- **边界条件**: 无 lifecycle 历史的伏笔保留；缺少 `lineage_key` 的伏笔保留；终态过滤不影响角色和风格资产。
- **性能瓶颈**: 多伏笔资产时存在 N 次 lifecycle 查询，后续可按 story_memory 批量读取优化。
- **安全考虑**: 不读取 `.env`、API Key 或凭据文件；不触碰 provider 与真实 LLM。

### 8. 充分性检查

- 能定义接口契约：输入为 `assets`，输出为按 lifecycle 最新状态过滤和状态同步后的资产列表。
- 理解技术选型理由：共同上游过滤比下游重复过滤更小且一致。
- 识别主要风险点：缓存键未纳入 lifecycle revision、N 次查询、并发工作区。
- 知道如何验证实现：先运行新增定向测试红灯，再运行用户指定 pytest 与 `git diff --check`。
