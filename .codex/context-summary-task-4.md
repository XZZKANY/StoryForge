# 项目上下文摘要（Task 4：章节连续性与 Scene Packet）

生成时间：2026-05-13 00:45:00 +08:00

## 1. 相似实现分析

- `apps/api/app/domains/assets/router.py`
  - 模式：FastAPI `APIRouter(prefix=...)` + `Depends(get_session)` + 服务层异常转 HTTP 响应。
  - 可复用：路由分层、`SessionDependency` 类型别名、`response_model` 输出约束。
  - 注意：路由只做协议转换，业务规则放在 service。
- `apps/api/app/domains/assets/service.py`
  - 模式：SQLAlchemy 2.0 `select()`、`session.scalars()`、显式 `commit/refresh`。
  - 可复用：作品/场景归属校验、最新版本查询、领域异常类。
  - 注意：版本化实体必须新建记录，不覆盖旧记录。
- `apps/api/tests/test_assets_api.py`
  - 模式：SQLite 内存库 + `StaticPool` + `app.dependency_overrides[get_session]`。
  - 可复用：本地可重复 API 测试夹具、中文测试说明、真实 TestClient 调用。
  - 注意：测试需要验证行为和边界，不只检查状态码。

## 2. 项目约定

- 命名约定：Python 文件和函数使用 snake_case；类名使用 PascalCase；API schema 使用 `Create/Read` 后缀。
- 文件组织：每个领域放在 `apps/api/app/domains/<domain>/`，模型、schema、service、router 分离。
- 导入顺序：`from __future__ import annotations`、标准库、第三方库、项目内部导入。
- 代码风格：简洁同步函数，业务异常在 service 定义，router 转为 HTTPException。

## 3. 可复用组件清单

- `apps/api/app/db/session.py`: `get_session` 请求数据库依赖。
- `apps/api/app/db/base.py`: `Base`、`IdMixin`、`TimestampMixin`、`VersionMixin`。
- `apps/api/app/domains/books/models.py`: `Book`、`Chapter`、`Scene` 真相源。
- `apps/api/app/domains/assets/models.py`: `Asset` 与 `EvidenceLink`，可为 Scene Packet 提供结构化资产和证据链接。
- `apps/api/app/domains/continuity/models.py`: `ContinuityRecord` 与 `ScenePacket` 已建模。
## 4. 测试策略

- 测试框架：pytest + FastAPI TestClient + SQLAlchemy SQLite 内存库。
- 参考文件：`apps/api/tests/test_assets_api.py`、`apps/api/tests/test_domain_schema.py`。
- Task 4 测试目标：
  - 输入包含 `book_id`、`chapter_id`、`scene_goal`、`active_asset_ids`、`token_budget`。
  - 输出固定槽位：章节目标、活跃角色、关系状态、未回收伏笔、风格规则、必须包含事实、必须规避事实、用户意图、证据链接。
  - 验证预算统计和超过预算时优先保留硬约束与活跃角色状态。
  - 验证章节批准后写入连续性记录：上一章摘要、角色状态变化、伏笔变化、风格漂移、下一章继承约束。

## 5. 依赖和集成点

- 外部依赖：FastAPI、Pydantic、SQLAlchemy，均沿用现有项目依赖。
- 内部依赖：`Book/Chapter/Scene`、`Asset/EvidenceLink`、`ContinuityRecord/ScenePacket`、`get_session`。
- 路由集成：需要在 `apps/api/app/main.py` 注册 continuity 与 scene packet 路由。
- 配置来源：数据库 URL 来自 `apps/api/app/db/session.py`，测试通过依赖覆盖实现本地隔离。

## 6. 技术选型理由

- 使用结构化 SQL 记录连续性和 Scene Packet，符合“关系数据库作为业务真相源”的前序决策。
- Scene Packet 先取结构化资产和摘要，再按预算加入检索/证据片段，避免检索片段覆盖硬约束。
- FastAPI 官方文档确认 `APIRouter`、`Depends` 和测试依赖覆盖适合当前分层；SQLAlchemy 2.0 文档确认 `Session.scalars(select(...))` 为现行 ORM 查询模式。

## 7. 关键风险点

- 预算裁剪：必须明确优先级，避免硬约束和活跃角色被裁剪。
- 版本记录：`ScenePacket` 和 `ContinuityRecord` 继承 `VersionMixin`，后续更新应新建或清晰记录版本。
- 证据链接：输出必须包含可追溯证据，不能只返回拼接文本。
- 路由命名：计划要求创建 `domains/scene_packets/`，但模型位于 `domains/continuity/models.py`，需通过服务层复用模型，避免重复建表。

## 8. 充分性检查

- 能定义接口契约：是，Scene Packet 创建输入和连续性批准输入均可用 Pydantic schema 表达。
- 理解技术选型：是，沿用 FastAPI + SQLAlchemy 2.0 + pytest。
- 识别主要风险：是，预算裁剪、证据链接、场景归属和版本记录。
- 知道验证方式：是，新增 `tests/test_scene_packet.py` 并运行 `uv run pytest tests/test_scene_packet.py -q`。
