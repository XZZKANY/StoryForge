## 编码前检查 - StoryForge 后端重构计划

时间：2026-05-20

□ 已查阅上下文摘要文件：`.codex/context-summary-重构计划.md`
□ 将使用以下可复用组件：

- `app.db.deps.SessionDependency`：统一路由会话依赖
- `app.common.math.safe_ratio`：统一安全比率计算
- `app.common.scope.validate_scope`：统一作用域存在性校验
- `app.db.queries.latest_by_lineage`：统一谱系最新版本查询
- `app.models`：统一模型注册入口

□ 将遵循命名约定：领域服务使用 `snake_case`，异常类使用 `PascalCase`，路由函数使用 `*_endpoint`
□ 将遵循代码风格：保持简体中文注释与错误消息，导入分层清晰，尽量不引入额外抽象
□ 确认不重复造轮子，证明：已检查 `analytics/service.py`、`quality/service.py`、`evaluations/service.py`、`prompt_packs/service.py`、`retrieval/service.py`、`assets/service.py`、`style_packs/service.py`、`artifacts/service.py`、`series/service.py`、`books/lineage_service.py` 等文件，确认存在可抽取的重复逻辑

## 编码中记录 - 清理剩余 Router 的 SessionDependency

时间：2026-05-20

- 已将清单中的 14 个 router 统一改为 `from app.db.deps import SessionDependency`。
- 已删除本地 `SessionDependency = Annotated[Session, Depends(get_session)]` 声明、`Depends`、`Session`、`get_session` 相关导入。
- 对仍使用 `Query` 参数的 router 保留 `Annotated` 导入；对 `workspaces` 和 `exports` 中不再使用的 `Annotated` 导入已同步清理。
- 验证：`python -m compileall app/ tests/` 已通过。

## 编码中记录 - 提取公共工具函数与版本谱系查询

时间：2026-05-20

- 新增 `app/common/__init__.py`、`app/common/math.py`、`app/common/scope.py`。
- `analytics/service.py` 与 `quality/service.py` 已改用 `safe_ratio`。
- `evaluations/service.py`、`prompt_packs/service.py`、`retrieval/service.py` 已复用 `validate_scope`，并保留原领域异常与错误消息。
- 新增 `app/db/queries.py`，通过 `latest_by_lineage` 统一谱系最新版本子查询。
- 已替换 `assets`、`style_packs`、`prompt_packs`、`artifacts`、`series`、`quality`、`books/lineage_service` 中的版本谱系查询。
- 验证：`python -m compileall app/ tests/` 已通过。
- 验证：`python -m pytest ...` 因全局 Python 缺少 pytest 无法执行；已使用 `uv run python -m pytest ... -v` 执行相关 27 个测试，全部通过。

## 编码后声明 - 已完成的重构批次

时间：2026-05-20

### 1. 复用了以下既有组件

- `app.db.deps.SessionDependency`：统一路由会话依赖，位于 `app/db/deps.py`
- `app.common.math.safe_ratio`：统一安全比率计算，位于 `app/common/math.py`
- `app.common.scope.validate_scope`：统一作用域存在性校验，位于 `app/common/scope.py`
- `app.db.queries.latest_by_lineage`：统一谱系最新版本查询，位于 `app/db/queries.py`
- `tests/conftest.py`：统一测试夹具

### 2. 遵循了以下项目约定

- 命名约定：领域服务继续使用 `snake_case`，路由函数继续使用 `*_endpoint`
- 代码风格：中文错误消息与注释保持一致，导入层次清晰，没有引入新框架
- 文件组织：公共工具放在 `app/common` 与 `app/db`，测试公共夹具集中到 `tests/conftest.py`

### 3. 对比了以下相似实现

- `analytics/service.py` 与 `quality/service.py`：重复的 `_safe_ratio` 已统一替换为公共函数
- `assets/service.py`、`style_packs/service.py`、`prompt_packs/service.py`、`artifacts/service.py`、`series/service.py`、`quality/service.py`、`books/lineage_service.py`：重复的谱系最新版本查询已统一替换
- `evaluations/service.py`、`prompt_packs/service.py`、`retrieval/service.py`：重复的作用域校验已复用公共工具

### 4. 未重复造轮子的证明

- 检查了多个 router、service、models 与测试文件，确认已有统一依赖、公共预算与公共测试模式可复用
- 已将重复的 fixture、比率计算、作用域校验与版本查询收敛到公共入口

### 5. 验证结果

- `python -m compileall app/ tests/` 通过
- `uv run python -m pytest tests/ -x -q` 通过，结果为 `106 passed`
- `python -m pytest` 直接运行失败的原因是全局 Python 环境未安装 pytest，已用项目内 `uv` 环境完成验证

## 编码中记录 - 拆分 scene_packets 与统一异常基类

时间：2026-05-20

- 新增 `app/domains/scene_packets/assembly.py`、`budget.py`、`retrieval_bridge.py`，`scene_packets/service.py` 已收敛为门面编排。
- `scene_packets` 的预算计算继续保证 `used_tokens <= token_budget`，并保持检索块测试兼容。
- 新增 `app/common/exceptions.py`，`main.py` 已注册 `DomainError` 全局处理器。
- 各域服务异常已批量迁移到统一基类；`QualityDashboardInputError` 与 `ScenePacketInputError` 已按既有 404 行为修正为 `NotFoundError`。
- 验证：`python -m compileall app/ tests/` 已通过。
- 验证：`uv run python -m pytest tests/ -x -q` 已通过，结果为 `106 passed`。
