## 项目上下文摘要（Phase 9C-2c Timeline 简单矛盾检测）

生成时间：2026-05-27 12:38:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/judge/service.py`
  - 模式：`create_judge_issues()` 校验场景后聚合多个确定性检测器，统一写入 `JudgeIssue`。
  - 可复用：`DetectedIssue`、`timeline_conflict`/`setting_conflict` 同类 payload 结构、span 替换字段。
  - 需注意：必须保持无远程 LLM 配置时可重复。
- **实现2**: `apps/api/app/domains/story_memory/service.py`
  - 模式：MemoryAtom 按作品、实体、fact_type 和章节有效区间表达长期事实。
  - 可复用：`MemoryAtomRecord` 中 `entity_type="character"`、`fact_type="status"/"location"`。
  - 需注意：有效章节使用 `Chapter.ordinal`，不是数据库 id。
- **实现3**: `apps/api/tests/test_judge_character_consistency.py`
  - 模式：直接种子 Book/Chapter/Scene/ScenePacket/规则源，调用 `create_judge_issues()` 断言新增 issue 类型。
  - 可复用：服务级红绿测试，不依赖 TestClient 或远程 LLM。
  - 需注意：测试要覆盖死亡角色出场和同时间两地两个最小规则。

### 2. 项目约定

- **命名约定**: Judge issue 类型使用 `timeline_conflict`。
- **文件组织**: 检测逻辑继续放在 `judge/service.py`，不新增 timeline 表。
- **代码风格**: 中文 summary，payload 保留具体 violation，Repair 可复用 span/replacement_text。

### 3. 可复用组件清单

- `MemoryAtomRecord`: 时间线事实来源。
- `Chapter`/`Scene`: 由 scene_id 获取 book_id 和 ordinal。
- `DetectedIssue`: 输出 timeline conflict。
- `create_repair_patch()`: 可消费 timeline_conflict 的 replacement_text。

### 4. 测试策略

- **测试框架**: pytest 服务级测试。
- **红灯测试**: 新建 `tests/test_judge_timeline_consistency.py`。
- **覆盖要求**: 已死亡角色出场必须 fail；同一角色同一时间出现在不同地点必须 fail。

### 5. 依赖和集成点

- **内部依赖**: Books/Chapters/Scenes、ScenePacket、Story Memory、Judge。
- **集成方式**: `create_judge_issues()` 读取当前章节有效 MemoryAtom 后追加 timeline_conflict。
- **配置来源**: 无新增环境变量。

### 6. 技术选型理由

- **为什么用这个方案**: .dev_plan.md 要求最小规则，Story Memory 已是长程事实真相源，直接复用避免新增表。
- **优势**: 与 9C-1 approve 后 memory 抽取自然衔接，可本地验证。
- **劣势和风险**: 首版只做明确字符串规则，不做复杂时间解析。

### 7. 关键风险点

- **边界条件**: 无相关 memory 时 Judge 行为不变。
- **误报风险**: 仅在正文同时出现角色名、时间标记和冲突地点时触发同时间两地。
- **性能瓶颈**: 每次按 book_id 读取有效 character memory；当前规模可接受。
