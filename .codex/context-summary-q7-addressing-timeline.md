# 项目上下文摘要（Q7 称谓一致性 + 17/18 章时间线回归）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- `judge.consistency._detect_character_bible_violations()` 已按 Character Bible 做角色一致性硬检测。
- `judge.consistency._detect_timeline_conflicts()` 已从 Story Memory 读取有效时间线/位置事实。
- `book_generation_judge._run_real_judge()` 会合并 deterministic、character bible、timeline、style fingerprint 本地问题。

## 2. 项目约定

- 不接 `apps/workflow` 的 `name_registry`；API 真实路径自包含实现窄口径称谓检查。
- 称谓检查只在同句同时出现 canonical_name 和未登记同姓称谓时触发，降低同姓新角色误报。
- 17/18 章基线复用 Story Memory location fact，不新增时间线表。

## 3. 可复用组件清单

- `CharacterBibleEntry.canonical_name` / `aliases`：称谓允许列表。
- `DetectedIssue`：输出 `character_addressing_conflict`。
- `MemoryAtomRecord`：第 17 章位置事实来源。

## 4. 测试策略

- `test_judge_flags_unregistered_character_addressing_drift`：`林岚` 同句被叫成未登记 `林医生` 时输出称谓一致性问题，并建议替换为 `林调查员`。
- `test_judge_detects_chapter_18_timeline_conflict_from_chapter_17_fact`：第 17 章写入“午夜在雾港”，第 18 章写“午夜在荒原城”，应输出 `timeline_conflict`。
- 回归 `test_judge_character_consistency.py`、`test_judge_timeline_consistency.py`、`test_timeline_consistency.py`、串并行 book generation。

## 5. 风险与边界

- 当前称谓检查是确定性窄规则，不覆盖所有复杂称谓/亲属关系漂移；更宽的跨章语义称谓维度仍可在 Q4/Q7 后续扩展。
- 17/18 回归证明现有 Story Memory 事实能约束跨章时间线，但不等同整书人工通读通过。
