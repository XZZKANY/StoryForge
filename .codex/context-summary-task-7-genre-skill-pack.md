## 项目上下文摘要（Task 7 题材技能包显式选择）

生成时间：2026-05-31 20:06:55 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/skills/definitions.py`
  - 模式：`NovelSkillDefinition` 描述静态技能契约，`NovelSkillRegistry` 提供查询，`DEFAULT_NOVEL_SKILL_REGISTRY` 只含通用六技能。
  - 可复用：`NovelSkillDefinition`、`NovelSkillReferences`、`NovelSkillRegistry` 的冻结与重复名称校验。
  - 需注意：题材技能不能加入 `DEFAULT_NOVEL_SKILLS`，否则会污染默认 BookRun。
- **实现2**: `apps/workflow/tests/test_novel_skill_registry.py`
  - 模式：pytest 覆盖默认顺序、查询、不可变、重复名称、stage 限制和 SKILL.md frontmatter。
  - 可复用：frontmatter 简单解析、字段正文覆盖断言、禁用动态执行断言。
  - 需注意：题材测试应单独创建，避免改变默认测试语义。
- **实现3**: `apps/workflow/storyforge_workflow/skills/*/SKILL.md`
  - 模式：每个技能目录包含 `SKILL.md`，frontmatter 标明 `skill_name`、`version`、`stage`、`dynamic_execution:false`，正文描述输入输出、门禁、审计字段和状态映射。
  - 可复用：同样使用引用化字段，不写完整 prompt 或完整正文。
  - 需注意：题材技能额外包含 `genre` 元数据，但仍不能声明新的 BookLoop 终态。
- **实现4**: `docs/superpowers/plans/2026-05-31-storyforge-novel-skill-framework-post-phase1.md`
  - 模式：Task 7 明确要求 `with_genre_pack("mystery")` 显式选择，未知 genre 抛错，新增三个题材 SKILL.md。
  - 可复用：测试名称、文件路径和验收命令。
  - 需注意：本阶段不改 API/Web 运行链路。

### 2. 项目约定

- **命名约定**: Python 函数使用 `snake_case`，类方法使用清晰英文名；技能名使用小写下划线。
- **文件组织**: 通用技能在 `skills/<name>/SKILL.md`；题材技能按计划放在 `skills/genre_<genre>/<skill>/SKILL.md`。
- **导入顺序**: `from __future__ import annotations`，标准库后项目导入。
- **代码风格**: Python 3.11，ruff line-length 120，中文 docstring 和中文错误信息。

### 3. 可复用组件清单

- `NovelSkillDefinition`: 静态技能契约。
- `NovelSkillRegistry`: 技能集合查询和重复名称保护。
- `_refs`: 构造 `NovelSkillReferences` 的本地工厂。
- `test_novel_skill_registry.py` 中 frontmatter 解析模式。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 新增 `tests/test_genre_skill_registry.py`，只覆盖题材包选择和文件契约。
- **参考文件**: `tests/test_novel_skill_registry.py`。
- **覆盖要求**: 默认 registry 不含题材技能；显式选择 mystery/xuanhuan/romance 只加载对应技能；未知 genre 抛中文错误；题材技能状态不新增 BookLoop 终态；三个 SKILL.md 存在且契约字段在正文中。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: `DEFAULT_NOVEL_SKILLS`、`DEFAULT_NOVEL_SKILL_REGISTRY`、新增 `GENRE_NOVEL_SKILL_PACKS`。
- **集成方式**: `NovelSkillRegistry.with_genre_pack(genre)` 返回默认技能 + 指定题材技能的新 registry。
- **配置来源**: `apps/workflow/pyproject.toml` 定义 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 权威计划要求 registry 显式选择，且现有 registry 是技能事实源。
- **优势**: 默认运行不变；后续 API/Web 可通过 genre 参数接入；题材技能契约可被审计和测试。
- **劣势和风险**: 当前只提供 registry 扩展点，还未接入 BookRun 创建 UI；这是 Task 7 的计划范围。

### 7. 关键风险点

- **并发问题**: 静态 tuple 和 MappingProxyType，无共享可变状态。
- **边界条件**: 未知 genre、大小写和空白输入、重复技能名称。
- **性能瓶颈**: 构造 registry 合并少量 tuple，成本可忽略。
- **状态污染**: 必须验证默认 registry 不含题材技能，且题材状态不含 BookLoop 终态。

### 8. 外部资料与工具记录

- Context7 查询 Pydantic 是前序 API metadata 方向的备选，最终按权威计划回到 workflow registry 层，未使用外部代码。
- GitHub `search_code` 未找到可直接复用的 Python 题材技能包 registry；TypeScript 结果仅作为命名参考，未引入外部实现。
- 本环境没有 desktop-commander 可调用工具，已使用 PowerShell 与 `rg` 替代并记录。
