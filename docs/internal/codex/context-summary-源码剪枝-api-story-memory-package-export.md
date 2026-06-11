## 项目上下文摘要（源码剪枝 api-story-memory-package-export）

生成时间：2026-06-05 13:13:04

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/story_memory/__init__.py`
  - 模式：当前仅从 `story_memory.service` 重新导出三个具体服务函数，并维护 `__all__`。
  - 可复用：无；该入口属于重复公共出口。
  - 需注意：仓库存在 `from app.domains.story_memory import service as story_memory_service`，本批不能禁止 story_memory 包级 service 子模块语义。
- **实现2**: `apps/api/app/domains/story_memory/service.py`
  - 模式：长效记忆创建、查询、冲突检测、仲裁、伏笔生命周期和抽取写入桥的服务事实源。
  - 可复用：保留所有服务函数，调用方应显式从该模块导入。
  - 需注意：本批不修改服务实现、数据库访问或错误处理。
- **实现3**: `apps/api/tests/test_story_memory_contract.py`
  - 模式：具体函数从 `app.domains.story_memory.service` 导入，同时通过 `from app.domains.story_memory import service as story_memory_service` 验证子模块包语义。
  - 可复用：作为本批保留 service 子模块语义的关键证据。
  - 需注意：不能把 service 子模块语义误判为重复函数转导出。
- **实现4**: `apps/api/tests/test_story_memory_persistence.py`
  - 模式：直接从 `story_memory.service` 导入持久化服务函数，验证 memory_atoms 表和服务契约。
  - 可复用：作为本批定向验证主链路。
  - 需注意：本批不修改 ORM 模型或持久化逻辑。
- **实现5**: `apps/api/tests/test_source_pruning.py`
  - 模式：API 剪枝防回归测试，已有多个包级重复模型或服务函数出口护栏。
  - 可复用：新增 story_memory 函数转导出护栏。
  - 需注意：护栏只禁止具体函数和转导出 import，不禁止 service 子模块。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: API 领域服务事实源位于具体 `service.py`；包级初始化文件不承担重复函数公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120；source-pruning 护栏使用朴素字符串检查。

### 3. 可复用组件清单

- `apps/api/app/domains/story_memory/service.py`: Story Memory 服务事实源。
- `apps/api/tests/test_story_memory_contract.py`: 服务契约和 service 子模块包语义验证。
- `apps/api/tests/test_story_memory_persistence.py`: Story Memory 持久化主链路验证。
- `apps/api/tests/test_ide_story_memory.py`: IDE Story Memory 查询 API 验证。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级函数转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_story_memory_contract.py`、`tests/test_story_memory_persistence.py`、`tests/test_ide_story_memory.py`。
- **覆盖要求**: `story_memory/__init__.py` 不再转导出具体服务函数；Story Memory 契约、持久化和 IDE 查询主链路不变；service 子模块包语义不被禁止。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、FastAPI TestClient。
- **内部依赖**: Story Memory 调用方直接导入 `app.domains.story_memory.service` 或合法使用 `from app.domains.story_memory import service` 子模块。
- **集成方式**: 移除重复包级函数出口，不修改服务事实源、schema、模型、IDE 路由、认证鉴权、安全中间件或共享契约。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无具体函数包级调用，包级函数转导出只增加重复入口；pytest 支持 `test_*.py` 和 `test_` 函数自动发现，并对普通 `assert` 提供断言内省，适合当前 source-pruning 护栏。
- **优势**: `story_memory.service` 成为唯一具体服务函数入口，降低维护面，同时不干扰现存 service 子模块包语义。
- **劣势和风险**: 外部未记录包级函数导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 不修改数据库会话、仲裁写入或后台流程。
- **边界条件**: 不删除或修改 `story_memory/service.py`、`schemas.py`、`models.py`、IDE 路由、认证鉴权、安全中间件或共享契约。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
