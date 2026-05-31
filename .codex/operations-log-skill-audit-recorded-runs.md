# Skill Audit Recorded Runs 操作日志

时间：2026-05-31 19:43:35 +08:00

## 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-skill-audit-recorded-runs.md`
□ 将使用以下可复用组件：

- `NovelSkillRunEvent`: `apps/workflow/storyforge_workflow/skills/audit.py`，作为投影事件结构。
- `_freeze_mapping`: `apps/workflow/storyforge_workflow/skills/audit.py`，保持输出不可变。
- `NovelSkillRun.to_audit_dict()`: `apps/workflow/storyforge_workflow/skills/runner.py`，作为真实记录格式参考。
- `_assert_common_event_fields()`: `apps/workflow/tests/test_skill_audit_summary.py`，保持事件公共字段不变。

□ 将遵循命名约定：私有 helper 使用 `_recorded_skill_run_events`、`_recorded_skill_run_event`、`_metadata_from_run`。
□ 将遵循代码风格：pytest 直接断言、Mapping 白名单复制、无新增运行时依赖。
□ 确认不重复造轮子，证明：保留旧 `_approved_chapter_events` / `_blocked_chapter_events` 作为 fallback，只新增真实 run 转换入口。

## TDD 记录

- RED：新增 completed/blocked `skill_runs` 优先测试，运行 `uv run pytest tests/test_skill_audit_summary.py::test_completed_chapter_prefers_recorded_skill_runs tests/test_skill_audit_summary.py::test_blocked_chapter_prefers_recorded_skill_runs -v`，结果 `2 failed`，当前实现仍走旧派生。
- GREEN：在 `audit.py` 新增 `_recorded_skill_run_events()`、`_recorded_skill_run_event()`、`_metadata_from_run()`、`_refs_from_run()`；章节存在真实 `skill_runs` 时优先转换，否则保留旧派生。

## 编码中监控

□ 是否使用了摘要中列出的可复用组件？
✅ 是：继续使用 `NovelSkillRunEvent`、`_freeze_mapping` 和旧派生 helper。

□ 命名是否符合项目约定？
✅ 是：新增 helper 均为 snake_case 私有函数。

□ 代码风格是否一致？
✅ 是：未新增外部依赖，输出仍由 dataclass 冻结。

## 编码后声明

### 1. 复用了以下既有组件

- `NovelSkillRunEvent`: 用于真实记录转投影。
- `_approved_chapter_events` / `_blocked_chapter_events`: 无真实记录时保持旧行为。
- `_mapping_items`: 过滤 `skill_runs` 中非 mapping 项。

### 2. 遵循了以下项目约定

- 命名约定：私有 helper 使用 `_` 前缀。
- 代码风格：只复制 `input_refs`、`output_refs`、`budget`、`error_summary` 白名单字段。
- 文件组织：仅修改 `skills/audit.py` 和 `tests/test_skill_audit_summary.py`。

### 3. 对比了以下相似实现

- `tests/test_skill_audit_summary.py`: 保持不可变快照、内容泄露防护和公共字段断言。
- `skills/runner.py`: 按 `to_audit_dict()` 输出格式消费真实记录。
- `book_loop.py`: 不改变 progress 既有字段含义。

### 4. 未重复造轮子的证明

- 没有新增第二套 projection 类型；继续输出 `BookRunSkillProjection`。
- 没有新增 `derive_skill_chain_summary()`，避免公共 API 分裂。

## 验证记录

- `uv run pytest tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py tests/test_novel_loop_skill_runner_integration.py -v`：`21 passed in 0.43s`。
- 第二阶段验收：`uv run pytest tests/test_novel_skill_runner.py tests/test_novel_loop_skill_runner_integration.py tests/test_skill_audit_summary.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py -v`：`33 passed in 0.41s`。
- `uv run ruff check storyforge_workflow/skills/audit.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py tests/test_novel_loop_skill_runner_integration.py`：`All checks passed!`。

## 风险与约束

- 未改变 `derive_skill_chain_projection()` 公共函数名。
- 未改变无 `skill_runs` 的旧派生行为。
- 未输出完整 prompt、Scene Packet 或正文。
- 当前工作区仍存在无关 Web/总账日志改动，本任务未触碰这些文件。
