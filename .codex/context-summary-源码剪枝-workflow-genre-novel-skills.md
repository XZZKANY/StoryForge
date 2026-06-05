## 项目上下文摘要（源码剪枝 Workflow 题材 NovelSkill 预留包）

生成时间：2026-06-05 15:16:13 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/skills/definitions.py`
  - 模式：默认小说技能注册表由 `DEFAULT_NOVEL_SKILLS` 和 `DEFAULT_NOVEL_SKILL_REGISTRY` 提供。
  - 可复用：保留 `generate`、`judge`、`repair`、`approve`、`memory_extract`、`export` 六个通用技能。
  - 需注意：`with_genre_pack()` 和 `GENRE_NOVEL_SKILL_PACKS` 仅显式加载题材扩展，默认链路不使用。
- **实现2**: `apps/workflow/tests/test_novel_skill_registry.py`
  - 模式：验证默认 registry 的顺序、阶段、能力、状态映射和默认 `SKILL.md` 元数据。
  - 可复用：保留默认技能合同，不需要题材包测试才能证明默认链路完整。
  - 需注意：默认技能 Markdown 仍与 registry 保持一致，本批不处理默认 `SKILL.md` 双事实源。
- **实现3**: `apps/workflow/tests/test_source_pruning.py`
  - 模式：用文件存在性和源码字符串断言防止已下线 Workflow 模块、包级转导出和静态引用回归。
  - 可复用：新增题材技能包下线护栏，禁止 `with_genre_pack`、`GENRE_NOVEL_SKILL_PACKS` 和 `genre_*` 静态目录回归。
  - 需注意：护栏应跳过自身文件，避免误判测试说明文本。
- **实现4**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：运行时通过 `NovelLoopPorts.judge_scene`、`repair_scene`、`approve_scene` 和可选 `NovelSkillRunner` 执行通用技能链。
  - 可复用：保持真实 judge/repair/approve 端口，不引入题材静态技能。
  - 需注意：题材技能声明的 workflow_nodes 也指向 `NovelLoopPorts.judge_scene`，职责上与通用 judge 重叠。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case 函数、PascalCase 类、全大写常量；测试函数以 `test_` 开头。
- **文件组织**: Workflow 运行代码位于 `apps/workflow/storyforge_workflow`，测试位于 `apps/workflow/tests`，剪枝护栏集中在 `tests/test_source_pruning.py`。
- **导入顺序**: 标准库导入优先，其后项目导入。
- **代码风格**: pytest 断言使用中文说明；注释和文档使用简体中文。

### 3. 可复用组件清单

- `storyforge_workflow.skills.definitions.DEFAULT_NOVEL_SKILL_REGISTRY`: 默认小说技能事实源。
- `storyforge_workflow.skills.runner.NovelSkillRunner`: 默认通用技能执行辅助。
- `apps/workflow/tests/test_novel_skill_registry.py`: 默认技能 registry 合同。
- `apps/workflow/tests/test_novel_loop_single_chapter.py`: 单章 NovelLoop 行为护栏。
- `apps/workflow/tests/test_novel_loop_skill_runner_integration.py`: skill runner 与 NovelLoop 集成护栏。
- `apps/workflow/tests/test_book_run_adapter.py`: BookRun adapter 技能链投影护栏。
- `apps/workflow/tests/test_source_pruning.py`: Workflow 剪枝回归护栏。

### 4. 测试策略

- **测试框架**: pytest，通过 `cd apps/workflow && uv run pytest ...` 执行。
- **测试模式**: 先在 `test_source_pruning.py` 中新增题材包下线护栏并观察红灯，再删除题材定义、目录和专属测试后运行绿灯。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_novel_skill_registry.py`、`tests/test_novel_loop_single_chapter.py`、`tests/test_novel_loop_skill_runner_integration.py`、`tests/test_book_run_adapter.py`。
- **覆盖要求**: 默认 registry 六个通用技能不变；运行时 judge/repair/approve 行为不依赖题材包；题材静态目录和入口常量/方法无残留。

### 5. 依赖和集成点

- **外部依赖**: 无新增外部依赖。
- **内部依赖**: `NovelSkillRunner.default()` 使用 `DEFAULT_NOVEL_SKILL_REGISTRY`；BookRun adapter 测试读取默认技能状态映射。
- **集成方式**: 移除显式题材包入口，不改变默认技能链和 NovelLoop/BookLoop 运行端口。
- **配置来源**: 无配置项。

### 6. 技术选型理由

- **为什么用这个方案**: 题材技能包没有默认运行入口，引用主要来自专属静态合同测试；它们共享 `NovelLoopPorts.judge_scene`，与通用 `judge` 职责重叠。
- **优势**: 减少未来预留代码和静态 Markdown 双写维护面，让 Workflow 技能事实源只覆盖当前真实链路。
- **劣势和风险**: 若后续需要题材技能，应基于真实运行入口重新引入，并补充运行时集成测试。

### 7. 关键风险点

- **并发问题**: 本批只处理静态 registry 和文件，不涉及运行时并发。
- **边界条件**: 不删除默认六个通用技能，不删除默认 `SKILL.md`，不修改 `NovelSkillRunner` 行为。
- **性能瓶颈**: 删除静态包减少扫描和维护面，无运行时性能风险。
- **安全考虑**: 不涉及认证、鉴权、限流或外部调用。
