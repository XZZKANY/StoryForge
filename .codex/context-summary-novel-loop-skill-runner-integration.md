# 项目上下文摘要（NovelLoop Skill Runner 接入）

生成时间：2026-05-31 19:36:14 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：`run_single_chapter_loop()` 负责 compile、generate、judge、repair、approve、memory_extract 分支和终态。
  - 可复用：`NovelLoopPorts` 端口注入、`NovelLoopResult` 字段契约。
  - 需注意：单章终态只能保持 `approved` / `awaiting_review`。
- **实现2**: `apps/workflow/storyforge_workflow/skills/runner.py`
  - 模式：runner 已提供 `run_generate`、`run_judge`、`run_repair`、`run_approve`、`run_memory_extract` 包装方法。
  - 可复用：所有端口包装逻辑，不在 NovelLoop 中重复记录实现。
  - 需注意：`runner.py` 已导入 `NovelLoopRequest`，`novel_loop.py` 不能运行时反向导入 runner 类。
- **实现3**: `apps/workflow/tests/test_novel_loop_single_chapter.py`
  - 模式：用 injected ports 验证 approved、repair、awaiting_review、静态质量门。
  - 可复用：测试构造方式和断言粒度。
  - 需注意：新增 runner 测试必须保持无 runner 测试不改语义。
- **实现4**: `apps/workflow/tests/test_novel_skill_runner.py`
  - 模式：验证 runner 记录引用化技能 run。
  - 可复用：runner 实例和技能链顺序断言。

### 2. 项目约定

- **命名约定**: Python 函数和文件使用 snake_case；类型使用 PascalCase。
- **文件组织**: orchestrator 行为在 `storyforge_workflow/orchestrators`，技能记录在 `storyforge_workflow/skills`，集成测试在 `apps/workflow/tests`。
- **导入顺序**: `from __future__ import annotations`、标准库、项目导入。
- **代码风格**: frozen dataclass、Protocol 描述结构化依赖、pytest 直接断言、中文 docstring。

### 3. 可复用组件清单

- `NovelLoopPorts`: 原有端口注入结构。
- `NovelLoopResult`: 原有对外结果契约。
- `NovelSkillRunner`: 已实现的技能运行记录器。
- `NovelSkillRun.to_audit_dict()`: 后续审计消费入口。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD，先新增集成测试并确认 `skill_runner` 参数缺失 RED。
- **参考文件**: `tests/test_novel_loop_single_chapter.py`、`tests/test_novel_skill_runner.py`。
- **覆盖要求**: approved 路径、repair 路径、静态高危质量门、无 runner 旧路径回归。

### 5. 依赖和集成点

- **外部依赖**: 无新增。
- **内部依赖**: `novel_loop.py` 通过 `NovelSkillRunnerPort` Protocol 描述 runner 能力，避免循环导入。
- **集成方式**: `skill_runner` 是 keyword-only 可选参数，默认 `None`。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: Protocol 能表达 NovelLoop 所需方法集合，同时不运行时依赖 `skills.runner`。
- **优势**: 无 runner 路径零行为变化；有 runner 路径只替换端口调用点，状态判断仍由 NovelLoop 原逻辑负责。
- **劣势和风险**: runner 记录的 judge/repair 事件目前没有 book_id/chapter_index；后续若审计需要更强关联，可在 Task 4 消费真实记录时补齐结构。

### 7. 关键风险点

- **并发问题**: runner 实例由调用方传入，后续 BookRun 并发时需每次运行隔离实例。
- **边界条件**: 静态质量高危门不调用 judge/approve，只保留 generate 记录。
- **性能瓶颈**: 有 runner 时会计算草稿 hash；无 runner 时不新增开销。
- **安全考虑**: 不执行外部脚本，不引入动态插件或目录扫描。
