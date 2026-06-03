## 项目上下文摘要（伏笔生命周期状态机）

生成时间：2026-06-02 18:31:38 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/story_memory/service.py`
  - 模式：领域 service 负责引用校验、事务写入和契约对象转换。
  - 可复用：`create_memory_atom`、`list_memory_atoms`、`StoryMemoryInputError`、`_record_to_atom`。
  - 需注意：`MemoryAtomRecord` 的 `value` 是文本字段，复杂结构需要稳定序列化；`valid_from_chapter` 使用章节序号，而 `source_chapter_id` 使用章节主键。
- **实现2**: `apps/api/app/domains/story_memory/schemas.py`
  - 模式：Pydantic v2 `BaseModel`、`Field`、`Literal`、`model_validator` 定义领域契约。
  - 可复用：`MemoryEntityType` 已包含 `subplot`，`MemoryFactType` 已包含 `plot_thread`。
  - 需注意：不能触碰 `TimelineEvent` 契约，避免进入其他 worker 写集。
- **实现3**: `apps/api/app/domains/assets/service.py`
  - 模式：资产更新通过新增版本保持谱系历史，不覆盖旧版本。
  - 可复用：伏笔现状来自 `Asset(asset_type="foreshadowing")` 与 payload，但本任务更适合复用 story_memory 的 plot_thread 事实记录状态历史。
  - 需注意：不要新增大型平台或迁移，避免扩大写集。
- **实现4**: `apps/api/app/domains/worldbuilding/service.py`
  - 模式：世界观中心按只读聚合输出资产与系列记忆。
  - 证据：`unresolved_foreshadowing` 仅通过 `asset.payload.get("状态") != "已回收"` 判断。
  - 需注意：现有伏笔状态是中文 payload 值，缺少结构化生命周期、证据和转换原因。
- **实现5**: `apps/api/app/domains/scene_packets/budget.py`
  - 模式：上下文包直接把 `asset_type == "foreshadowing"` 的资产摘要放入“未回收伏笔”槽位。
  - 需注意：未读取状态机，也未处理已回收/废弃状态。
- **测试1**: `apps/api/tests/test_story_memory_contract.py`
  - 模式：纯契约测试使用 Pydantic 模型和领域函数，不依赖 HTTP。
- **测试2**: `apps/api/tests/test_story_memory_persistence.py`
  - 模式：用 `session` fixture 创建 `Book`、`Chapter`，调用领域 service 并断言持久化结果。
- **测试3**: `apps/api/tests/test_worldbuilding_center.py`
  - 模式：用真实 ORM 资产验证 `foreshadowing` payload 状态消费方式。
- **测试4**: `apps/api/tests/test_judge_repair.py`
  - 模式：状态字段如 `open`、`requires_rejudge` 由领域动作推进，并在测试中断言非法或终态影响。

### 2. 项目约定

- **命名约定**: Python 文件、函数、变量使用 snake_case；Pydantic/ORM 类使用 PascalCase；pytest 用 `test_` 前缀。
- **文件组织**: 领域 schema/service/model 放在 `apps/api/app/domains/<domain>/`；API 测试放在 `apps/api/tests/`。
- **导入顺序**: `from __future__ import annotations` 位于首行，标准库、第三方、项目内导入分组。
- **代码风格**: pytest plain `assert`；领域异常使用 `InputError`、`ConflictError` 派生类；文档字符串使用简体中文说明意图。

### 3. 可复用组件清单

- `apps/api/app/domains/story_memory/service.py:create_memory_atom`: 写入 `memory_atoms` 真相源。
- `apps/api/app/domains/story_memory/service.py:list_memory_atoms`: 按作品、实体、事实类型读取状态历史。
- `apps/api/app/domains/story_memory/schemas.py:MemoryAtom`: 长效记忆契约，可承载 `plot_thread` 事实。
- `apps/api/app/common/exceptions.py:InputError`: 非法转换等输入错误。
- `apps/api/app/common/exceptions.py:ConflictError`: 终态重复回收等状态冲突。
- `apps/api/app/domains/books/models.py:Book/Chapter`: 校验作品与章节引用。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 领域 service 单元/持久化测试，使用 `session` fixture。
- **参考文件**: `apps/api/tests/test_story_memory_contract.py`、`apps/api/tests/test_story_memory_persistence.py`、`apps/api/tests/test_worldbuilding_center.py`。
- **覆盖要求**: 正常转换 `planted -> reinforced -> paid_off`、非法回退、重复 `paid_off`、证据缺失降级。

### 5. 依赖和集成点

- **外部依赖**: Pydantic v2、SQLAlchemy，均为项目现有依赖。
- **内部依赖**: story_memory service/schema、books model、common exceptions。
- **集成方式**: 以 `MemoryAtomRecord` 存储 `entity_type="subplot"`、`fact_type="plot_thread"` 的伏笔生命周期快照。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 伏笔现状已作为 asset/payload 存在，但缺状态机；story_memory 已有 `plot_thread` 事实类型和章节有效区间，适合记录生命周期快照。
- **优势**: 不新增表、不新增路由、不破坏现有资产 payload 消费，能保留状态转换历史。
- **劣势和风险**: 复杂结构需序列化到文本字段；后续若世界观中心要消费新状态机，还需要单独集成读取逻辑。

### 7. 关键风险点

- **并发问题**: 同一伏笔并发转换可能产生两个同版本快照；本轮不新增锁，维持最小服务能力。
- **边界条件**: 终态 `paid_off`/`abandoned` 不允许继续转换；`paid_off` 缺证据时降级为 `abandoned`。
- **性能瓶颈**: 单作品单伏笔状态历史读取量低，当前 `list_memory_atoms` 足够。
- **安全考虑**: 仅使用现有领域 service 与 session，不绕过鉴权路由或修改安全中间件。

### 8. 外部资料

- Context7 查询：`/pydantic/pydantic`，用途是确认 `Literal`、`Field`、`model_validator` 适合继续作为 Pydantic v2 契约约束。
- GitHub 搜索：`"planted" "reinforced" "paid_off" foreshadowing language:Python` 未找到直接可复用实现；`"allowed_transitions" "state" "transition_reason" language:Python` 显示常见做法是显式转换表，因此本轮采用小型字典转换表。

### 9. 上下文充分性验证

- 能说出至少 3 个相似实现路径：是，见实现1至实现5。
- 理解项目实现模式：是，领域 service + Pydantic schema + pytest 持久化测试。
- 知道可复用工具：是，`create_memory_atom`、`list_memory_atoms`、`MemoryAtom`、`InputError`、`ConflictError`。
- 理解命名和风格：是，snake_case、PascalCase、中文 docstring、pytest plain assert。
- 知道如何测试：是，新增 `apps/api/tests/test_foreshadow_lifecycle.py` 并运行定向 pytest。
- 确认没有重复造轮子：是，现有伏笔仅有 asset/payload 中文状态，未发现结构化生命周期服务。
- 理解依赖和集成点：是，状态机写入 story_memory 的 `plot_thread` 记忆事实。
