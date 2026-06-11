## 项目上下文摘要（Phase 9 PROJECT_SUMMARY 边界同步）

生成时间：2026-06-04 06:59:46 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：读取 Markdown 事实源并用普通 `assert` 锁定关键证据和禁止旧值。
  - 可复用：`Path.read_text(encoding="utf-8")`、中文测试 docstring、按事实源拆分测试。
  - 需注意：断言应覆盖“不能过度宣称”的负向边界。
- **实现2**: `README.md`
  - 模式：高层 README 记录当前远端 CI/E2E 状态和本地修复证据。
  - 可复用：远端 `CI / Core verification` run `26857864662`、远端 `E2E` run `26915457170`、Alembic `Multiple head revisions`、本地 `20260604_0001` 与 `tests/test_alembic_heads.py`。
  - 需注意：README 明确 CI 子集通过不等于远端 E2E 通过。
- **实现3**: `current-phase.md` 与 `.dev_plan.md`
  - 模式：阶段事实源记录真实 LLM smoke 证据、远端门禁状态和剩余发布前门禁。
  - 可复用：`.codex/real-llm-3ch-20260603-173932`、真实 10 章或 3-5 万字长程仍未完成、长程人工通读仍未完成。
  - 需注意：PROJECT_SUMMARY 只同步高层状态，不复制全部计划细节。

### 2. 项目约定

- **命名约定**: Python 测试常量使用大写 snake case，测试函数以 `test_` 开头。
- **文件组织**: 阶段事实源测试集中在 `apps/api/tests/test_phase9_fact_sources.py`。
- **导入顺序**: `from __future__ import annotations` 后空行，再导入标准库 `Path`。
- **代码风格**: 纯文本断言使用普通 `assert`，文档与测试说明使用简体中文。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 事实源漂移检测的既有测试文件。
- `README.md`: 当前远端 CI/E2E 与本地迁移图修复事实源。
- `current-phase.md`: 当前阶段真实 LLM smoke 和未完成长程边界事实源。
- `.dev_plan.md`: StoryForge 总计划与远端门禁状态事实源。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD 红绿；先新增 `PROJECT_SUMMARY.md` 事实源测试并观察红灯，再更新文档。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 正向断言最新事实，负向断言旧路径、旧计数和过度承诺不再出现。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖；pytest 官方文档确认普通 `assert` 会提供断言内省。
- **内部依赖**: `PROJECT_SUMMARY.md` 作为高层摘要依赖 README、current-phase 和 .dev_plan 中的当前事实。
- **集成方式**: 通过文本事实源测试纳入 `uv run pytest tests/test_phase9_fact_sources.py -q`。
- **配置来源**: 不读取 `.env`，不写入任何敏感 token。

### 6. 技术选型理由

- **为什么用这个方案**: 文档漂移属于事实源一致性问题，用已有 pytest 文本守卫最贴近项目当前模式。
- **优势**: 改动范围小、可审计、能防止后续再次误写远端 E2E 或真实长程状态。
- **劣势和风险**: 字符串断言依赖关键表述稳定；因此只锁定完成审计所需的事实与旧值。

### 7. 关键风险点

- **并发问题**: 无运行时并发影响。
- **边界条件**: 不能把本地 Alembic 修复写成远端 E2E 已完成。
- **性能瓶颈**: 只读取 Markdown 文件，无性能风险。
- **安全考虑**: 本轮只处理脱敏事实，不读取 `.env`，敏感扫描覆盖目标文件。
