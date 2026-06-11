# 项目上下文摘要（Novel Skill Framework 后续总阶段计划）

生成时间：2026-05-31 04:55:00 +08:00

## 1. 相似实现分析

- `docs/superpowers/specs/2026-05-31-storyforge-novel-skill-framework-design.md`：后续阶段事实源，定义阶段二 Skill Runner、阶段三题材技能包与状态契约。
- `docs/superpowers/plans/2026-05-30-novel-quality-total-implementation.md`：复用任务分批、文件职责、TDD 红绿路径和完成定义写法。
- `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`：后续 runner 必须包装的 NovelLoopPorts 与 NovelLoopResult 契约。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`：整书状态、budget、checkpoint 与 provider 降级事实源。

## 2. 项目约定

- 文档、日志、验证报告使用简体中文。
- Python 实现使用 frozen dataclass、snake_case、端口注入和 pytest。
- 后续计划写入 `docs/superpowers/plans/`，验证与操作记录写入项目本地 `.codex/`。

## 3. 依赖与集成点

- 阶段二依赖第一阶段 `NovelSkillDefinition`、`NovelSkillRegistry`、`derive_skill_chain_summary`。
- workflow 是技能运行记录源，API 是 audit_report 真相源，Web 只做展示。
- 题材技能包必须显式选择，不影响默认技能链。

## 4. 验证策略

- 文档阶段验证：计划文件存在、关键任务章节存在、无控制字符、无 Markdown 空白错误。
- 实施阶段验证：workflow pytest、API pytest、Web 测试、`pnpm test`、`pnpm verify`。

## 5. 工具限制

- 当前会话没有 desktop-commander 工具入口，已使用 PowerShell 与 Python 完成本地文件分析与写入。
- 已按要求使用 sequential-thinking 与 shrimp-task-manager 进行任务分析和拆分。
