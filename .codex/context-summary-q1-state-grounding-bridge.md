# 项目上下文摘要（Q1 P2 state-grounding bridge 接 `_judge_and_repair_loop`）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- `story_state.service.commit_story_state_changes()` 已提供 CHANGES grounding、事件追加、ledger 投影和确定性不变量。
- `book_generation_judge._judge_and_repair_loop()` 是串行/并发真实生成共同经过的 judge&repair 收口点。
- `JudgeIssue.payload` 已承载 `semantic_advisory`，可继续承载 `story_state_commit` 审计摘要。

## 2. 项目约定

- 本刀只接保守过渡桥：章节质量通过后，基于 `Chapter.pov` / `Chapter.location` / 通用设定词生成最小 CHANGES。
- 不解析自由文本 JSON，不新增 provider 调用，不改变 OpenAPI，不碰 `apps/web`。
- `story_state` 硬失败转成 `story_state_conflict` Judge issue，并把质量分压到批准阈值以下；不伪装 clean。

## 3. 可复用组件清单

- `commit_story_state_changes()`：唯一提交入口。
- `StoryStateGroundingError` / `StoryStateInvariantError`：硬失败语义。
- `_record_summary_judge()`：无问题章节的审计落点。
- `BookRun.progress["completed_chapters"]`：追加 `story_state_commit` 摘要，便于 audit/export 追踪。

## 4. 测试策略

- `test_book_generation_runs_one_chapter_and_records_evidence` 断言真实生成入口会写入 `StoryStateEvent` 与 `StoryStateLedger`，并在 summary judge/progress 中记录提交摘要。
- `test_book_generation_fast_path_runs_semantic_advisory_when_local_gate_passes` 继续锁定 semantic advisory，同时确认 story_state commit 没被 fast path 绕过。
- 回归 `test_book_generation.py` 与 `test_book_generation_parallel.py`，确认串行/并发共同入口稳定。

## 5. 风险与边界

- 这不是最终 Writer 工具调用协议；复杂状态、称谓归一、LLM 语义 grounding、edge 类 CHANGES → `continuity_edges` 仍待后续。
- 串行 runner 现在有 `story_state` 提交摘要，但尚未写 Story Memory atoms；并发 runner 已有 Story Memory 本地抽取桥。
