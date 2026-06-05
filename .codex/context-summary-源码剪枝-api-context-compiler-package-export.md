## 项目上下文摘要（源码剪枝 api-context-compiler-package-export）

生成时间：2026-06-05 12:41:14

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/context_compiler/service.py`
  - 模式：上下文编译、持久化和快照读取的服务事实源。
  - 可复用：必须保留 `compile_context`、`persist_compiled_context`、`get_compiled_context_record` 及内部预算裁剪逻辑。
  - 需注意：`scene_packets/retrieval_bridge.py` 和测试直接从该模块导入。
- **实现2**: `apps/api/app/domains/context_compiler/__init__.py`
  - 模式：仅重新导出 `service.py` 中的上下文编译函数。
  - 可复用：当前仓库无包级调用方；属于重复公共出口。
  - 需注意：保留包目录语义即可，不应继续转导出服务函数。
- **实现3**: `apps/api/app/domains/scene_packets/retrieval_bridge.py`
  - 模式：Scene Packet 集成点，直接从 `context_compiler.service` 导入上下文编译和持久化函数。
  - 可复用：保持 Scene Packet 编译上下文接入不变。
  - 需注意：本批不修改该文件。
- **实现4**: `apps/api/tests/test_context_compiler.py`
  - 模式：直接从 `context_compiler.service` 导入上下文编译函数，验证预算裁剪、必保留块和状态引用。
  - 可复用：本批定向验证核心测试。
  - 需注意：可证明核心服务不依赖包级转导出。
- **实现5**: `apps/api/tests/test_context_compiler_persistence.py`
  - 模式：直接从 `context_compiler.service` 导入编译、持久化和读取函数，验证快照入库。
  - 可复用：本批持久化定向验证。
  - 需注意：本批不修改持久化逻辑。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: API 领域服务事实源位于具体 `service.py`；包级初始化文件不承担重复公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/api/app/domains/context_compiler/service.py`: 上下文编译服务事实源。
- `apps/api/app/domains/context_compiler/models.py`: CompiledContextRecord 模型事实源。
- `apps/api/app/domains/scene_packets/retrieval_bridge.py`: Scene Packet 对上下文编译服务的集成点。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。
- `apps/api/tests/test_context_compiler.py`: 上下文编译核心行为测试。
- `apps/api/tests/test_context_compiler_persistence.py`: 上下文编译快照持久化测试。
- `apps/api/tests/test_ide_context_snapshot.py`: IDE 上下文快照集成测试。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_context_compiler.py`、`tests/test_context_compiler_persistence.py`、`tests/test_ide_context_snapshot.py`。
- **覆盖要求**: `context_compiler/__init__.py` 不再转导出服务函数；上下文编译、快照持久化和 IDE 上下文读取行为不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、Pydantic、FastAPI TestClient。
- **内部依赖**: `scene_packets/retrieval_bridge.py`、`ide/service.py` 和测试直接导入 `app.domains.context_compiler.service` 或 `models`。
- **集成方式**: 移除重复包级出口，不修改服务事实源、模型、schema、Scene Packet 集成点或全局模型聚合入口。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from app.domains.context_compiler import ...` 或 `import app.domains.context_compiler` 调用，包级转导出只增加重复入口。
- **优势**: `context_compiler.service` 成为唯一服务入口，降低维护面。
- **劣势和风险**: 外部未记录包级导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除或修改 `context_compiler/service.py`、`models.py`、`schemas.py`、`scene_packets/retrieval_bridge.py`、`app/models.py`、路由或数据库模型定义。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
