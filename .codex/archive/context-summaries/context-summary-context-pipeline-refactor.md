# 项目上下文摘要（Context Pipeline 重构）

生成时间：2026-05-24 16:25:00

## 1. 任务目标

先处理上一轮评分中最恶心的 `Context / Scene Packet / Retrieval` 交界面。第一刀只做小步隔离：把 `assemble_scene_packet()` 中的上下文装配细节移到独立管线，保持 API 行为、响应字段、数据库事务次数不变。

## 2. 已分析的代表性实现

- `apps/api/app/domains/scene_packets/service.py`
  - 现状：同时负责章节/场景/资产校验、连续性记录读取、证据链接读取、检索补全、检索证据构造、预算组包、compiled context 附着、ScenePacket 持久化。
  - 风险：单函数承担过多职责，是当前最恶心链路的直接入口。
- `apps/api/app/domains/scene_packets/retrieval_bridge.py`
  - 现状：已有 `build_retrieval_query()`、`attach_compiled_context()`、`build_context_blocks()` 等底层能力。
  - 复用策略：不重写上下文编译算法，只复用这些函数。
- `apps/api/app/domains/scene_packets/budget.py`
  - 现状：已有 `build_packet()` 和 `estimate_tokens()`，负责预算槽位和检索片段预算。
  - 复用策略：新管线继续调用该模块，避免重复造预算逻辑。
- `apps/api/tests/test_scene_packet.py`
  - 现状：覆盖 Scene Packet 固定槽位、证据链接、预算统计、低预算硬约束、检索升级等行为。
  - 验证价值：可证明响应结构不变。
- `apps/api/tests/test_context_compiler_persistence.py`
  - 现状：覆盖 compiled context 持久化、外层事务统一提交、可反查快照。
  - 验证价值：可证明 commit 次数不变。

## 3. 现有测试基线

命令：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_scene_packet.py tests/test_context_compiler_persistence.py -q
```

结果：`9 passed in 0.52s`

## 4. 目标设计

新增 `apps/api/app/domains/scene_packets/context_pipeline.py`：

- `SceneContextAssembly`：装配结果对象，包含 `packet`、`budget_statistics`、`evidence_links`、`retrieval_hits`。
- `assemble_scene_context(...)`：接收 session、payload、chapter、scene、assets、continuity_records、evidence_links，输出 `SceneContextAssembly`。
- `retrieval_evidence_links(...)`：把 Retrieval hit 转成 `EvidenceLinkRead`，让检索证据构造从 `service.py` 脱离。

修改 `service.py`：

- 保留实体定位、资产范围校验、连续性加载、证据链接加载、ScenePacket 持久化。
- 删除直接导入 `search_retrieval`、`RetrievalSearchCreate`、`RetrievalHitRead`、`_build_packet`、`_estimate_tokens`、`_attach_compiled_context`、`_build_retrieval_query`。
- 调用 `assemble_scene_context()` 获取 packet 和统计结果。

## 5. 风险与约束

- 不改变 `/api/scene-packets` 响应字段。
- 不改变 `assemble_scene_packet()` 的公开函数签名。
- 不改变 compiled context 的持久化事务边界。
- 不引入新依赖。
- 不触碰 Workflow 图、前端和数据库迁移。
