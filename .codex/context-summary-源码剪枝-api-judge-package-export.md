## 项目上下文摘要（源码剪枝 api-judge-package-export）

生成时间：2026-06-05 12:49:31

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/judge/models.py`
  - 模式：结构化评审问题和修复补丁的 SQLAlchemy 模型事实源。
  - 可复用：必须保留模型类、表名、关系和字段。
  - 需注意：`app/models.py`、repair、quality、studio、analytics、book_runs 和测试直接从该模块导入。
- **实现2**: `apps/api/app/domains/judge/__init__.py`
  - 模式：仅重新导出 `models.py` 中的评审领域模型。
  - 可复用：当前仓库无模型类包级调用方；属于重复公共出口。
  - 需注意：仓库存在 `from app.domains.judge import service`，本批不能禁止 judge 包级 service 语义。
- **实现3**: `apps/api/app/domains/judge/service.py`
  - 模式：结构化评审服务事实源，直接从 `judge.models` 导入模型。
  - 可复用：保持语义评审、确定性回退、时间线和文风检测不变。
  - 需注意：本批不修改该文件。
- **实现4**: `apps/api/app/domains/repair/service.py`
  - 模式：定向修复服务直接从 `judge.models` 导入评审问题和修复补丁模型。
  - 可复用：本批定向验证修复集成。
  - 需注意：本批不修改该文件。
- **实现5**: `apps/api/app/domains/quality/service.py`
  - 模式：质量看板直接从 `judge.models` 导入评审问题和修复补丁模型。
  - 可复用：本批定向验证质量看板集成。
  - 需注意：本批不修改该文件。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 `test_` 前缀，docstring 使用简体中文。
- **文件组织**: API 领域模型事实源位于具体 `models.py`；包级初始化文件不承担重复模型公共出口。
- **导入顺序**: 标准库导入在前，第三方和项目内导入按现有 ruff 规则整理；本批不新增业务导入。
- **代码风格**: ruff 目标 Python 3.11，行宽 120。

### 3. 可复用组件清单

- `apps/api/app/domains/judge/models.py`: JudgeIssue、RepairPatch 模型事实源。
- `apps/api/app/domains/judge/service.py`: Judge 服务事实源。
- `apps/api/app/domains/repair/service.py`: 定向修复集成点。
- `apps/api/app/domains/quality/service.py`: 质量看板集成点。
- `apps/api/app/models.py`: 全局 ORM 模型聚合入口。
- `apps/api/tests/test_source_pruning.py`: 本批剪枝护栏。
- `apps/api/tests/test_judge_repair.py`: Judge 与 Repair API 闭环测试。
- `apps/api/tests/test_quality_dashboard.py`: 质量看板测试。
- `apps/api/tests/test_judge_semantic.py`: 保留 `from app.domains.judge import service` 包语义调用的验证参考。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 先扩展 source-pruning 红灯测试，再移除包级模型转导出。
- **参考文件**: `tests/test_source_pruning.py`、`tests/test_domain_schema.py`、`tests/test_judge_repair.py`、`tests/test_quality_dashboard.py`、`tests/test_judge_semantic.py`。
- **覆盖要求**: `judge/__init__.py` 不再转导出 SQLAlchemy 模型；judge service 包语义、模型注册、修复和质量看板行为不变。

### 5. 依赖和集成点

- **外部依赖**: pytest、ruff、SQLAlchemy、FastAPI TestClient。
- **内部依赖**: `app/models.py`、judge service、repair、quality、studio、analytics、book_runs 和测试直接导入 `app.domains.judge.models` 或 `judge.service`。
- **集成方式**: 移除重复模型包级出口，不修改模型事实源、服务、schema、路由、修复、质量看板或全局模型聚合入口。
- **配置来源**: `apps/api/pyproject.toml` 指定 pytest 和 ruff 规则。

### 6. 技术选型理由

- **为什么用这个方案**: 当前仓库无 `from app.domains.judge import JudgeIssue`、`from app.domains.judge import RepairPatch` 或 `app.domains.judge.JudgeIssue` 调用，包级模型转导出只增加重复入口。
- **优势**: `judge.models` 成为唯一模型入口，降低维护面，同时不干扰现存 `judge.service` 包语义导入。
- **劣势和风险**: 外部未记录包级模型导入会失效；当前仓库内无此调用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不删除或修改 `judge/models.py`、`judge/service.py`、`judge/schemas.py`、`judge/router.py`、`repair/service.py`、`quality/service.py`、`app/models.py`、路由或数据库模型定义。
- **性能瓶颈**: 无性能影响。
- **安全考虑**: 不修改认证、鉴权、限流、请求超时、安全响应头或审计逻辑。
