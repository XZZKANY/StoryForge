## 项目上下文摘要（源码剪枝 api-worldbuilding-package-export）

生成时间：2026-06-05 12:57:20

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/worldbuilding/service.py`
  - 模式：世界观中心聚合和缓存失效的服务事实源。
  - 可复用：必须保留 `build_worldbuilding_center`、`invalidate_worldbuilding_cache`、Redis 缓存和聚合逻辑。
  - 需注意：路由、资产服务和测试直接从该模块导入。
- **实现2**: `apps/api/app/domains/worldbuilding/__init__.py`
  - 模式：仅重新导出 `service.py` 中的世界观中心构建函数。
  - 可复用：当前仓库无具体函数包级调用方；属于重复公共出口。
  - 需注意：仓库存在 `from app.domains.worldbuilding import service`，本批不能禁止 worldbuilding 包级 service 语义。
- **实现3**: `apps/api/app/domains/worldbuilding/router.py`
  - 模式：世界观中心 API 路由直接从 `worldbuilding.service` 导入服务函数和异常。
  - 可复用：保持 API 路由行为不变。
  - 需注意：本批不修改该文件。
- **实现4**: `apps/api/tests/test_worldbuilding_center.py`
  - 模式：通过 API 验证世界观中心聚合系列记忆、作品资产和连续性约束。
  - 可复用：本批定向验证核心测试。
  - 需注意：可证明主链路不依赖包级函数转导出。
- **实现5**: `apps/api/tests/test_redis_cache_strategy.py`
  - 模式：直接从 `worldbuilding.service` 导入服务函数，同时使用 `from app.domains.worldbuilding import service` patch 模块绑定。
  - 可复用：本批验证缓存和 service 子模块包语义。
  - 需注意：本批不禁止该包语义调用。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: API 领域服务事实源位于具体 `service.py`；包级初始化文件不承担重复函数公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/api/app/domains/worldbuilding/service.py`: 世界观中心服务事实源。
- `apps/api/app/domains/worldbuilding/router.py`: 世界观中心 API 路由。
- `apps/api/app/domains/assets/service.py`: 资产写入后的世界观缓存失效集成点。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。
- `apps/api/tests/test_worldbuilding_center.py`: 世界观中心聚合测试。
- `apps/api/tests/test_series_worldbuilding_api.py`: 系列记忆进入世界观中心的集成测试。
- `apps/api/tests/test_redis_cache_strategy.py`: 世界观中心缓存和 service 子模块包语义测试。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级函数转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_worldbuilding_center.py`、`tests/test_series_worldbuilding_api.py`、`tests/test_redis_cache_strategy.py`。
- **覆盖要求**: `worldbuilding/__init__.py` 不再转导出服务函数；世界观中心 API、系列记忆聚合、Redis 缓存和 service 子模块包语义不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、FastAPI TestClient、Redis 缓存封装。
- **内部依赖**: `worldbuilding/router.py`、`assets/service.py` 和测试直接导入 `app.domains.worldbuilding.service`。
- **集成方式**: 移除重复包级函数出口，不修改服务事实源、路由、schema、资产服务、系列领域或全局模型聚合入口。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from app.domains.worldbuilding import build_worldbuilding_center` 或 `app.domains.worldbuilding.build_worldbuilding_center` 调用，包级函数转导出只增加重复入口。
- **优势**: `worldbuilding.service` 成为唯一服务函数入口，降低维护面，同时不干扰现存 `worldbuilding.service` 子模块包语义导入。
- **劣势和风险**: 外部未记录包级函数导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除或修改 `worldbuilding/service.py`、`router.py`、`schemas.py`、`assets/service.py`、系列领域、`app/models.py`、路由或数据库模型定义。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
