# 项目上下文摘要（Q1 P3 edge 类 CHANGES → continuity_edges）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- `continuity.edge_constraints.check_edge_constraints()` 已提供 relationship / timeline_order / status 三类结构边冲突检测。
- `continuity.service.approve_chapter()` 采用“校验通过才写边，冲突整笔回滚”的事务语义。
- `story_state.service.commit_story_state_changes()` 是 CHANGES 的统一提交入口，适合作为 edge/node 分流点。

## 2. 项目约定

- edge / node 不重叠：`relationship` / `timeline_order` / `timeline` / `status` 进入 `continuity_edges`，不写 `state_ledger`。
- edge 类 CHANGES 仍会进入 `story_state_events`，作为逐章审计真相源。
- reproject 时先删除当前 scope 下 story_state 产生的 continuity edges，再按剩余事件重放，避免重复边和未来边残留。

## 3. 可复用组件清单

- `ContinuityEdgeCandidate`：从 CHANGES 映射出候选边。
- `check_edge_constraints()`：沿用既有成环/时间窗冲突检测。
- `ContinuityEdge`：结构边持久化目标。
- `StoryStateInvariantError`：edge 冲突统一转为 story_state 硬失败。

## 4. 测试策略

- `test_story_state_edge_change_writes_continuity_edge`：relationship CHANGES 分流到 `continuity_edges`，且不写 ledger。
- `test_story_state_edge_conflict_rolls_back_whole_commit`：关系成环时整笔拒绝，event/edge 不产生半写。
- `test_reproject_story_state_rebuilds_story_state_edges`：reproject 删除目标章之后的 story_state edge 并按剩余事件重建。
- 回归 `test_continuity_edges.py` 与 book generation 相关测试。

## 5. 风险与边界

- 真实 Writer/LLM 工具化 CHANGES 仍未落地；当前 book generation 的保守桥主要产 node/known facts，不主动生成复杂 relationship/timeline edge。
- continuity edge 表本身没有 `book_run_id` 列，story_state 来源与 `book_run_id` 存在 `payload` 中；未来如需高频查询，可再考虑迁移加列。
