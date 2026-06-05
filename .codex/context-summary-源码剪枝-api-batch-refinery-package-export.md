## 项目上下文摘要（源码剪枝 api-batch-refinery-package-export）

生成时间：2026-06-05 13:04:33

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/batch_refinery/service.py`
  - 模式：批量精修任务创建、后台执行、任务读取和逐项 Judge/Repair 的服务事实源。
  - 可复用：必须保留 `run_batch_refinery`、`run_batch_refinery_in_background`、`create_batch_refinery_job`、`get_batch_refinery_run`。
  - 需注意：路由和测试直接从该模块或 service 子模块导入。
- **实现2**: `apps/api/app/domains/batch_refinery/__init__.py`
  - 模式：仅重新导出 `service.py` 中的批量精修执行函数。
  - 可复用：当前仓库无具体函数包级调用方；属于重复公共出口。
  - 需注意：仓库存在 `from app.domains.batch_refinery import service`，本批不能禁止 batch_refinery 包级 service 语义。
- **实现3**: `apps/api/app/domains/batch_refinery/router.py`
  - 模式：批量精修 API 路由直接从 `batch_refinery.service` 导入任务创建、后台执行和读取函数。
  - 可复用：保持 `/api/batch-refinery` 主链路不变。
  - 需注意：本批不修改该文件。
- **实现4**: `apps/api/tests/test_batch_refinery.py`
  - 模式：通过 API 验证批量精修 JobRun 进度、部分失败和后台独立会话。
  - 可复用：本批定向验证核心测试。
  - 需注意：该测试使用 `from app.domains.batch_refinery import service as batch_service` patch 服务模块绑定。
- **实现5**: `apps/api/tests/test_source_pruning.py`
  - 模式：API 剪枝防回归测试，已有 batch_refinement 旧兼容域下线和多个包级重复出口护栏。
  - 可复用：新增本批函数转导出护栏。
  - 需注意：护栏不能禁止 service 子模块包语义。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: API 领域服务事实源位于具体 `service.py`；包级初始化文件不承担重复函数公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/api/app/domains/batch_refinery/service.py`: 批量精修服务事实源。
- `apps/api/app/domains/batch_refinery/router.py`: 批量精修 API 路由。
- `apps/api/tests/test_batch_refinery.py`: 批量精修主链路和 service 子模块包语义测试。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。
- `apps/api/tests/test_api_middleware.py`: 批量精修路径安全和限流相关抽样测试。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级函数转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_batch_refinery.py`、`tests/test_api_middleware.py`。
- **覆盖要求**: `batch_refinery/__init__.py` 不再转导出服务函数；批量精修 API、后台任务、JobRun 明细和 service 子模块包语义不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、FastAPI TestClient。
- **内部依赖**: `batch_refinery/router.py` 和测试直接导入 `app.domains.batch_refinery.service` 或 `service` 子模块。
- **集成方式**: 移除重复包级函数出口，不修改服务事实源、路由、schema、main.py、jobs/judge/repair 领域或全局模型聚合入口。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from app.domains.batch_refinery import run_batch_refinery` 或 `app.domains.batch_refinery.run_batch_refinery` 调用，包级函数转导出只增加重复入口。
- **优势**: `batch_refinery.service` 成为唯一服务函数入口，降低维护面，同时不干扰现存 `batch_refinery.service` 子模块包语义导入。
- **劣势和风险**: 外部未记录包级函数导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 不修改后台任务会话或执行流程。
- **边界条件**: 不删除或修改 `batch_refinery/service.py`、`router.py`、`schemas.py`、`main.py`、jobs/judge/repair 领域、`app/models.py`、路由或数据库模型定义。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
