# 项目上下文摘要（Novel Skill Runner）

生成时间：2026-05-31 19:24:04 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/skills/definitions.py`
  - 模式：`@dataclass(frozen=True)` + `MappingProxyType` 静态只读注册表。
  - 可复用：`DEFAULT_NOVEL_SKILL_REGISTRY`、`NovelSkillRegistry.require()`。
  - 需注意：现有 registry 没有 `default()` 方法，runner 应适配既有常量，不改第一阶段契约。
- **实现2**: `apps/workflow/storyforge_workflow/skills/audit.py`
  - 模式：只保存引用化 input/output/metadata，并递归冻结映射。
  - 可复用：引用化审计边界与不可变快照策略。
  - 需注意：runner 只记录运行事件，不替代 progress 投影。
- **实现3**: `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - 模式：`NovelLoopPorts` 通过 callable 注入 compile/generate/judge/repair/approve/memory_extract。
  - 可复用：`NovelLoopRequest` 作为 runner 包装方法输入类型。
  - 需注意：本阶段不改 `run_single_chapter_loop()` 终态。
- **实现4**: `apps/workflow/tests/test_novel_skill_registry.py`
  - 模式：pytest 直接断言、中文测试 docstring、先验证字段内容再验证禁止项。
  - 可复用：测试文件结构、命名和断言风格。

### 2. 项目约定

- **命名约定**: Python 文件和函数使用 snake_case；数据类使用 PascalCase。
- **文件组织**: workflow 领域代码位于 `apps/workflow/storyforge_workflow/`；测试位于 `apps/workflow/tests/`。
- **导入顺序**: `from __future__ import annotations` 在首行，随后标准库，再项目内导入。
- **代码风格**: frozen dataclass、明确类型标注、中文 docstring，避免运行时新依赖。

### 3. 可复用组件清单

- `DEFAULT_NOVEL_SKILL_REGISTRY`: 默认小说技能静态注册表。
- `NovelSkillRegistry.require(name)`: 按名称取技能定义，缺失时给中文错误。
- `NovelLoopRequest`: 端口包装方法复用的请求结构。
- `MappingProxyType`: 需要不可变映射时沿用的标准库能力。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD，先新增 `tests/test_novel_skill_runner.py` 并确认 RED。
- **参考文件**: `tests/test_novel_skill_registry.py`、`tests/test_skill_audit_summary.py`。
- **覆盖要求**: NovelSkillRun 不保存完整正文/prompt/Scene Packet；NovelSkillRunner 能通过 registry 查询定义。

### 5. 依赖和集成点

- **外部依赖**: 无新增。
- **内部依赖**: `storyforge_workflow.skills.definitions`、后续 `storyforge_workflow.orchestrators.novel_loop.NovelLoopRequest`。
- **集成方式**: runner 先独立测试，下一阶段再可选接入 NovelLoop。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 延续第一阶段静态技能注册表和只读审计派生，不引入第二套编排器。
- **优势**: 改动半径小，可单元测试，后续能包装 NovelLoopPorts。
- **劣势和风险**: 若 runner 记录过多字段会膨胀审计记录，因此测试明确禁止 `draft`、`prompt`、`scene_packet` 顶层字段。

### 7. 关键风险点

- **并发问题**: runner 持有内存 runs 列表，当前仅单次单章调用使用；后续并发接入需隔离实例。
- **边界条件**: budget、refs 默认空映射时不能共享可变默认值。
- **性能瓶颈**: 后续生成 `draft_hash` 会对草稿做一次 hash，当前 Task 1 尚不涉及大文本处理。
- **安全考虑**: 本阶段不执行外部脚本、不扫描用户目录、不引入动态插件。
