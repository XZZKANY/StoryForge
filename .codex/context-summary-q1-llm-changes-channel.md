# 项目上下文摘要（Q1 P5 LLM CHANGES JSON 通道）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- `run_book_generation()` / `run_book_generation_parallel()` 都通过 `_generate_chapter()` 拿正文，再持久化 Scene 与 ScenePacket。
- `_judge_and_repair_loop()` 已接保守 state-grounding bridge，可从 ScenePacket 读取结构化 CHANGES 后提交 `story_state`。
- 现阶段没有真正 tool-call runtime；最小兼容路径是让模型在正文后附可剥离 JSON 区块。

## 2. 项目约定

- 可选区块名固定为 `【STORY_STATE_CHANGES】...【/STORY_STATE_CHANGES】`，内容必须是 JSON 数组。
- 后端解析成功后从正文剥离区块，避免结构化数据污染 `book.md`。
- 解析失败时保留原文并返回空 changes，fallback 到保守本地桥；不因 JSON 解析失败毁掉正文。

## 3. 可复用组件清单

- `book_generation_changes.py`：新增 prompt instruction 与 content parser。
- `_record_scene_packet()`：把解析出的 `story_state_changes` 放入 `ScenePacket.packet`。
- `_commit_story_state_for_scene()`：优先消费 ScenePacket 中的 changes，缺失时使用保守桥。

## 4. 测试策略

- `test_story_state_changes_block_is_stripped_from_generated_content`：直接验证区块剥离与 JSON 提取。
- `_BookGenerationChatHandler` 模拟真实模型返回 CHANGES block；`test_book_generation_runs_one_chapter_and_records_evidence` 断言 Scene 正文无 block、StoryStateEvent 来自模型声明的 `character.status`。
- 回归串行/并发 book generation 与 story_state/judge 组合。

## 5. 风险与边界

- 这不是最终 tool-call 协议；没有函数调用 schema retry、花名册 ID 选择器或 LLM semantic grounding。
- JSON block 解析失败会 fallback，不阻断章节；后续若要硬要求 Writer CHANGES，需要单独接工具调用与重试。
