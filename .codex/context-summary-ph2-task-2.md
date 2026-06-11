# 项目上下文摘要（PH2 Task 2：系列记忆与世界观 API）

生成时间：2026-05-14 00:00:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/assets/router.py`
  - 模式：路由层声明 `APIRouter`、`SessionDependency`，捕获服务异常并转换为 HTTP 状态码。
  - 可复用：系列和世界观路由继续使用 `Depends(get_session)`，业务异常不泄漏到路由外。
- `apps/api/app/domains/assets/service.py`
  - 模式：服务层负责校验作品和场景归属，资产更新通过复制最新版本实现。
  - 可复用：世界观条目本质是资产类型前缀，创建和更新应复用资产版本谱系。
- `apps/api/tests/test_assets_api.py`
  - 模式：`TestClient` + SQLite 内存库 + `app.dependency_overrides[get_session]`。
  - 可复用：Task 2 测试复用同样夹具，避免真实 PostgreSQL 和外部服务依赖。

## 2. 项目约定

- API 路由前缀使用 `/api/...`。
- Pydantic schema 使用 `BaseModel`、`Field`、`ConfigDict(from_attributes=True)`。
- 服务层异常类继承 `ValueError`，错误提示使用简体中文。
- 世界观条目不新增独立模型，复用 `Asset(asset_type="worldbuilding:{entry_type}")`。

## 3. 可复用组件清单

- `AssetCreate`、`AssetUpdate`、`AssetRead`
- `create_asset()`、`update_asset()`、`list_assets()`
- `Series`、`SeriesBook`、`SeriesMemorySnapshot`
- `Book`
- `get_session`

## 4. 测试策略

- 红灯：新增 `test_series_worldbuilding_api.py` 后运行单文件，应因路由不存在返回 404。
- 绿灯：实现 schema/service/router/main 注册后运行 `uv run pytest tests/test_series_worldbuilding_api.py tests/test_assets_api.py -q`。
- 契约：运行 `pnpm openapi`，确认 OpenAPI 包含 series 与 worldbuilding。

## 5. 依赖和集成点

- `apps/api/app/main.py` 需要注册 `series_router` 和 `worldbuilding_router`。
- `series.service` 需要查询 `Book`、`Asset`、`Series`、`SeriesBook`、`SeriesMemorySnapshot`。
- `worldbuilding.service` 复用资产服务，但需要限制 `entry_type` 白名单。

## 6. 风险点

- 资产服务的 `update_asset()` 允许修改 `asset_type`，世界观更新路由应只允许更新名称、状态和 payload，避免世界观条目越权改成其他资产类型。
- 系列记忆摘要要避免 N+1 复杂度；本阶段数据量小，使用清晰查询优先。
- `SeriesMemorySnapshotCreate` 包含 `series_id`，路由也有 `series_id`，服务层必须校验二者一致。
