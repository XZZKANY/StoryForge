# 项目上下文摘要（Worldbuilding Router 修复）

生成时间：2026-05-24 17:15:00

## 1. 任务目标

修复第二恶心点：`worldbuilding` 领域代码已经存在，但主应用未注册 router，测试也在断言 404。目标是把它明确为上线的只读世界观中心 API。

## 2. 事实证据

- `apps/api/app/main.py`
  - 当前注册 artifacts、assets、evaluations、events、batch_refinery、continuity、exports、judge、model_runs、provider_gateway、prompt_packs、repair、retrieval、scene_packets、style_packs、studio、series。
  - 当前未导入或 include `worldbuilding_router`。
- `apps/api/app/domains/worldbuilding/router.py`
  - 已定义 `APIRouter(prefix="/api/worldbuilding", tags=["世界观中心"])`。
  - 已提供 `GET /api/worldbuilding/center`。
- `apps/api/app/domains/worldbuilding/service.py`
  - 已实现 `build_worldbuilding_center()`，聚合 Series、SeriesMemory、Asset、ContinuityRecord。
- `apps/api/app/domains/worldbuilding/schemas.py`
  - 已定义 `WorldbuildingCenterRead` 响应结构。
- `apps/api/tests/test_worldbuilding_center.py`
  - 已构造 series、book、chapter、scene、character、location、organization、foreshadowing、continuity、series memory。
  - 当前测试断言 `/api/worldbuilding/center` 返回 404。
- `apps/api/tests/test_api_surface.py`
  - 当前明确断言不应注册 `/api/worldbuilding`。

## 3. 基线验证

命令：

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_worldbuilding_center.py tests/test_api_surface.py -q
```

结果：`2 passed in 0.18s`，说明当前测试在证明 worldbuilding 未开放。

## 4. 设计边界

本轮只做：

1. 在 `main.py` 注册 worldbuilding router。
2. 把 `test_api_surface.py` 从禁止 worldbuilding 改成要求 worldbuilding 存在。
3. 把 `test_worldbuilding_center.py` 从 404 改成 200 和字段聚合断言。
4. 增加 series 不存在时 404 的错误测试。

本轮不做：

- 不新增前端页面。
- 不新增世界观写入 API。
- 不新增 Agent 仲裁。
- 不新增数据库迁移。
- 不修改 worldbuilding service 的查询算法。
