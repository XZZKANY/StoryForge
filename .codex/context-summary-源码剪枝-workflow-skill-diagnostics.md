## 项目上下文摘要（源码剪枝 Workflow skills diagnostics 静态投影）

生成时间：2026-06-05 15:46:22 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：用文件存在性、包级转导出和源码引用扫描记录已下线模块的防回潮合同。
  - 可复用：`WORKFLOW_ROOT` 和 `Path.rglob()` 扫描模式。
  - 需注意：护栏文件自身会包含禁用符号，扫描时必须跳过当前文件。
- **实现2**: `apps/workflow/tests/test_novel_skill_registry.py`
  - 模式：默认 NovelSkill registry 的真实合同由默认六技能测试覆盖。
  - 可复用：默认技能事实源继续来自 `DEFAULT_NOVEL_SKILL_REGISTRY`。
  - 需注意：本批不修改默认技能定义和 registry 顺序。
- **实现3**: `apps/workflow/tests/test_skill_audit_summary.py`
  - 模式：运行诊断和审计摘要由 `skills.audit` 覆盖，而不是依赖静态 diagnostics 投影。
  - 可复用：`derive_skill_chain_projection` 仍是 BookRun 技能链审计事实源。
  - 需注意：本批不删除 `skills.audit`。

### 2. 项目约定

- **命名约定**: Python 模块、函数和 pytest 用例使用 snake_case。
- **文件组织**: Workflow 技能定义集中在 `storyforge_workflow/skills/definitions.py`，运行审计集中在 `storyforge_workflow/skills/audit.py`。
- **导入顺序**: 标准库在前，项目模块在后；本批测试只需要 `pathlib.Path`。
- **代码风格**: pytest plain `assert`，测试说明和断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/tests/test_source_pruning.py`: 已下线 Workflow 模块的剪枝护栏集合。
- `apps/workflow/storyforge_workflow/skills/definitions.py`: 默认 NovelSkill registry 事实源。
- `apps/workflow/storyforge_workflow/skills/audit.py`: 技能链投影与运行审计事实源。
- `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`: BookRun 技能链运行集成点。

### 4. 测试策略

- **测试框架**: pytest，经 `uv run pytest` 或根目录 `pnpm run test:workflow` 调用。
- **测试模式**: 先扩展 `test_source_pruning.py` 形成红灯，再删除静态模块和专属测试形成绿灯。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_novel_skill_registry.py`、`tests/test_skill_audit_summary.py`。
- **覆盖要求**: 文件下线、导入禁用、旧符号禁用、默认 registry 和审计链路不退化。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: 真实默认技能链依赖 `DEFAULT_NOVEL_SKILL_REGISTRY`；审计依赖 `skills.audit`；BookRun adapter 读取技能链投影。
- **集成方式**: 删除未被运行链路调用的静态诊断投影，不新增替代入口。
- **配置来源**: 无配置变更。

### 6. 技术选型理由

- **为什么用这个方案**: `diagnostics.py` 只把默认 registry 静态展开为字典，职责已被 registry 测试、`skills.audit` 和 BookRun adapter 覆盖。
- **优势**: 减少 Workflow 技能层重复诊断入口，避免旧静态说明与真实运行审计分叉。
- **劣势和风险**: 若未来需要技能诊断 API，应从 `skills.audit` 或运行事件重建，而不是恢复静态投影。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 禁用符号会出现在剪枝护栏自身，源码扫描必须排除当前测试文件。
- **性能瓶颈**: `Path.rglob()` 仅在测试中运行，影响可接受。
- **安全考虑**: 本批不修改认证、鉴权、限流、请求超时或审计留痕。
