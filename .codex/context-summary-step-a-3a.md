## 项目上下文摘要（Step A-3a）

生成时间：2026-05-25 23:35:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/batch_refinery/router.py`
  - 模式：APIRouter 负责 HTTP 状态码、依赖注入和 `HTTPException` 转换。
  - 当前行为：POST `/api/batch-refinery/runs` 直接同步调用 `run_batch_refinery()`，返回 `201` 与最终 JobRun。
  - 需注意：A-3a 需要改为 `202 Accepted` 和 queued 初始响应。
- **实现2**: `apps/api/app/domains/batch_refinery/service.py`
  - 模式：领域服务校验 Book/Scene，创建 `JobRun`，逐项执行 Judge/Repair，最后 commit/refresh。
  - 当前行为：`run_batch_refinery()` 自己创建 `status="running"` 的 JobRun。
  - 需注意：路由先创建 queued JobRun 后，后台执行必须复用同一条 JobRun，避免重复记录。
- **实现3**: `apps/api/tests/test_batch_refinery.py`
  - 模式：TestClient 调 POST/GET，数据库 fixture 通过 dependency override 注入内存 SQLite session。
  - 当前断言：POST 同步返回 `201` 和最终 progress。
  - 需注意：A-3a 后 POST 断言应变为 `202` 与 queued；GET 可验证后台任务后的最终状态。

### 2. 项目约定

- **命名约定**: Python 服务函数使用 snake_case，路由函数按动作命名。
- **文件组织**: 路由层只处理 HTTP 与依赖注入；服务层处理数据库状态迁移。
- **测试风格**: pytest + FastAPI TestClient；中文 docstring 描述业务意图；用 SQLAlchemy `select()` 验证持久化。

### 3. 可复用组件清单

- `BatchRefineryRunCreate` / `BatchRefineryRunRead`: 保持请求响应契约。
- `JobRun`: 已有 queued 默认值与 progress JSON 字段。
- `BatchRefineryInputError`: 继续用于 Book/Job 不存在的 404 映射。
- `run_batch_refinery()`: 后台任务仍复用既有逐项 Judge/Repair 逻辑。

### 4. 官方文档与外部参考

- Context7 `/fastapi/fastapi`：FastAPI path operation 可声明 `BackgroundTasks` 参数，使用 `background_tasks.add_task()` 在响应后执行普通函数；`status_code` 可设为标准 `202`。
- GitHub 代码搜索：当前会话未暴露 `github.search_code` 工具，已记录限制。

### 5. 测试策略

- **RED**: 先修改 `tests/test_batch_refinery.py` 期待 POST `202` 和 queued；当前同步实现应失败于 `201`。
- **GREEN**: 实现 queued job 创建、BackgroundTasks enqueue、后台复用同一 JobRun 后，运行 `python -m pytest tests/test_batch_refinery.py -q`。
- **范围边界**: 不实现 A-3b 的独立 `SessionLocal()`；本步骤暂沿用当前 request-scoped session。
