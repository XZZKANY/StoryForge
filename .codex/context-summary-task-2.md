# 项目上下文摘要（Task 2：后端领域模型与数据库迁移）

生成时间：2026-05-12 20:35:00 +08:00

## 1. 相似实现分析

- **实现1：Task 1 工程骨架**：`package.json`、`apps/api/pyproject.toml`、`docker-compose.yml`
  - 模式：monorepo 根提供统一脚本，`apps/api` 作为 Python 后端子项目。
  - 可复用：`uv run ...` 验证入口、PostgreSQL 容器、Python 依赖入口。
  - 需注意：Task 2 最终 Alembic 验证必须使用 PostgreSQL，不接受 SQLite 作为真相源替代。
- **实现2：实施计划 Task 2**：`docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md:156-205`
  - 模式：先创建失败测试，再实现 SQLAlchemy 模型，再生成迁移并验证。
  - 可复用：计划指定的十个实体、文件路径、验证命令和提交信息。
  - 需注意：模型、迁移、测试和必要数据库端口修正一起提交。
- **实现3：设计文档真相源模型**：`docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md:131-210`
  - 模式：Book Graph、Canon Graph、Plot Graph、Style Profile、Draft Lineage、Evidence Links 构成创作资产真相源。
  - 可复用：Book/Chapter/Scene、Asset、EvidenceLink 的领域含义。
  - 需注意：关系数据库是业务真相源，向量索引只作为检索加速器。
- **实现4：Context7 官方文档模式**：SQLAlchemy 2.0 与 Alembic
  - 模式：`DeclarativeBase`、`Mapped`、`mapped_column`、`relationship`；Alembic `target_metadata = Base.metadata`。
  - 可复用：统一 Base、公共 mixin、metadata 聚合导入。
  - 需注意：Alembic env 必须导入 `app.models`，否则 metadata 可能缺表。

## 2. 项目约定

- **命名约定**：Python 包与文件使用 `snake_case`，SQLAlchemy 模型类使用 `PascalCase`，表名使用复数 `snake_case`。
- **文件组织**：`apps/api/app/domains/<domain>/models.py` 按领域拆分；数据库公共能力放入 `apps/api/app/db/`。
- **导入顺序**：标准库、第三方库、项目内模块分组导入。
- **代码风格**：显式类型标注，使用 SQLAlchemy 2.0 `Mapped`、`mapped_column`、`relationship`。

## 3. 可复用组件清单

- `apps/api/pyproject.toml`：后端依赖入口，包含 Alembic 与 pytest。
- `docker-compose.yml`：PostgreSQL 容器配置，宿主端口为 `55432`，用于规避本机 `5432` 冲突。
- `.env.example`：本地 PostgreSQL 连接示例，使用 `postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge`。
- `apps/api/alembic/env.py`：导入 `app.models` 并设置 `target_metadata = Base.metadata`。

## 4. 测试策略

- **测试框架**：pytest。
- **测试模式**：领域模型 schema 单元测试、单领域独立导入 mapper 配置测试、Alembic PostgreSQL 迁移冒烟测试、compileall 编译检查。
- **参考文件**：`apps/api/tests/test_domain_schema.py`。
- **覆盖要求**：十个实体可导入；每个实体含 `id`、`created_at`、`updated_at`；版本实体含 `version`；metadata 包含预期表、字段和外键；任一领域模块单独导入后 `configure_mappers()` 不失败。

## 5. 依赖和集成点

- **外部依赖**：SQLAlchemy、Alembic、pytest、psycopg、Docker PostgreSQL。
- **内部依赖**：`app/db/base.py` 提供统一 `Base`、`IdMixin`、`TimestampMixin`、`VersionMixin`。
- **集成方式**：各领域 `models.py` 共享同一个 `Base`；`app/models.py` 集中导入所有模型；领域模块末尾预加载关系目标模型，支持单模块导入后 mapper 配置。
- **配置来源**：`apps/api/alembic.ini` 和 `DATABASE_URL`，默认指向本地 Docker PostgreSQL 的 `127.0.0.1:55432`。

## 6. 技术选型理由

- **SQLAlchemy 2.0**：官方文档推荐的声明式类型映射，适合显式领域建模。
- **Alembic**：官方文档要求 autogenerate 读取 `target_metadata`，适合从统一 ORM metadata 生成迁移。
- **PostgreSQL 真相源**：最终迁移验证使用 PostgreSQL，符合关系数据库是真相源的任务要求。

## 7. 关键风险点

- **端口冲突**：宿主 `127.0.0.1:5432` 同时存在 Docker backend 与本地 PostgreSQL 监听，导致密码认证命中错误服务；已改为 `55432:5432`。
- **mapper 注册风险**：单独导入某个领域模型时，字符串 relationship 的目标类可能未进入注册表；已通过领域模块末尾预加载关系目标模型和 subprocess 测试覆盖。
- **编码风险**：早期中文内容出现问号乱码；本轮重写 Task 2 文档和 Python docstring，并增加乱码扫描。
- **工具限制**：当前会话没有 `github.search_code` 直接工具，已记录并使用 Context7 与项目内证据替代。

## 8. 上下文充分性检查

- 能定义接口契约：是，实体、字段、关系和迁移入口均来自 Task 2 计划与设计规格。
- 理解技术选型：是，SQLAlchemy 2.0 + Alembic + PostgreSQL 对应项目技术栈。
- 识别风险点：是，主要为 Alembic 元数据导入、数据库端口冲突、单模块 mapper 注册和中文编码。
- 知道如何验证：是，使用 PostgreSQL downgrade/upgrade、pytest、compileall、独立导入检查和乱码扫描。