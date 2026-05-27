## 项目上下文摘要（Phase 9C-2b Judge 一致性维度）

生成时间：2026-05-27 12:18:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/judge/service.py`
  - 模式：`create_judge_issues()` 先校验 Scene/ScenePacket，再使用 `semantic_judge()` 或 `deterministic_judge_fallback()` 生成 `DetectedIssue`，最后写入 `JudgeIssue`。
  - 可复用：`DetectedIssue`、`JudgeIssue.payload` 的 span、expected_text、replacement_text、matched_text 字段。
  - 需注意：远程 LLM 缺配置时必须保持 deterministic fallback 可复现。
- **实现2**: `apps/api/app/domains/repair/service.py`
  - 模式：Repair 根据 `JudgeIssue.payload` 的 span 和 replacement_text 生成局部替换补丁，并要求 rejudge。
  - 可复用：现有 `create_repair_patch()` 可消费新增的 consistency violation，只要 payload 字段完整。
  - 需注意：`_repair_reason()` 目前只特殊处理 setting_conflict/style_drift，新增类型可走默认理由或补充中文说明。
- **实现3**: `apps/api/app/domains/character_bible/`
  - 模式：Character Bible 保存 `forbidden_traits` JSON 硬规则，服务层已校验角色资产归属。
  - 可复用：`CharacterBibleEntry` 查询同作品角色规则。
  - 需注意：9C-2b 只消费 forbidden_traits，不扩展 CRUD 表结构。

### 2. 项目约定

- **命名约定**: Judge issue category 使用 snake_case 字符串，如 `setting_conflict`、`style_drift`。
- **文件组织**: 一致性检测放入 Judge service；不新增独立服务，避免过度抽象。
- **测试风格**: API 使用 TestClient；服务级测试可直接调用 `create_judge_issues()` 与 `create_repair_patch()`。
- **错误/响应**: `JudgeIssueRead.from_issue()` 从 payload 展开 span、summary、repair mode。

### 3. 可复用组件清单

- `CharacterBibleEntry`: 读取 `forbidden_traits`。
- `Scene`、`Chapter`: 由 scene_id 找到 book_id。
- `DetectedIssue`: 表达新增 `character_consistency` 和 `world_consistency`。
- `RepairPatchCreate` / `create_repair_patch()`: 验证 violation 可被 Repair 消费。

### 4. 测试策略

- **红灯测试**: 新建或扩展 `tests/test_judge_character_consistency.py`。
- **覆盖要求**: 构造 Character Bible forbidden_traits，正文包含禁止短语时 Judge fail，输出 category、violation payload 和 replacement_text；应用 Repair patch 后重新 Judge 不再出现该违规。
- **相关回归**: `tests/test_judge_repair.py`、`tests/test_judge_semantic.py`。

### 5. 依赖和集成点

- **内部依赖**: Character Bible、Books/Chapters/Scenes、Judge、Repair。
- **集成方式**: `create_judge_issues()` 在现有 deterministic issues 之外追加 bible consistency issues。
- **配置来源**: 无新增环境变量，不依赖真实 LLM。

### 6. 技术选型理由

- **为什么用这个方案**: .dev_plan.md 要求 Judge 增加维度并输出 Repair 可用 violation，现有 JudgeIssue/RepairPatch payload 已支持 span 替换。
- **优势**: 最小改动、可审计、可本地 deterministic 验证。
- **劣势和风险**: forbidden_traits JSON 的结构可能多样；首版采用递归抽取字符串规则，后续可增加结构化规则类型。

### 7. 关键风险点

- **边界条件**: 无 Character Bible 时 Judge 行为不变；空 forbidden_traits 不产生问题单。
- **误报风险**: 首版仅匹配明确禁用短语，不做语义推断。
- **性能瓶颈**: 每次 Judge 按 book_id 查询 Character Bible，后续可缓存；当前本地规模可接受。
