## 项目上下文摘要（P2 长篇上下文 readiness gate）

生成时间：2026-06-03 02:10:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/book_runs/service.py:90`
  - 模式：`build_book_run_workflow_dispatch()` 在不执行 workflow 的前提下生成调度 payload，并在 service 层抛 `BookRunBlockedError` 阻断不满足条件的运行。
  - 可复用：`BookRunBlockedError`、`_volume_plan_from_blueprint()`、`_dispatch_start_chapter_index()`。
  - 需注意：不能影响普通单卷短篇；门禁应只在长篇/分卷元数据明确时触发。
- **实现2**: `apps/api/app/domains/story_memory/service.py:145`
  - 模式：通过 `list_memory_atoms()` / `get_active_memory_atoms()` 按作品与章节读取长效事实。
  - 可复用：active fact 可证明 Story Memory 已有连续性事实。
  - 需注意：Foreshadow lifecycle 也存储在 Story Memory 的 `plot_thread` 事实中。
- **实现3**: `apps/api/app/domains/character_bible/service.py:130`
  - 模式：Character Bible 创建/更新后同步为 Story Memory 角色 `rule` 事实，并将 `sync_status` 置为 `synced`。
  - 可复用：`list_character_bible_entries()` 可读取最新 synced 角色规范。
  - 需注意：门禁只需证明存在 synced 条目，不应重新实现角色规则同步。
- **实现4**: `apps/api/app/domains/timeline/service.py:29`
  - 模式：`list_timeline_events()` 支持按作品、卷、章查询时间线事件。
  - 可复用：至少一个 TimelineEvent 可证明长篇上下文里有时间线锚点。
  - 需注意：当前没有独立 Timeline Guard 类，先复用事件真相源作为 readiness 证据。

### 2. 项目约定

- **命名约定**: Python 使用 snake_case；领域错误使用 `*Error`；测试函数以 `test_` 开头并用中文 docstring 描述行为。
- **文件组织**: API 领域逻辑放在 `apps/api/app/domains/*/service.py`，契约测试放在 `apps/api/tests/test_*.py`。
- **导入顺序**: 标准库、第三方库、项目内导入分组；本文件新增导入应按现有 test 文件风格排列。
- **代码风格**: pytest 直接断言行为；service 层返回领域对象或抛领域错误，router 层负责 HTTP 转换。

### 3. 可复用组件清单

- `BookRunBlockedError`: dispatch 前置条件阻断。
- `list_memory_atoms()` / `get_active_memory_atoms()`: Story Memory readiness 读取。
- `list_character_bible_entries()`: Character Bible synced readiness 读取。
- `list_timeline_events()`: Timeline readiness 读取。
- `list_foreshadow_lifecycle()` / `apply_foreshadow_lifecycle_transition()`: 伏笔生命周期读取与测试造数。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先在 `test_book_run_workflow_dispatch.py` 增加 RED 测试。
- **参考文件**: `test_story_memory_contract.py`、`test_character_bible_api.py`、`test_timeline_events.py`、`test_foreshadow_lifecycle.py`。
- **覆盖要求**: 分卷缺四类上下文时阻断；补齐四类上下文后 dispatch 通过；普通单卷短篇不触发门禁。

### 5. 依赖和集成点

- **外部依赖**: 无新增。
- **内部依赖**: BookRun service 读取 Blueprint metadata、Story Memory、Character Bible、Timeline。
- **集成方式**: 在 `build_book_run_workflow_dispatch()` 中章节计划校验后、返回 payload 前执行 readiness gate。
- **配置来源**: `BookBlueprint.metadata_` 中的 `volume_count`、`volume_plan`、`longform_context_required`、`workflow_type`、`story_scale`。

### 6. 技术选型理由

- **为什么用这个方案**: dispatch payload 是 worker 执行前最后一个本地可验证边界，适合做硬门禁。
- **优势**: 不启动真实 LLM，不影响 BookRun 创建状态；缺口能在 API 端提前暴露。
- **劣势和风险**: 当前 Timeline Guard 还不是独立规则引擎，本轮只把 TimelineEvent 作为 readiness 证据；后续可升级为更细粒度的一致性检查。

### 7. 关键风险点

- **并发问题**: Character Bible 版本并发更新已有历史风险，本轮不扩大。
- **边界条件**: 普通单卷短篇、deterministic/mock 不应被误拦截。
- **性能瓶颈**: dispatch 前查询数量小，可接受；若长篇上下文增长，应后续改为计数查询。
- **安全考虑**: 不读取 `.env`，不记录 API Key；本任务不触碰 Provider 凭据。

### 8. 本轮复验记录

更新时间：2026-06-03 05:43:00 +08:00。

- `uv run pytest tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_requires_context_readiness tests/test_book_run_workflow_dispatch.py::test_longform_volume_dispatch_passes_after_context_readiness tests/test_book_run_workflow_dispatch.py::test_single_volume_dispatch_does_not_require_longform_context tests/test_story_memory_contract.py tests/test_character_bible_api.py tests/test_timeline_events.py tests/test_foreshadow_lifecycle.py -q`：24 passed。
- 覆盖范围：分卷或显式长篇缺 Story Memory、Character Bible、Timeline、Foreshadow 四类证据时阻断；补齐四类证据后 dispatch 通过；普通单卷短篇不触发长篇门禁。
- 边界：本轮只构建本地 workflow dispatch payload 和领域证据，不启动 workflow，不运行真实外部 LLM，不读取 `.env`，不代表真实 10 章或 3-5 万字长程验收完成。
