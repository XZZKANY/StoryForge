# 项目上下文摘要（story_state Q1 P0）

生成时间：2026-06-30 +08:00

## 1. 相似实现分析

- **continuity 结构化边**：`apps/api/app/domains/continuity/models.py`、`edge_constraints.py`、`service.py`
  - 模式：ORM 模型 + Pydantic 候选输入 + 服务层写入前冲突校验。
  - 可复用：`ContinuityEdgeCandidate` 的类型化候选、`check_edge_constraints()` 的确定性校验、冲突即 rollback 的服务层事务风格。
  - 需注意：`edge_constraints` 只处理关系/时间线/关系性状态边，不能承担单实体状态机投影。
- **Story Memory 抽取写入**：`apps/api/app/domains/story_memory/models.py`、`extract.py`、`service.py`
  - 模式：白名单抽取 payload 转换为持久化事实；输入缺失时跳过，来源不合法时显式报错。
  - 可复用：`write_memory_extract_atoms()` 的服务层边界与 `MemoryAtomRecord` 的章节有效期字段约定。
  - 需注意：当前并发 runner 的本地抽取仍写死林岚/灯塔；本批只建 story_state 落点，不替换真实抽取链路。
- **迁移与测试夹具**：`apps/api/alembic/versions/20260609_0001_add_continuity_edges.py`、`apps/api/tests/conftest.py`
  - 模式：Alembic 迁移使用 `_table_exists()`/`_create_index_once()` 幂等防护；API 测试通过 `Base.metadata.create_all()` 创建内存 SQLite。
  - 可复用：迁移中的 inspect/op 写法、测试中的 `session` fixture。
  - 需注意：新增 ORM 模型必须经 `app.models` 导入，否则测试数据库不会创建新表。

## 2. 项目约定

- **命名约定**：Python 文件与函数使用 `snake_case`；ORM 类使用 `PascalCase`；私有 helper 使用下划线前缀。
- **文件组织**：API domain 采用 `models.py` / `schemas.py` / `service.py` / `__init__.py`；领域决策在 service 层，不放路由或客户端。
- **导入顺序**：`from __future__ import annotations` 置顶；标准库、第三方、本项目依次导入；ruff 负责排序检查。
- **代码风格**：简体中文注释和错误提示；不写变更说明式注释；缺失事实显式报错，不伪造 clean 值。

## 3. 可复用组件清单

- `app.common.exceptions.ConflictError` / `NotFoundError`：服务层领域错误基类。
- `app.db.base.Base` / `IdMixin` / `TimestampMixin`：ORM 模型基类与通用字段。
- `app.domains.books.models.Book`：story_state 第一刀按作品维度落库，后续再接 BookRun。
- `app.domains.continuity.edge_constraints.check_edge_constraints()`：后续 edge 类 CHANGES 可复用的结构边校验。
- `apps/api/tests/conftest.py::session`：单元测试数据库会话。

## 4. 测试策略

- **测试框架**：pytest + SQLAlchemy SQLite 内存库。
- **测试模式**：服务层单元测试，不起 FastAPI，不调用真实 LLM。
- **参考文件**：`tests/test_continuity_edges.py`、`tests/test_story_memory_persistence.py`、`tests/test_alembic_heads.py`。
- **覆盖要求**：grounding 成功/失败、事件 append、ledger 投影、按章 reproject、伏笔/秘密/位置等确定性不变量。

## 5. 依赖和集成点

- **外部依赖**：SQLAlchemy 2.0 ORM typed mapping；Alembic op migration。已用 Context7 查询官方文档确认 `Mapped`/`mapped_column` 与 `op.create_table` 基本模式。
- **内部依赖**：`Book` 存在性校验、`Base.metadata` 注册、Alembic 迁移 head。
- **集成方式**：第一刀只暴露可直接调用的 service 函数；不改 HTTP 路由，不刷新 OpenAPI。
- **配置来源**：无新增环境变量。

## 6. 技术选型理由

- **为什么用 append-only + ledger**：符合 `story-state-model-design.md`，事件日志保留逐章审计，ledger 提供当前态快读。
- **优势**：可回放、可按章回滚、后续能接 `_judge_and_repair_loop` 和 Desktop runtime 的同一真相源。
- **劣势和风险**：第一刀仅确定性 grounding，不含 LLM 语义咨询；全量 reproject 对超长书可能需要后续增量优化。

## 7. 关键风险点

- **并发问题**：当前不接并发生成 loop；后续接入时需要串行提交或事务锁定同一 book 的 state commit。
- **边界条件**：同批 change 之间的不变量必须按 seq 顺序 fold，失败时整批不落库。
- **性能瓶颈**：surface grounding 使用正文子串匹配，章节级可接受；后续长程可按实体/别名索引优化。
- **安全考虑**：不读取 provider secret；不新增外部网络调用。

## 8. 工具说明

- 已使用 `rg` / `Get-Content` 做本地检索与读取；本环境未暴露 desktop-commander 与 github.search_code 工具，故以项目内相似实现和 Context7 官方文档替代。
- 已使用 sequential-thinking 与 shrimp-task-manager 完成复杂任务分析、反思和任务拆分。
