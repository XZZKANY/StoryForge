## 项目上下文摘要（源码剪枝 workflow-longform）

生成时间：2026-06-05 09:44:37

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/longform.py`
  - 模式：独立实验 CLI 模块，内部自带 plan、生成循环、重试、Markdown 落盘和 argparse 入口。
  - 可复用：`build_longform_segment_prompt` 与 `NarrativeContext` 来自 prompt builder，仍属于可复用提示词层。
  - 需注意：该模块未接入 `WorkflowRuntime`、graph、BookRun adapter 或 `pyproject.toml` entry point。
- **实现2**: `apps/workflow/tests/test_longform_generation.py`
  - 模式：只覆盖 `longform.py` 的实验 CLI 与生成循环。
  - 可复用：其中 prompt gateway 断言已由 `apps/workflow/tests/test_prompt_builder.py` 对 `build_longform_segment_prompt` 覆盖。
  - 需注意：测试本身是目标模块的唯一主要代码引用，不能作为保留生产入口的证据。
- **实现3**: `apps/workflow/tests/test_prompt_builder.py`
  - 模式：集中验证 prompt builder 的上下文注入、创作准则、长文段落提示词契约。
  - 可复用：继续保留 `build_longform_segment_prompt` 的测试覆盖。
  - 需注意：本轮不删除 prompt builder，不削弱运行时可复用提示词能力。

### 2. 项目约定

- **命名约定**: Python 测试文件使用 `test_*.py`，测试函数使用 `test_` 前缀；用户可见说明和注释使用简体中文。
- **文件组织**: workflow 包位于 `apps/workflow/storyforge_workflow`，测试位于 `apps/workflow/tests`，Docker 运行说明在 `apps/workflow/Dockerfile`。
- **导入顺序**: Python 文件使用 `from __future__ import annotations`，标准库、第三方、项目内导入分组；本轮新增测试只需标准库。
- **代码风格**: Ruff 配置为 Python 3.11、行宽 120、启用 E/F/W/I/UP/B/SIM；测试使用 pytest。

### 3. 可复用组件清单

- `apps/workflow/tests/test_prompt_builder.py`: 保留长文段落提示词契约验证。
- `apps/workflow/storyforge_workflow/prompts/builder.py`: 保留 `build_longform_segment_prompt`，继续作为提示词层能力。
- `apps/workflow/pyproject.toml`: 确认未声明 `storyforge_workflow.longform` entry point。
- `apps/workflow/Dockerfile`: 清理独立 CLI 示例，避免文档入口回流。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 新增 source-pruning 护栏测试，验证已下线模块和 Dockerfile 示例不回归。
- **参考文件**: `apps/workflow/tests/test_prompt_builder.py` 与 Web 侧 `apps/web/tests/source-pruning.test.ts` 的剪枝护栏模式。
- **覆盖要求**: 红灯确认目标仍存在时测试失败；绿灯确认删除模块、删除专属测试、清理 Dockerfile 示例后通过；回归测试覆盖 prompt builder 与 workflow 全量测试。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff。
- **内部依赖**: `longform.py` 仅依赖 prompt builder 与 provider client；未被 runtime、graph、adapter 或包入口导入。
- **集成方式**: 当前真实 workflow 集成由运行时与 graph 相关模块承担，非 `python -m storyforge_workflow.longform`。
- **配置来源**: `apps/workflow/pyproject.toml` 管理测试路径、pythonpath 与 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 对高置信死代码采取小步删除，并用 source-pruning 测试防止已下线独立 CLI 通过示例或测试重新成为隐式入口。
- **优势**: 删除维护面，保留可复用 prompt builder，避免影响真实 workflow 主链路。
- **劣势和风险**: 删除 CLI 会移除一个手动实验入口；若后续需要长文生成，应接入正式 workflow runtime，而不是恢复独立 CLI。

### 7. 关键风险点

- **并发问题**: 本轮不改运行时并发或任务调度。
- **边界条件**: 需确认 `build_longform_segment_prompt` 保留并通过测试。
- **性能瓶颈**: 删除独立生成循环，不引入新的 I/O 或模型调用路径。
- **安全考虑**: 不修改 provider 凭据、运行时环境变量、网络调用或容器权限。

### 8. 充分性检查

- 能定义清晰接口契约：是。本轮交付为删除独立 CLI、移除专属测试、清理 Dockerfile 示例，并新增禁止回归的测试。
- 理解技术选型理由：是。候选未接入正式 workflow 主链路，仅由自身测试和示例注释引用。
- 识别主要风险点：是。核心风险是误删 prompt builder，已明确保留。
- 知道如何验证实现：是。运行 source-pruning、prompt builder、workflow 全量 pytest、ruff、引用搜索和 `git diff --check`。
