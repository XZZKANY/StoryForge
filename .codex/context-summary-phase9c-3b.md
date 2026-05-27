## 项目上下文摘要（Phase 9C-3b Style Guard）

生成时间：2026-05-27 12:25:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/judge/service.py`
  - 模式：`create_judge_issues()` 汇总本地规则，转为 `DetectedIssue` 后写入 `JudgeIssue.payload`。
  - 可复用：`style_drift` 问题类型、`DetectedIssue`、payload 元数据扩展。
  - 需注意：现有 `_detect_style_drift()` 依赖显式 `style_rules`，不能满足从已批准章节建立基线。
- **实现2**: `apps/api/app/domains/continuity/service.py`
  - 模式：章节批准后写入 `style_drift` 连续性记录。
  - 可复用：批准章节是文风真相源的一部分。
  - 需注意：`style_drift` 记录是摘要，不等同正文指纹。
- **实现3**: `apps/api/tests/test_judge_character_consistency.py`
  - 模式：服务层构造本地数据，调用 `create_judge_issues()`，直接断言 `JudgeIssue.payload` 中的结构化 violation。
  - 可复用：9C 风格的红绿测试方式。
  - 需注意：避免远程 LLM，保证本地可重复。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；Judge issue 类型使用已有 `style_drift`。
- **文件组织**: Judge 规则集中在 `apps/api/app/domains/judge/service.py`。
- **导入顺序**: 标准库、第三方库、本地 app 模块。
- **代码风格**: 中文 docstring；小函数；确定性本地规则优先。

### 3. 可复用组件清单

- `Chapter.status == "approved"`: 已批准章节筛选条件。
- `Scene.content`: 已批准正文和待评审正文来源。
- `DetectedIssue.metadata`: 写入 `style_score`、基线指纹和来源场景。
- `RepairPatch` 的 `style_drift` 分支：后续修复继续复用。
### 4. 测试策略

- **测试框架**: pytest + SQLAlchemy 内存 SQLite fixture。
- **测试模式**: 服务层直接调用 `create_judge_issues()`，断言数据库模型和 payload。
- **参考文件**: `tests/test_judge_character_consistency.py`、`tests/test_judge_timeline_consistency.py`、`tests/test_judge_repair.py`。
- **覆盖要求**: 无显式 style_rules 时，故意切换文风仍应生成 `style_drift`，且 payload 中 `style_score < style_baseline_score`。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 2.0 ORM；Context7 已确认 `select().join()` 查询方式。
- **内部依赖**: `JudgeIssueCreate.scene_id` 定位当前章节和作品；`Chapter/Scene` 提供已批准正文。
- **集成方式**: 在 `create_judge_issues()` 追加 `_detect_style_fingerprint_drift(session, payload)`。
- **配置来源**: 不新增配置，阈值作为本地常量。

### 6. 技术选型理由

- **为什么用这个方案**: 复用现有 Judge 问题单和 Repair 支持，满足“分数下降”可审计证据。
- **优势**: 无迁移、无外部 NLP 依赖、完全本地可验证。
- **劣势和风险**: 指纹是启发式，不是完整风格模型；后续可接入更细的风格向量或 LLM Judge。

### 7. 关键风险点

- **边界条件**: 无已批准章节、无正文或分数未低于阈值时不生成问题单。
- **性能瓶颈**: 当前查询全量已批准正文；后续长篇可限制最近 N 章或缓存。
- **安全考虑**: 本任务不新增认证、鉴权、加密或远程调用。

### 8. 外部检索补偿

- 当前会话无 `github.search_code` 工具；已用工具发现确认不可用。
- 已使用 Context7 查询 SQLAlchemy 2.0 ORM `select().join()` 用法作为查询实现依据。
