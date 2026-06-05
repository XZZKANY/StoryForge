## 项目上下文摘要（源码剪枝 workflow-skills-package-export）

生成时间：2026-06-05 11:11:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/skills/definitions.py`
  - 模式：默认小说技能注册表事实源，定义 `NovelSkillDefinition`、`NovelSkillRegistry`、`DEFAULT_NOVEL_SKILL_REGISTRY` 和查询函数。
  - 可复用：必须保留具体模块和全部静态技能契约。
  - 需注意：测试和运行链路直接从该模块导入。
- **实现2**: `apps/workflow/storyforge_workflow/skills/audit.py`
  - 模式：BookRun 技能链只读投影事实源，定义审计事件和 `derive_skill_chain_projection`。
  - 可复用：必须保留投影逻辑。
  - 需注意：测试当前直接从该模块导入。
- **实现3**: `apps/workflow/storyforge_workflow/skills/diagnostics.py`
  - 模式：静态技能诊断事实源，读取默认注册表并输出诊断行与固定链路说明。
  - 可复用：必须保留诊断函数。
  - 需注意：诊断测试直接从该模块导入。
- **实现4**: `apps/workflow/storyforge_workflow/skills/__init__.py`
  - 模式：仅重新导出 `audit.py`、`definitions.py`、`diagnostics.py` 中的符号。
  - 可复用：当前仓库无包级调用方；属于重复公共出口。
  - 需注意：保留包目录语义即可，不应继续转导出具体技能符号。
- **实现5**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：通过 pathlib 读取文件文本，防止已下线或重复出口回归。
  - 可复用：新增 skills 包级转导出护栏。
  - 需注意：说明使用简体中文。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: Workflow 技能事实源位于 `storyforge_workflow/skills/` 的具体模块；包级初始化文件不承担重复公共出口。
- **导入顺序**: 标准库导入在前，项目内导入在后；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/workflow/storyforge_workflow/skills/definitions.py`: 小说技能注册表事实源。
- `apps/workflow/storyforge_workflow/skills/audit.py`: BookRun 技能链投影事实源。
- `apps/workflow/storyforge_workflow/skills/diagnostics.py`: 技能诊断事实源。
- `apps/workflow/storyforge_workflow/skills/runner.py`: 技能运行记录事实源。
- `apps/workflow/tests/test_novel_skill_registry.py`: registry 定向测试。
- `apps/workflow/tests/test_novel_skill_diagnostics.py`: diagnostics 定向测试。
- `apps/workflow/tests/test_skill_audit_summary.py`: audit 定向测试。
- `apps/workflow/tests/test_novel_skill_runner.py`: runner 定向测试。
- `apps/workflow/tests/test_source_pruning.py`: 本批剪枝护栏。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_novel_skill_registry.py`、`tests/test_novel_skill_diagnostics.py`、`tests/test_skill_audit_summary.py`、`tests/test_novel_skill_runner.py`、`tests/test_genre_skill_registry.py`、`tests/test_book_run_adapter.py`。
- **覆盖要求**: `skills/__init__.py` 不再转导出 Novel skill 符号；具体技能注册表、诊断、审计和 runner 行为不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff。
- **内部依赖**: 实现和测试直接导入 `skills.definitions`、`skills.audit`、`skills.diagnostics`、`skills.runner`。
- **集成方式**: 移除重复包级出口，不修改具体模块。
- **配置来源**: `apps/workflow/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from storyforge_workflow.skills import ...` 调用，包级转导出只增加重复入口。
- **优势**: 具体模块成为唯一入口，降低维护面。
- **劣势和风险**: 外部未记录包级导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除或修改 `definitions.py`、`audit.py`、`diagnostics.py`、`runner.py` 或具体技能目录。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改 API、Provider、认证或外部请求逻辑。
