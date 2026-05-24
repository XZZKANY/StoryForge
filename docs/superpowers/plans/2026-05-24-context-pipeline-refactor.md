# Context Pipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 隔离 Scene Packet 的上下文装配管线，降低 `assemble_scene_packet()` 的职责复杂度，同时保持外部行为不变。

**Architecture:** 新增 `context_pipeline.py` 承接检索补全、检索证据构造、预算组包、compiled context 附着。`service.py` 只保留请求级实体定位、输入校验和持久化。底层继续复用 `budget.py` 与 `retrieval_bridge.py`。

**Tech Stack:** Python 3.11+、FastAPI、SQLAlchemy、Pydantic、pytest。

---

### Task 1: 建立上下文装配管线文件

**Files:**
- Create: `apps/api/app/domains/scene_packets/context_pipeline.py`
- Reference: `apps/api/app/domains/scene_packets/service.py`
- Reference: `apps/api/app/domains/scene_packets/retrieval_bridge.py`
- Reference: `apps/api/app/domains/scene_packets/budget.py`

- [ ] **Step 1: 创建结果对象和函数骨架**

创建 `SceneContextAssembly` dataclass，字段为：

```python
packet: dict[str, object]
budget_statistics: BudgetStatistics
evidence_links: list[EvidenceLinkRead]
retrieval_hits: list[RetrievalHitRead]
```

- [ ] **Step 2: 搬移检索补全逻辑**

当 `payload.retrieval_snippets` 为空时，通过 `build_retrieval_query()` 和 `search_retrieval()` 获取命中，并把 excerpt 回写到 payload copy。

- [ ] **Step 3: 搬移检索证据构造**

将 retrieval hit 转为 `EvidenceLinkRead`，字段与原 `service.py` 保持一致，包括 `score_source`、`keyword_score`、`embedding_score`、`rerank_score`、`context_tokens`。
- [ ] **Step 4: 组包并附着 compiled context**

调用 `build_packet()` 生成 packet 和预算统计；有 retrieval hits 时写入 `packet["检索命中"]`；最后调用 `attach_compiled_context()`。

### Task 2: 瘦身 service.py

**Files:**
- Modify: `apps/api/app/domains/scene_packets/service.py`
- Create: `apps/api/app/domains/scene_packets/context_pipeline.py`

- [ ] **Step 1: 替换导入**

从 `service.py` 删除对 retrieval service、budget build、retrieval bridge 的直接 orchestration 导入，新增：

```python
from app.domains.scene_packets.context_pipeline import assemble_scene_context
```

- [ ] **Step 2: 替换组装代码块**

将原检索补全到 `_attach_compiled_context()` 的代码替换为：

```python
context_assembly = assemble_scene_context(
    session=session,
    payload=payload,
    chapter=chapter,
    scene=scene,
    assets=assets,
    continuity_records=continuity_records,
    evidence_links=evidence_links,
)
```

- [ ] **Step 3: 持久化使用管线输出**

`ScenePacket` 的 `packet` 使用 `context_assembly.packet`，返回值使用 `context_assembly.budget_statistics` 和 `context_assembly.evidence_links`。

### Task 3: 验证行为不变

**Files:**
- Test: `apps/api/tests/test_scene_packet.py`
- Test: `apps/api/tests/test_context_compiler_persistence.py`

- [ ] **Step 1: 运行目标测试**

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_scene_packet.py tests/test_context_compiler_persistence.py -q
```

期望：`9 passed`。

- [ ] **Step 2: 运行编译检查**

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run python -m compileall app tests
```

期望：退出码 0。

- [ ] **Step 3: 静态检查职责边界**

确认 `service.py` 不再直接导入 `search_retrieval`、`build_packet`、`attach_compiled_context`，这些只由 `context_pipeline.py` 持有。
