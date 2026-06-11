# 项目上下文摘要（PH2 Task 3：风格包复用 API）

生成时间：2026-05-14 00:00:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/worldbuilding/service.py`
  - 模式：领域 API 复用 `Asset` 作为真相源，并通过受控 asset_type 区分用途。
  - 可复用：风格包本体使用 `Asset(asset_type="style_pack")`，不新增重复模型。
- `apps/api/app/domains/series/models.py`
  - 模式：`StylePackApplication` 已作为风格包应用关系表，连接风格包资产、系列、作品和场景。
  - 可复用：应用 API 只需写该表，不需要新增迁移。
- `apps/api/tests/test_series_worldbuilding_api.py`
  - 模式：用 FastAPI TestClient 走真实 HTTP 路由，并验证资产版本谱系。
  - 可复用：风格包测试同样验证创建、更新和读取生效规则。

## 2. 项目约定

- 风格包本体复用资产，不新增独立真相源。
- 应用记录使用 `StylePackApplication`，响应字段展开 `application_id`、`style_pack_asset_id`、`series_id`、`book_id`、`scene_id`。
- 生效规则合并顺序为系列、作品、场景；后者优先，但规则列表保持去重。

## 3. 可复用组件清单

- `Asset`、`AssetCreate`、`AssetUpdate`
- `create_asset()`、`update_asset()`
- `Series`、`StylePackApplication`
- `Book`、`Scene`

## 4. 测试策略

- 红灯：新增 `test_style_packs_api.py`，运行后因 `/api/style-packs` 不存在返回 404。
- 绿灯：实现路由后运行 `uv run pytest tests/test_style_packs_api.py tests/test_series_worldbuilding_api.py -q`。
- 契约：运行 `pnpm openapi`，确认 OpenAPI 出现 `style-packs`。

## 5. 风险点

- 应用记录至少要绑定系列、作品或场景之一，否则无法确定生效范围。
- 非 `style_pack` 资产不能被应用为风格包。
- 更新风格包时必须保留 `asset_type="style_pack"`，不能让调用方改成其他资产类型。
