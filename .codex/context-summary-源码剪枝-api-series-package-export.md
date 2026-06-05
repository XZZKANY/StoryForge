## 项目上下文摘要（源码剪枝 api-series-package-export）

生成时间：2026-06-05 12:30:57

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/series/models.py`
  - 模式：系列根实体、系列记忆和记忆证据的 SQLAlchemy 模型事实源。
  - 可复用：必须保留模型类、表名、关系和字段。
  - 需注意：`app/models.py`、series service、worldbuilding、retrieval、quality 和测试直接从该模块导入。
- **实现2**: `apps/api/app/domains/series/__init__.py`
  - 模式：仅重新导出 `models.py` 中的系列领域模型。
  - 可复用：当前仓库无包级调用方；属于重复公共出口。
  - 需注意：保留包目录语义即可，不应继续转导出模型类。
- **实现3**: `apps/api/app/domains/series/service.py`
  - 模式：系列和系列记忆业务服务，直接从 `series.models` 导入模型类。
  - 可复用：保持创建、列表、更新、历史读取等主链路不变。
  - 需注意：本批不修改该文件。
- **实现4**: `apps/api/app/models.py`
  - 模式：全局 ORM 模型聚合入口，直接从 `app.domains.series.models` 导入系列领域模型。
  - 可复用：保持全局模型注册入口不变。
  - 需注意：本批不修改该文件。
- **实现5**: `apps/api/tests/test_series_memory.py`
  - 模式：直接从 `app.domains.series.models` 导入系列记忆模型，并验证版本历史和证据。
  - 可复用：本批定向验证核心测试。
  - 需注意：可证明 series API 主链路不依赖包级转导出。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: API 领域模型事实源位于具体 `models.py`；包级初始化文件不承担重复公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/api/app/domains/series/models.py`: 系列领域模型事实源。
- `apps/api/app/domains/series/service.py`: 系列和系列记忆业务服务。
- `apps/api/app/models.py`: 全局 ORM 模型聚合入口。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。
- `apps/api/tests/test_domain_schema.py`: 领域模型 schema 定向测试。
- `apps/api/tests/test_series_memory.py`: 系列记忆 API 与持久化测试。
- `apps/api/tests/test_series_worldbuilding_api.py`: 系列记忆进入世界观中心的集成测试。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_domain_schema.py`、`tests/test_series_memory.py`、`tests/test_series_worldbuilding_api.py`。
- **覆盖要求**: `series/__init__.py` 不再转导出 SQLAlchemy 模型；模型注册、系列记忆和世界观中心行为不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、FastAPI TestClient。
- **内部依赖**: `app/models.py`、series service、worldbuilding、retrieval、quality 和测试直接导入 `app.domains.series.models`。
- **集成方式**: 移除重复包级出口，不修改模型事实源、业务服务、路由、数据库模型定义或全局模型聚合入口。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from app.domains.series import ...` 或 `import app.domains.series` 调用，包级转导出只增加重复入口。
- **优势**: `series.models` 成为唯一模型入口，降低维护面。
- **劣势和风险**: 外部未记录包级导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除或修改 `series/models.py`、`series/service.py`、`series/router.py`、`app/models.py`、路由或数据库模型定义。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
