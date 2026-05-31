# NovelLoop Skill Runner 接入操作日志

时间：2026-05-31 19:36:14 +08:00

## 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-novel-loop-skill-runner-integration.md`
□ 将使用以下可复用组件：

- `NovelSkillRunner`: `apps/workflow/storyforge_workflow/skills/runner.py`，复用已有端口包装方法。
- `NovelLoopPorts`: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`，保持端口注入模式。
- `NovelLoopResult`: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`，保持对外字段契约。
- `test_novel_loop_single_chapter.py`: 复用现有测试构造方式和无 runner 回归。

□ 将遵循命名约定：Python 模块和函数使用 snake_case，Protocol 类型使用 PascalCase。
□ 将遵循代码风格：`from __future__ import annotations`、中文 docstring、pytest 直接断言、无新增依赖。
□ 确认不重复造轮子，证明：runner 包装方法已在 `skills/runner.py` 实现，NovelLoop 仅调用它们，不重复记录逻辑。

## TDD 记录

- RED：新增 `apps/workflow/tests/test_novel_loop_skill_runner_integration.py`，运行 `uv run pytest tests/test_novel_loop_skill_runner_integration.py -v`，结果 `3 failed`，失败原因均为 `run_single_chapter_loop() got an unexpected keyword argument 'skill_runner'`。
- GREEN：修改 `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`，新增 `NovelSkillRunnerPort` Protocol 与 `skill_runner` 可选参数；有 runner 时通过 `run_generate`、`run_judge`、`run_repair`、`run_approve`、`run_memory_extract` 包装端口调用。

## 编码中监控

□ 是否使用了摘要中列出的可复用组件？
✅ 是：复用 `NovelSkillRunner` 方法、`NovelLoopPorts` 和 `NovelLoopResult`。

□ 命名是否符合项目约定？
✅ 是：新增 `NovelSkillRunnerPort` 和 `_run_repair`，均符合既有类型/函数命名。

□ 代码风格是否一致？
✅ 是：保持端口注入与函数式 pytest 风格；无新增第三方依赖。

## 编码后声明

### 1. 复用了以下既有组件

- `NovelSkillRunner.run_generate()`：包装 generate + record_model_run。
- `NovelSkillRunner.run_judge()`：包装 judge_scene。
- `NovelSkillRunner.run_repair()`：包装 repair_scene。
- `NovelSkillRunner.run_approve()`：包装 approve_scene。
- `NovelSkillRunner.run_memory_extract()`：包装 extract_memory。

### 2. 遵循了以下项目约定

- 命名约定：`NovelSkillRunnerPort` 描述结构化 runner 能力，`_run_repair` 是私有辅助函数。
- 代码风格：无 runner 路径保留原端口调用；有 runner 路径只替换调用点，不改变分支判断。
- 文件组织：实现只修改 `orchestrators/novel_loop.py`，测试新增 `tests/test_novel_loop_skill_runner_integration.py`。

### 3. 对比了以下相似实现

- `tests/test_novel_loop_single_chapter.py`：旧路径回归保持不变。
- `tests/test_novel_skill_runner.py`：集成测试验证 runner 记录链路顺序。
- `skills/runner.py`：NovelLoop 复用其包装方法，不复制 hash 或 run 构造逻辑。

### 4. 未重复造轮子的证明

- 已检查 `runner.py`、`novel_loop.py` 与现有 tests，确认 Task 3 只需要接线，不需要新增第二套 runner 或审计投影。

## 验证记录

- `uv run pytest tests/test_novel_loop_skill_runner_integration.py -v`：`3 passed in 0.31s`。
- `uv run pytest tests/test_novel_loop_skill_runner_integration.py tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_provider_degradation_pause.py tests/test_novel_skill_runner.py -v`：`22 passed in 0.35s`。
- `uv run ruff check storyforge_workflow/orchestrators/novel_loop.py storyforge_workflow/skills/runner.py tests/test_novel_loop_skill_runner_integration.py tests/test_novel_skill_runner.py`：`All checks passed!`。

## 风险与约束

- 未改变 NovelLoop/BookLoop 终态。
- 未保存完整 prompt、Scene Packet 或章节正文。
- 未运行时导入 `NovelSkillRunner`，避免 `runner.py` 与 `novel_loop.py` 循环导入。
- 当前工作区仍存在无关 Web/总账日志改动，本任务未触碰这些文件。
