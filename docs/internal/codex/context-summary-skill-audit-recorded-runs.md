# 项目上下文摘要（Skill Audit Recorded Runs）

生成时间：2026-05-31 19:43:35 +08:00

### 1. 相似实现分析

- **实现1**: `apps/workflow/storyforge_workflow/skills/audit.py`
  - 模式：`BookRunSkillProjection` 与 `NovelSkillRunEvent` 使用 frozen dataclass 和递归冻结映射。
  - 可复用：`_freeze_mapping`、`_mapping_items`、`_approved_chapter_events`、`_blocked_chapter_events`。
  - 需注意：公共入口是 `derive_skill_chain_projection()`，不新增 `derive_skill_chain_summary()`。
- **实现2**: `apps/workflow/storyforge_workflow/skills/runner.py`
  - 模式：`NovelSkillRun.to_audit_dict()` 输出 `skill_name`、`skill_version`、`status`、`input_refs`、`output_refs`、`budget`、`error_summary`。
  - 可复用：真实 skill run 字典格式。
  - 需注意：不应把 `draft`、`prompt`、`scene_packet` 等未知顶层字段转入投影。
- **实现3**: `apps/workflow/tests/test_skill_audit_summary.py`
  - 模式：覆盖 completed、blocked、budget pause、provider degradation、不可变快照和内容泄露防护。
  - 可复用：`_assert_common_event_fields()` 和 progress fixture 风格。
  - 需注意：新增测试必须保持既有 fallback 派生路径不变。
- **实现4**: `apps/workflow/tests/test_novel_skill_runner.py`
  - 模式：runner 记录只暴露引用化字段。
  - 可复用：真实 run 字典的输入输出约束。

### 2. 项目约定

- **命名约定**: 私有 helper 使用 `_recorded_skill_run_events` / `_recorded_skill_run_event`。
- **文件组织**: 审计派生逻辑留在 `skills/audit.py`；测试留在 `tests/test_skill_audit_summary.py`。
- **导入顺序**: 不新增导入，沿用标准库和现有 typing。
- **代码风格**: 使用 tuple、Mapping、dict 白名单复制和不可变快照。

### 3. 可复用组件清单

- `NovelSkillRunEvent`: 投影事件结构。
- `BookRunSkillProjection`: BookRun 技能链投影结构。
- `_freeze_mapping`: 投影不可变快照。
- `_mapping_items`: 安全过滤 mapping 序列。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: TDD，先新增真实 `skill_runs` 优先测试并确认 RED。
- **参考文件**: `tests/test_skill_audit_summary.py`。
- **覆盖要求**: completed chapter、blocked chapter、非法完整内容不泄露、旧派生路径回归。

### 5. 依赖和集成点

- **外部依赖**: 无新增。
- **内部依赖**: `runner.py` 的 `to_audit_dict()` 输出格式。
- **集成方式**: `progress.completed_chapters[*].skill_runs` 或 `progress.blocked_chapter.skill_runs` 存在时优先转换。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 真实 runner 记录比 progress 字段派生更完整，能保留 repair 后第二次 judge 等链路。
- **优势**: 兼容旧 progress；不改公共函数名；不引入 runner 类依赖。
- **劣势和风险**: 如果调用方未把 skill_runs 写入 progress，仍只能得到旧的派生摘要。

### 7. 关键风险点

- **并发问题**: 无共享可变状态。
- **边界条件**: skill run 缺少 `skill_name` 或 `status` 时跳过；缺少 refs 时输出空映射。
- **性能瓶颈**: 只遍历小规模 skill_runs 列表。
- **安全考虑**: 只复制白名单字段，未知顶层字段不进入投影。
