## 项目上下文摘要（合并 ph2-plan）

生成时间：2026-05-31 21:16:29 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_series_memory.py`
  - 模式：使用全局 `client` 与 `session_factory` fixture，先通过 `/api/series` 创建系列，再通过 `/api/series/{series_id}/memories` 和 `/api/series/memories/{memory_id}` 验证系列记忆版本化。
  - 可复用：`SeriesMemory`、`SeriesMemoryEvidence`、系列记忆历史接口。
  - 需注意：当前主干不存在 `SeriesBook` 和 `SeriesMemorySnapshot`。
- **实现2**: `apps/api/tests/test_worldbuilding_center.py`
  - 模式：直接在测试数据库中准备 `Series`、`Book`、`Asset`、`ContinuityRecord`、`SeriesMemory`，再通过 `/api/worldbuilding/center` 验证聚合输出。
  - 可复用：`Asset` 作为角色、地点、组织、伏笔事实源；`SeriesMemory` 作为世界规则和跨书约束事实源。
  - 需注意：世界观中心是只读聚合接口，不提供旧草稿的 `/api/worldbuilding/entries` 写接口。
- **实现3**: `apps/api/tests/test_style_packs.py`
  - 模式：风格包以 `Asset(asset_type="style_pack")` 建模，应用后生成 `Asset(asset_type="style_rule")`，并可被 Scene Packet 消费。
  - 可复用：`/api/style-packs`、`/api/style-packs/{id}`、`/api/style-packs/{id}/apply`。
  - 需注意：当前主干不存在 `StylePackApplication` 和 `/applications` 旧接口。
- **实现4**: `apps/api/tests/test_batch_refinery.py`
  - 模式：批量精修把 `JobRun`、`JudgeIssue`、`RepairPatch` 作为事实源，使用本地 SQLite fixture 验证进度、问题和补丁落库。
  - 可复用：`JobRun`、`JudgeIssue`、`RepairPatch`、`ScenePacket`。
  - 需注意：`batch_refinement` 是兼容旧路径的新入口，应复用这些事实源而不是新增并行模型。

### 2. 项目约定

- **命名约定**: Python 模块、函数、fixture 使用 snake_case；测试函数以 `test_` 开头，中文 docstring 描述意图。
- **文件组织**: API 领域代码位于 `apps/api/app/domains/<domain>/`，测试位于 `apps/api/tests/`。
- **导入顺序**: 标准库、第三方库、项目内导入分组；测试常用 `import app.models  # noqa: F401` 注册全部模型。
- **代码风格**: FastAPI router 保持薄层，业务逻辑放在 service；SQLAlchemy 2.0 `Mapped` 模型为事实源。

### 3. 可复用组件清单

- `apps/api/app/domains/series/models.py`: `Series`、`SeriesMemory`、`SeriesMemoryEvidence`。
- `apps/api/app/domains/series/router.py`: 系列创建、记忆创建、更新、列表和历史接口。
- `apps/api/app/domains/worldbuilding/service.py`: `build_worldbuilding_center()` 聚合系列记忆、作品资产和连续性约束。
- `apps/api/app/domains/style_packs/service.py`: `create_style_pack()`、`update_style_pack()`、`apply_style_pack()`。
- `apps/api/app/domains/batch_refinement/service.py`: 旧路径兼容入口，写入 `JobRun`、`JudgeIssue`、`RepairPatch` 和 `ScenePacket.job_run_id`。

### 4. 测试策略

- **测试框架**: pytest、FastAPI TestClient、SQLAlchemy SQLite 内存数据库。
- **测试模式**: API 集成测试使用 dependency override 指向测试会话，模型结构测试使用 `Base.metadata` 和 SQLAlchemy mapper。
- **参考文件**: `test_series_memory.py`、`test_worldbuilding_center.py`、`test_style_packs.py`、`test_batch_refinery.py`。
- **覆盖要求**: 新增草稿测试应覆盖现有模型注册、关系、外键、风格包版本化和应用、世界观聚合、批量精修兼容入口。

### 5. 依赖和集成点

- **外部依赖**: FastAPI TestClient、pytest、SQLAlchemy。
- **内部依赖**: `Base.metadata` 注册模型；`app.main` 注册领域 router；`app.models` 聚合模型导入。
- **集成方式**: API 路由调用 service，service 通过 SQLAlchemy session 读写领域模型。
- **配置来源**: API 测试使用本地 fixture 覆盖 `get_session`，无需外部服务。

### 6. 技术选型理由

- **为什么用这个方案**: 当前主干已经实现 Phase 2 的系列记忆、世界观中心和风格包资产化模型；合并旧草稿时应适配事实源，避免恢复旧模型增加维护面。
- **优势**: 保留 ph2-plan 新增验证意图，同时减少重复模型和接口分叉。
- **劣势和风险**: 新增兼容路径 `/api/batch-refinement/jobs` 与主干 `/api/batch-refinery/runs` 并存，需要测试说明它只是旧草稿兼容入口。

### 7. 关键风险点

- **并发问题**: 本次兼容入口同步执行，暂无后台并发；继续沿用本地 session。
- **边界条件**: 批量精修需拒绝不存在作品或不属于作品的场景；风格包应用需拒绝不属于作品的场景。
- **性能瓶颈**: 本次测试数据规模很小，未引入新扫描路径。
- **安全考虑**: 本次不新增认证、鉴权或安全策略。

### 8. 编码前充分性检查

- 能说出至少 3 个相似实现路径：是，见 `test_series_memory.py`、`test_worldbuilding_center.py`、`test_style_packs.py`、`test_batch_refinery.py`。
- 理解实现模式：是，领域模型和 service 为事实源，API 测试通过 TestClient 与本地 SQLite 验证。
- 知道可复用工具：是，见上方可复用组件清单。
- 理解命名和风格：是，pytest 函数和 fixture 使用 snake_case，中文 docstring 描述测试意图。
- 知道如何测试：是，先运行新增草稿测试与相关既有测试，再运行 API 全量与根目录门禁。
- 确认没有重复造轮子：是，不新增旧模型，只改测试适配现有模型和兼容入口。
- 理解依赖和集成点：是，依赖 `app.models` 注册模型、`get_session` override 和 `app.main` router 注册。
