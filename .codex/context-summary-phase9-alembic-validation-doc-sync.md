## 项目上下文摘要（Phase9 Alembic 验证手册事实源同步）

生成时间：2026-06-04 08:40:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/tests/test_phase9_fact_sources.py`
  - 模式：集中读取阶段文档并用 plain assert 锁定事实边界。
  - 可复用：`Path.read_text(encoding="utf-8")`、路径常量和负向旧事实断言。
  - 需注意：新增 Alembic 文档守卫必须区分离线 SQL、本地在线迁移和远端 E2E 三个层级。
- **实现2**: `docs/operations/troubleshooting.md`
  - 模式：记录远端 E2E 最新失败 run、失败命令和本地补偿验证。
  - 可复用：run `26915457170`、`2026-06-03T21:55:39Z`、`Multiple head revisions`、`tests/test_alembic_heads.py`。
  - 需注意：故障手册是排障入口，Alembic 验证手册应聚焦迁移验证事实。
- **实现3**: `apps/api/tests/test_alembic_heads.py`
  - 模式：使用 Alembic `ScriptDirectory` 验证单一 head，并通过 subprocess 运行 `alembic upgrade head --sql`。
  - 可复用：当前 head `20260604_0001`、离线 SQL 生成作为无数据库环境补偿验证。
  - 需注意：离线 SQL 生成不等于在线 PostgreSQL 数据库升级已经执行。
- **实现4**: `docs/operations/alembic-validation.md`
  - 模式：记录 Alembic 配置来源、命令、结果和风险。
  - 可复用：文档结构可保留，但内容必须从 Phase 7 旧事实改为 Phase 9 当前事实。
  - 需注意：旧路径 `D:/StoryForge/1-renovel-ai-ai-rag-tavern` 和旧 head `20260520_0001` 不应继续作为当前结论。

### 2. 项目约定

- **命名约定**: Python 测试函数使用 snake_case；Markdown 文件使用小写连字符。
- **文件组织**: 运维手册位于 `docs/operations/`；本轮上下文和审计记录写入项目本地 `.codex/`。
- **导入顺序**: Python 测试保持标准库 `Path` 常量集中定义。
- **代码风格**: pytest plain assert；文档、注释和日志使用简体中文。

### 3. 可复用组件清单

- `apps/api/tests/test_phase9_fact_sources.py`: 阶段文档事实源守卫。
- `apps/api/tests/test_alembic_heads.py`: Alembic 单 head 与离线 SQL smoke 测试。
- `.github/workflows/e2e.yml`: 远端在线迁移失败位置与预检接入点。
- `docker-compose.yml`: 本地 PostgreSQL 服务定义，端口 `55432:5432`。
- `docs/operations/troubleshooting.md`: 远端失败 run 与排障边界。

### 4. 测试策略

- **测试框架**: pytest。
- **测试模式**: 文档契约测试先红灯后绿灯。
- **参考文件**: `apps/api/tests/test_phase9_fact_sources.py`。
- **覆盖要求**: 文档必须包含当前仓库路径、当前 head、本地离线验证、Docker daemon 不可用、在线 Postgres 未复验、远端 E2E 未完成；不得保留旧路径、旧 head 当前结论或在线已通过当前声明。

### 5. 依赖和集成点

- **外部依赖**: Docker Desktop / Docker daemon、GitHub Actions、Alembic。
- **内部依赖**: `apps/api/alembic.ini`、`apps/api/alembic/env.py`、`apps/api/alembic/versions/`。
- **集成方式**: `docs/operations/alembic-validation.md` 作为专门迁移验证事实源，由 `test_phase9_fact_sources.py` 守卫。
- **配置来源**: 不读取 `.env`；当前 Docker CLI 可用，但 `docker compose ps` 无法连接 Docker daemon。

### 6. 技术选型理由

- **为什么用这个方案**: 当前缺口是手册事实过期；同步文档并加测试能防止旧 Phase 7 结论误导远端 E2E 重跑决策。
- **优势**: 低风险、可验证、直接服务远端 E2E 阻塞排查。
- **劣势和风险**: 该任务不能替代在线 Postgres 迁移实跑；Docker daemon 恢复后仍需执行临时数据库 `alembic upgrade head`。

### 7. 关键风险点

- **并发问题**: 远端 schedule 可能继续基于旧远端状态失败，文档必须继续要求确认包含本地修复后的 run。
- **边界条件**: Docker daemon 不可用时不能把在线迁移写成通过。
- **性能瓶颈**: 新增测试只读取 Markdown，无运行时开销。
- **安全考虑**: 不读取 `.env`，不写入 provider 敏感令牌或外部 LLM 凭据。
