## 项目上下文摘要（源码剪枝-workflow-prompts-models-package-export）

生成时间：2026-06-05 18:50:02 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/runtime/__init__.py`
  - 模式：包级入口只保留真实运行时公共 API，不转导出验收 harness。
  - 可复用：收缩包级入口的 source-pruning 护栏模式。
  - 需注意：只删除重复入口，不删除具体模块本体。
- **实现2**: `apps/workflow/storyforge_workflow/quality/__init__.py`
  - 模式：quality 包级入口不转导出静态质量检查，调用方统一从具体模块读取。
  - 可复用：包级入口不伪装成领域模型聚合层。
  - 需注意：保留真实具体模块和专项测试。
- **实现3**: `apps/workflow/storyforge_workflow/prompts/builder.py`
  - 模式：builder 从 `storyforge_workflow.prompts.models` 直接导入 `CharacterConstraint`、`NarrativeContext`、`PacingDirective`、`StyleDirective`。
  - 可复用：模型消费者应读取具体 `prompts.models` 模块。
  - 需注意：包级 `build_*` 构建器转导出是生产节点真实入口，必须保留。
- **实现4**: `apps/workflow/storyforge_workflow/prompts/context.py`
  - 模式：context 从 `storyforge_workflow.prompts.models` 直接导入所有 prompt 输入模型。
  - 可复用：模型类不需要通过包级入口绕一层。
  - 需注意：`SceneQualityPlan` 是活模型，但不必由包级入口转导出。

### 2. 项目约定

- **命名约定**: Python dataclass 使用 PascalCase；测试函数使用 `test_` 前缀。
- **文件组织**: prompt 构建器位于 `prompts/builder.py`，输入模型位于 `prompts/models.py`，适配层位于 `prompts/context.py`。
- **导入顺序**: 测试中先导入构建器，再从具体模型模块导入 dataclass。
- **代码风格**: source-pruning 护栏继续读取源码字符串，断言信息使用简体中文。

### 3. 可复用组件清单

- `apps/workflow/tests/test_source_pruning.py`: 复用包级入口剪枝护栏。
- `apps/workflow/tests/test_prompt_builder.py`: 继续作为 prompt builder 行为测试，但模型导入应改为 `prompts.models`。
- `apps/workflow/storyforge_workflow/prompts/models.py`: 保留全部活跃 prompt 输入模型。
- `apps/workflow/storyforge_workflow/prompts/__init__.py`: 保留 `build_*` 构建器公共入口。

### 4. 测试策略

- **测试框架**: Pytest。
- **测试模式**: 先新增 source-pruning 红灯护栏，断言 `prompts/__init__.py` 不应导入/转导出模型 dataclass，同时保留 `build_*` 构建器转导出。
- **参考文件**: `apps/workflow/tests/test_source_pruning.py`、`apps/workflow/tests/test_prompt_builder.py`。
- **覆盖要求**: 红灯命中包级入口仍转导出 `CharacterConstraint` 等模型；绿灯后覆盖 source-pruning、prompt builder、generation graph、runtime runner、Workflow 全量、残留搜索、保留搜索和 diff check。

### 5. 依赖和集成点

- **外部依赖**: Python dataclasses，无新增外部依赖。
- **内部依赖**:
  - 生产节点 `director.py`、`scene_architect.py`、`draft_writer.py` 从 `storyforge_workflow.prompts` 导入 `build_*` 构建器。
  - `builder.py` 与 `context.py` 从 `storyforge_workflow.prompts.models` 导入模型。
  - `test_prompt_builder.py` 当前唯一从包级入口导入模型，需迁移到具体模块。
- **集成方式**: 包级入口继续为节点提供构建器；模型类入口收缩到 `prompts.models`。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 包级入口当前同时暴露构建器和模型，职责过宽；真实生产代码只需要构建器公共入口，模型已有具体模块事实源。
- **优势**: 降低公共 API 暴露面，与 runtime/quality/tools 等包级入口收缩模式一致。
- **劣势和风险**: 仓库外如果从 `storyforge_workflow.prompts` 导入模型类会受破坏式剪枝影响；仓库内生产代码无此消费者。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不得删除 `prompts.models` 中活模型；不得删除包级 `build_*` 构建器转导出。
- **性能瓶颈**: 减少包级 import 工作量，无新增运行时成本。
- **安全考虑**: 不涉及认证、鉴权、限流或审计安全基线。

### 8. 充分性检查

- **接口契约**: `storyforge_workflow.prompts` 作为 builder 公共入口；`storyforge_workflow.prompts.models` 作为模型公共入口。
- **技术选型理由**: 已由 builder/context 现有直接导入模式证明。
- **主要风险点**: 测试迁移不全或误删 builder 转导出。
- **验证方式**: TDD 红灯、定向 Workflow 测试、Workflow 全量、残留搜索、保留搜索、`git diff --check`。
