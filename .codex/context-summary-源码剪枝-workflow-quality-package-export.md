## 项目上下文摘要（源码剪枝 Workflow quality 包级转导出）

生成时间：2026-06-05 16:15:03 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：通过包入口源码断言禁止重复转导出，调用方统一从具体模块导入。
  - 可复用：`WORKFLOW_ROOT`、读取 `__init__.py` 源码、禁用符号列表。
  - 需注意：护栏自身会包含禁用符号，残留搜索时需允许 source-pruning 文本。
- **实现2**: `apps/workflow/storyforge_workflow/tools/__init__.py`
  - 模式：包入口只保留中文说明，不转导出 registry 符号。
  - 可复用：说明性 docstring 入口风格。
  - 需注意：不删除包目录，避免影响包识别。
- **实现3**: `apps/workflow/storyforge_workflow/skills/__init__.py`
  - 模式：包入口提示从具体模块导入，不重复暴露事实源。
  - 可复用：明确模块边界，降低隐式导入面。
  - 需注意：真实技能定义和审计模块保留。

### 2. 项目约定

- **命名约定**: Python 模块和函数使用 snake_case，测试函数使用 `test_` 前缀。
- **文件组织**: 静态质量检查事实源位于 `storyforge_workflow/quality/prose_static_check.py`。
- **导入顺序**: 标准库导入在前，项目具体模块导入在后。
- **代码风格**: pytest plain `assert`，测试说明和断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/quality/prose_static_check.py`: `StaticProseIssue` 和 `check_prose_static_quality` 真实实现。
- `apps/workflow/tests/test_prose_static_check.py`: 静态质量检查行为测试。
- `apps/workflow/tests/test_source_pruning.py`: 已下线或收敛入口的防回潮护栏。
- `apps/workflow/tests/test_novel_loop_single_chapter.py`: NovelLoop 静态质量检查注入链路验证。
- `apps/workflow/tests/test_novel_loop_skill_runner_integration.py`: SkillRunner 与静态 gate 集成验证。

### 4. 测试策略

- **测试框架**: pytest，经 `uv run pytest` 或根目录 `pnpm run test:workflow` 调用。
- **测试模式**: 先把测试导入改为具体模块并新增 source-pruning 红灯，再收敛包入口形成绿灯。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_prose_static_check.py`。
- **覆盖要求**: 包入口不转导出、具体模块导入可用、静态质量检查行为不变、NovelLoop 与 SkillRunner 链路不退化。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: `prose_static_check.py` 继续作为事实源；运行链路通过 `NovelLoopPorts.check_static_quality` 注入。
- **集成方式**: 调用方显式从 `storyforge_workflow.quality.prose_static_check` 导入。
- **配置来源**: 无配置变更。

### 6. 技术选型理由

- **为什么用这个方案**: 当前 `quality/__init__.py` 只做便利转导出，增加隐式导入面；前序批次已统一收敛多个包级转导出。
- **优势**: 减少重复职责入口，让质量检查事实源唯一。
- **劣势和风险**: 若外部把根包入口当公共 API，会需要迁移导入；当前仓库内唯一外部使用是测试，风险可控。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除 `prose_static_check.py`，不改 fixtures 和检查逻辑。
- **性能瓶颈**: 无运行时性能影响。
- **安全考虑**: 本批不修改认证、鉴权、限流、请求超时或审计留痕。
