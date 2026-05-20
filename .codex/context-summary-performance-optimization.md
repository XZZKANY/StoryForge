## 项目上下文摘要（性能优化方案 A）

生成时间：2026-05-20 00:00:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py:130-178`
  - 模式：同步 service 函数接收 `Session` 与 Pydantic schema，使用 SQLAlchemy `select` 查询后返回 Read schema。
  - 可复用：`selectinload`、`RetrievalHitRead`、现有排序规则。
  - 需注意：当前 `session.scalars(statement).all()` 会载入全部候选 chunk。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py:64-70`
  - 模式：Workbench 列表接口先复用 `list_retrieval_sources`，再映射为 Workbench schema。
  - 可复用：`RetrievalWorkbenchSourceRead` 构造逻辑。
  - 需注意：逐条 `_build_workbench_source` 会查询最新 refresh run，形成 N+1。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_workbench_api.py:1-140`
  - 模式：pytest + FastAPI TestClient + SQLite StaticPool，测试真实 service/router 行为。
  - 可复用：构造 Book、RetrievalSource、RefreshRun 的测试流程。
  - 需注意：新增查询数量断言应绑定当前测试 engine 的事件监听并及时移除。

### 2. 项目约定

- **命名约定**: Python 使用 `snake_case` 函数与变量；TypeScript 使用 camelCase 函数与 readonly 类型字段。
- **文件组织**: 后端按 `apps/api/app/domains/<domain>/` 分 router、service、schemas、models；数据库会话在 `apps/api/app/db/session.py`。
- **导入顺序**: `from __future__ import annotations` 在首行，标准库、第三方库、项目内导入分组。
- **代码风格**: 类型标注完整，测试描述和注释使用简体中文，服务层保持同步函数。

### 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: `list_retrieval_sources`、`_build_workbench_source`、`_keywords`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: embedding 与检索服务层测试模式。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_workbench_api.py`: Workbench API 和资料源构造测试模式。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/db/session.py`: 全局 `engine` 与 `SessionLocal` 创建点。

### 4. 测试策略

- **测试框架**: pytest，配置位于 `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/pyproject.toml`。
- **测试模式**: 后端单元/集成测试使用 SQLite StaticPool fixture 与真实 service/router。
- **参考文件**: `apps/api/tests/test_retrieval_workbench_api.py`、`apps/api/tests/test_retrieval_embedding.py`。
- **覆盖要求**: 关键词去重边界、Workbench 多 source 最新 run 状态、数据库连接池环境变量解析。

### 5. 依赖和集成点

- **外部依赖**: SQLAlchemy 2.0、FastAPI、pytest、psycopg、PostgreSQL；Context7 文档确认 `create_engine` 支持 `pool_size`、`max_overflow`、`pool_pre_ping`。
- **内部依赖**: Retrieval service 依赖 RetrievalSource、RetrievalChunk、RetrievalRefreshRun ORM 模型；Workbench router 调用 service。
- **集成方式**: 路由层注入同步 SQLAlchemy `Session`，service 层直接返回 Pydantic Read schema。
- **配置来源**: `DATABASE_URL` 与新增连接池环境变量从 `os.getenv` 读取。

### 6. 技术选型理由

- **为什么用这个方案**: 方案 A 只改低风险热点：保序 set 去重、SQLAlchemy 批量查询、官方 engine pool 参数。
- **优势**: 不引入新依赖，不修改 API 契约，不做数据库迁移，可用现有 pytest 本地验证。
- **劣势和风险**: 查询数量测试对 SQLAlchemy 内部行为敏感；连接池参数需避免影响 SQLite 测试场景。

### 7. 关键风险点

- **并发问题**: 连接池参数过小会限制吞吐，过大可能压垮数据库；因此采用环境变量配置并提供默认值。
- **边界条件**: 空 source 列表、无 refresh run 的 source、重复中文关键词、非法环境变量。
- **性能瓶颈**: 本轮不解决 pgvector DB 侧排序和 Studio 串行瀑布，只清理低风险瓶颈。
- **安全考虑**: 本轮不新增认证、鉴权、加密或审计逻辑。

### 8. 上下文充分性检查

- 能说出至少 3 个相似实现路径：是，见第 1 节。
- 理解项目实现模式：是，同步 service + SQLAlchemy select + Pydantic schema。
- 知道可复用组件：是，见第 3 节。
- 理解命名和风格：是，见第 2 节。
- 知道如何测试：是，见第 4 节。
- 确认不重复造轮子：是，复用现有 service 与 pytest 模式，不新增缓存/查询框架。
- 理解依赖和集成点：是，见第 5 节。

## P0 轻量版补充上下文（检索评分热路径）

生成时间：2026-05-20 00:00:00

### 1. 相似实现补充分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py:130-174`
  - 模式：`search_retrieval` 查询候选 chunk 后逐条调用 `_score_chunk`。
  - 可复用：现有排序、score schema 与 reranker 调用链。
  - 需注意：本轮只优化私有评分函数，不改变查询结果契约。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py:374-413`
  - 模式：`_score_chunk` 与 `_cosine_similarity` 负责关键词分与向量分。
  - 可复用：既有不同长度向量按较短长度计算、零向量返回 0、结果 round 到 4 位。
  - 需注意：当前 `_cosine_similarity` 使用切片并多次遍历。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`
  - 模式：通过注入测试 embedding client 验证语义检索、reranker 与私有检索行为。
  - 可复用：`inspect.getsource` 已用于锁定 `_keywords` 性能结构。
  - 需注意：新增结构测试必须配合行为断言，避免只测实现文本。

### 2. 本轮充分性检查

- 接口契约：不改变任何公开 schema、router 或请求参数。
- 技术选型：使用 Python 内建 `set` 和单循环累积，不引入 numpy 或 pgvector 迁移。
- 风险点：需保持 `_cosine_similarity` 的空向量、零向量、不同长度和四位小数行为。
- 验证方式：红灯目标测试、绿灯目标测试、检索相关 pytest、全量 API pytest。

## P2 补充上下文（Studio SSR 请求并行化）

生成时间：2026-05-20 00:00:00

### 1. 相似实现补充分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/studio/page.tsx:104-315`
  - 模式：页面本地定义 readonly 类型、读取函数、类型守卫和 `cache: "no-store"` fetch。
  - 可复用：现有错误状态、中文错误文案、endpoint 常量。
  - 需注意：当前 `StudioPage` 5 个 await 严格串行。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/tests/phase1-navigation.test.tsx`
  - 模式：`node:test` 静态读取源码，断言页面中文契约和关键实现边界。
  - 可复用：`assertCleanChineseContract`、`assertIncludesAll`。
  - 需注意：新增 SSR 调度结构断言应避免影响渲染内容契约。
- **实现3**: Next.js App Router 官方文档（Context7 `/vercel/next.js`）
  - 模式：async Server Component 内可用 `Promise.all` 并行数据获取；`fetch(..., { cache: 'no-store' })` 表示动态读取。
  - 可复用：在页面组件内先发起 promise 再统一 await。
  - 需注意：只并行真实无依赖的请求。

### 2. 依赖与并行边界

- `readStudioBooks` 必须第一步执行，因为 selectedBook 来源于作品列表。
- `readStudioChapterGoal` 与 `readStudioScenePacket` 只需要 `book_id` 和 `target_ordinal`，可在 selectedBook 后并行。
- `readStudioJudgeReview` 与 `readStudioRepairPatches` 只需要 `scene_packet_id`，可在 scene packet ready 后并行。
- 保留所有 `cache: "no-store"`，不改缓存语义。

## P5 补充上下文（Scene Packet 多次 commit 合并）

生成时间：2026-05-20 00:00:00

### 1. 相似实现补充分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/scene_packets/service.py:32-110`
  - 模式：`assemble_scene_packet` 装配上下文、创建 `ScenePacket`，最后 `session.commit()` 与 `session.refresh()`。
  - 可复用：外层统一事务提交点。
  - 需注意：当前 `_attach_compiled_context` 内部会先触发 compiled context 提交。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/context_compiler/service.py:146-177`
  - 模式：`persist_compiled_context` 默认保存快照并提交。
  - 可复用：直接调用时保持默认 commit 行为。
  - 需注意：Scene Packet 热路径需要关闭内部 commit 并改用 flush。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_context_compiler_persistence.py`
  - 模式：已有直接持久化测试与 Scene Packet 组装持久化测试。
  - 可复用：`_create_book_chapter_scene` 与 `assemble_scene_packet` 数据构造模式。
  - 需注意：新增 commit 次数测试应只计组装调用期间的 commit。

### 2. SQLAlchemy 文档依据

- Context7 SQLAlchemy 2.0 文档确认 `Session.flush()` 会把 pending changes 发送到数据库并分配主键，但不提交事务。
- 因此 `persist_compiled_context(commit=False)` 可通过 `flush` 获得 record ID，并由 `assemble_scene_packet` 外层一次 commit 统一落库。

## P6 轻量版补充上下文（Provider runtime lru_cache）

生成时间：2026-05-20 00:00:00

### 1. 相似实现补充分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/runtime_config.py:45-153`
  - 模式：`load_runtime_provider_config(capability)` 按 capability 读取环境变量并返回 Pydantic config。
  - 可复用：纯函数签名和三类 capability 分支。
  - 需注意：环境变量变化后需要显式清理缓存。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/service.py:66-83`
  - 模式：数据库 provider 缺失时调用 runtime fallback。
  - 可复用：无需修改调用方，保持函数签名即可。
  - 需注意：本轮不缓存数据库 provider 查询。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/embedding_client.py:28-37`
  - 模式：本地 embedding 每次批量生成前读取 runtime provider config。
  - 可复用：缓存后调用方无感。
  - 需注意：测试中 monkeypatch 环境变量时必须调用 `cache_clear()`。

### 2. 本轮充分性检查

- 接口契约：`load_runtime_provider_config(capability)` 签名和返回类型不变。
- 技术选型：使用标准库 `functools.lru_cache(maxsize=3)`，三类 capability 刚好覆盖缓存键。
- 风险点：进程内环境变量变更不会自动生效，需显式 `cache_clear()`。
- 验证方式：红灯缓存 API 测试、provider 测试、retrieval 相关测试、全量 API pytest。

## P0 候选裁剪补充上下文（关键词 SQL 预过滤）

生成时间：2026-05-20 00:00:00

### 1. 相似实现补充分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py:130-174`
  - 模式：`search_retrieval` 构造 SQLAlchemy `select`，按 scope 查询 active chunks 后 Python 评分。
  - 可复用：现有 `join(RetrievalSource)`、scope where、排序和 reranker 链路。
  - 需注意：无 embedding_client 的关键词路径可以预过滤；有 embedding_client 的语义路径不能裁剪。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`
  - 模式：服务层直接调用 `search_retrieval`，可 monkeypatch 私有函数验证热路径行为。
  - 可复用：Book/RetrievalSource 构造、SQLite session fixture。
  - 需注意：测试不用耗时阈值，改用 `_score_chunk` 调用数。
- **实现3**: SQLAlchemy 2.0 官方文档（Context7 `/websites/sqlalchemy_en_20`）
  - 模式：`or_()` 可组合多个 WHERE 条件，`select().join().where()` 是 2.0 ORM 查询风格。
  - 可复用：在现有 statement 上追加 `RetrievalChunk.content.ilike(...)` 与 `RetrievalSource.title.ilike(...)`。

### 2. 本轮充分性检查

- 接口契约：`search_retrieval` 参数和返回不变。
- 技术选型：SQLAlchemy `or_` + `ilike`，不新增依赖、不做迁移。
- 风险点：预过滤可能漏召回，因此过滤为空时回退全量；embedding 路径不预过滤。
- 验证方式：红灯调用数测试、检索相关 pytest、全量 API pytest。

## P0 候选裁剪摘要补充上下文

生成时间：2026-05-20 00:00:00

### 1. 相似实现补充分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：`_load_search_candidates` 当前返回裸 `list[RetrievalChunk]`。
  - 可复用：上一轮候选裁剪 helper、预过滤词 helper和回退逻辑。
  - 需注意：本轮只改变私有 helper 返回结构。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/embedding_client.py`
  - 模式：项目已使用 `@dataclass(frozen=True)` 表达内部轻量结果对象。
  - 可复用：用 dataclass 表达候选加载摘要。
  - 需注意：不引入 Pydantic schema，避免误以为是 API 契约。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`
  - 模式：已有多个私有 helper 结构测试，用于锁定性能行为。
  - 可复用：直接调用 service 私有函数保护候选裁剪观测点。

### 2. 本轮充分性检查

- 接口契约：不改变 `search_retrieval` 公开返回和 router。
- 技术选型：标准库 dataclass，不新增依赖。
- 风险点：私有 helper 返回类型改变，需同步 `search_retrieval` 使用 `.chunks`。
- 验证方式：红灯摘要属性测试、检索相关 pytest、全量 API pytest。

## P0 pgvector 迁移前置上下文

生成时间：2026-05-20 10:43:11 +08:00

### 1. 相似实现与现有模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/models.py`
  - 模式：`RetrievalChunk.embedding` 当前为 SQLAlchemy `JSON` 字段，应用层按 `list[float]` 读写。
  - 可复用：保留现有 JSON 契约，避免立即改动服务层写入路径。
  - 需注意：直接替换为 pgvector ORM 类型会影响 SQLite `Base.metadata.create_all` 单测。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/conftest.py`
  - 模式：API 测试使用 SQLite 内存库、`StaticPool` 和 `Base.metadata.create_all`。
  - 可复用：迁移测试应采用静态 SQL 契约验证，不依赖 PostgreSQL 在线服务。
  - 需注意：测试不会自动执行 Alembic migration。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/alembic/env.py` 与空 `apps/api/alembic/versions/`
  - 模式：Alembic 已配置 PostgreSQL 默认连接和 `Base.metadata`，但当前没有版本迁移脚本。
  - 可复用：新增 raw SQL migration 即可纳入既有 Alembic 目录。
  - 需注意：没有既有 migration 命名样例，本轮采用时间戳前缀和中文 docstring。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/embedding_client.py`
  - 模式：本地稳定 embedding 维度为 4，用于缺真实密钥时的本地可重复向量。
  - 可复用：PostgreSQL 前置索引先按 `vector(4)` 对齐现有本地 embedding。
  - 需注意：真实 provider 维度尚无配置项，后续切换真实 embedding 前需补维度迁移策略。

### 2. 官方文档依据

- Context7 `/pgvector/pgvector`：PostgreSQL 数据库需执行 `CREATE EXTENSION vector`；可使用 `vector(n)` 列；可创建 `USING hnsw (... vector_cosine_ops)` 索引。
- Context7 `/pgvector/pgvector-python`：SQLAlchemy 可通过 `pgvector.sqlalchemy.VECTOR` 定义 ORM Vector 字段，也可用 HNSW/IVFFlat 索引。
### 3. 技术选型与集成边界

- 本轮不新增 `pgvector` Python 依赖，不直接修改 ORM 字段类型。
- 采用 Alembic raw SQL：新增 `embedding_vector vector(4)` STORED generated column，由现有 JSON `embedding` 转换得到。
- 为 generated vector 列创建 HNSW cosine index，作为后续数据库侧向量排序的前置能力。
- 应用服务仍读写 `embedding` JSON，现有 SQLite 单测保持不变。

### 4. 风险点

- `vector(4)` 只匹配当前本地稳定 embedding；真实 embedding provider 维度可能不同。
- 本轮迁移准备索引列，不会自动把 `search_retrieval` 切换到 PostgreSQL 向量排序。
- 若本地 PostgreSQL 未启动，只能完成静态 migration 契约和 pytest 验证，在线 upgrade 需后续补跑。
- 当前会话没有可用 `github.search_code` 工具，开源实现搜索无法按 AGENTS 原文执行，已改用 Context7 官方文档作为依据。

### 5. 充分性检查

- 接口契约：不改变 API、ORM 模型和 service 函数签名。
- 技术选型：raw SQL migration 复用 Alembic，避免 SQLite 测试受 pgvector 类型影响。
- 主要风险：真实 embedding 维度迁移、PostgreSQL 在线验证环境、后续查询切换。
- 验证方式：先写静态 pytest 红灯，再新增 migration，最后跑迁移测试、检索相关测试和全量 API 测试。

### 6. 迁移链路补充核验

- 初次目录 listing 未展开 `versions` 内容；后续用文件搜索确认 `apps/api/alembic/versions` 已存在 4 个迁移文件。
- 既有迁移链路：`71dfabf6badf -> 9f2b3c4d5e6f -> c0ffee20260519 -> c0ffee20260520`。
- 新 pgvector migration 必须以 `c0ffee20260520` 为 `down_revision`，否则 Alembic 会出现多 head。
- 本轮已把该链路作为静态测试契约，防止后续误建独立 head。

## P0 pgvector 候选排序补充上下文

生成时间：2026-05-20 10:56:33 +08:00

### 1. 相似实现与现有模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：`search_retrieval` 统一构造 ORM `select(RetrievalChunk)`，scope 条件保留在 statement 内。
  - 可复用：现有 statement、`SearchCandidateLoad` 和 `_load_search_candidates` 私有入口。
  - 需注意：当前 embedding_client 存在时关闭关键词预过滤，会全量加载候选。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/alembic/versions/20260520_0001_add_pgvector_retrieval_index.py`
  - 模式：PostgreSQL 侧已准备 `embedding_vector vector(4)` generated column 与 HNSW cosine index。
  - 可复用：查询可直接使用 `retrieval_chunks.embedding_vector <=> CAST(:query_embedding AS vector)`。
  - 需注意：只适配当前 4 维本地 embedding。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`
  - 模式：检索性能行为通过私有 helper、monkeypatch 和 SQLite fixture 验证。
  - 可复用：新增 fake session 捕获 statement/params，不连接 PostgreSQL。
  - 需注意：真实数据库性能仍需后续在线验证。
- **实现4**: SQLAlchemy 2.0 官方文档（Context7 `/websites/sqlalchemy_en_20`）
  - 模式：`order_by(None)` 可清除已有排序再设置新排序；`Session.scalars(statement, params)` 支持绑定参数执行。
  - 可复用：在 pgvector 分支清除原 `order_by`，避免原 source/chunk 排序盖过向量距离。

### 2. 本轮接口契约

- `search_retrieval` 公开签名和返回不变。
- `_load_search_candidates` 私有签名增加 `query_embedding` 与 `limit`，调用方传入 `_embed_query` 结果和 payload limit。
- `SearchCandidateLoad` 增加 pgvector 观测字段：是否启用、候选上限、向量参数。
- PostgreSQL + 4 维 query embedding 才启用 pgvector 候选排序；SQLite、无 embedding、维度不匹配均保持既有路径。

### 3. 风险与验证

- 风险：真实 provider embedding 维度可能不是 4，本轮必须维度不匹配时回退。
- 风险：无在线 PostgreSQL，不能声明真实索引命中或查询计划收益。
- 验证：新增红灯测试捕获 SQL 片段和绑定参数；运行检索相关测试和全量 API pytest。

## P0 候选加载摘要日志补充上下文

生成时间：2026-05-20 11:07:46 +08:00

### 1. 相似实现与现有模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：`SearchCandidateLoad` 已承载 `chunks`、`prefilter_enabled`、`filtered_count`、`fallback_used`、`pgvector_enabled` 和 `vector_candidate_limit`。
  - 可复用：直接在 `search_retrieval` 获取 candidate_load 后记录摘要。
  - 需注意：不能记录 query 原文、chunk 内容或 excerpt。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`
  - 模式：检索行为测试集中在同一文件，已覆盖候选裁剪和 pgvector SQL 生成。
  - 可复用：pytest `caplog` 可验证日志消息和 record extra 字段。
  - 需注意：测试应避免依赖全局日志配置。
- **实现3**: `apps/api/app` 日志搜索结果
  - 模式：未发现既有 `logging`、`getLogger` 或 `logger.` 使用。
  - 可复用：采用 Python 标准库 `logging.getLogger(__name__)` 作为最小一致方案。
  - 需注意：当前没有统一日志采样配置，本轮只输出一次 search 级摘要。

### 2. 日志字段契约

- 日志消息：`检索候选加载摘要`。
- `extra` 字段：`candidate_count`、`filtered_count`、`prefilter_enabled`、`fallback_used`、`pgvector_enabled`、`vector_candidate_limit`。
- 明确不记录：query 原文、chunk 内容、title、excerpt、source_ref。

### 3. 风险与验证

- 风险：`info` 级日志会增加每次 search 的一条日志，后续可按环境调成 debug 或采样。
- 风险：项目暂无统一日志配置，当前只保证 Python logging record 可被采集。
- 验证：先写 caplog 红灯测试，再实现 logger；运行检索相关和全量 API pytest。

## P0 pgvector 候选上限配置补充上下文

生成时间：2026-05-20 11:19:20 +08:00

### 1. 相似实现与现有模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：`_vector_candidate_limit(limit)` 当前固定返回 `max(limit * 8, 32)`，`limit is None` 时返回 32。
  - 可复用：保留默认 multiplier=8、min=32，避免改变现有行为。
  - 需注意：固定值无法适配不同资料规模和 reranker 召回需求。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/db/session.py`
  - 模式：`_get_int_env(name, default)` 读取环境变量，非法整数和负数回退默认值。
  - 可复用：在 retrieval service 内采用同类小 helper，不抽公共配置模块。
  - 需注意：本轮需要非正整数回退默认值。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/runtime_config.py`
  - 模式：provider runtime 使用环境变量读取 helper 暴露运行时配置。
  - 可复用：沿用 `STORYFORGE_...` 环境变量命名风格。
  - 需注意：本轮不引入 lru_cache，便于测试和运行时调参。

### 2. 新增配置契约

- `STORYFORGE_RETRIEVAL_VECTOR_CANDIDATE_MULTIPLIER`：默认 `8`。
- `STORYFORGE_RETRIEVAL_VECTOR_MIN_CANDIDATES`：默认 `32`。
- 计算公式：`max(limit * multiplier, min_candidates)`；`limit is None` 时使用 `min_candidates`。
- 非法、空值、非正值回退默认值。

### 3. 风险与验证

- 风险：运行时环境变量变更会立即影响候选规模，应在线上谨慎调整。
- 风险：候选上限过小会影响召回，过大会增加 Python scoring 成本。
- 验证：monkeypatch 环境变量红灯测试；检索相关测试；全量 API pytest。

## P0 pgvector 维度配置补充上下文

生成时间：2026-05-20 14:12:45 +08:00

### 1. 相似实现与现有模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：`_should_use_pgvector_candidates` 当前硬编码 `len(query_embedding) != 4` 时回退。
  - 可复用：复用上一轮 `_positive_int_env` 环境变量正整数读取 helper。
  - 需注意：硬编码 4 会阻碍后续索引维度迁移后的无代码调参。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/embedding_client.py`
  - 模式：`LocalEmbeddingClient` 的 `_stable_embedding` 当前生成 4 维向量。
  - 可复用：默认维度继续保持 4，确保本地 fallback 与现有测试一致。
  - 需注意：真实 embedding provider 维度通常不同，不能直接假定永远 4。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/alembic/versions/20260520_0001_add_pgvector_retrieval_index.py`
  - 模式：当前 PostgreSQL generated column 是 `embedding_vector vector(4)`。
  - 可复用：新增配置默认值必须与该 migration 保持一致。
  - 需注意：`STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS` 必须代表数据库索引列维度，而不是任意 provider 输出维度。

### 2. 新增配置契约

- `STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS`：默认 `4`。
- 非法、空值和非正值回退默认 `4`。
- 只有 `len(query_embedding) == configured_dimensions` 且 dialect 为 PostgreSQL 时启用 pgvector 候选排序。

### 3. 风险与验证

- 风险：如果配置维度与数据库 `embedding_vector` 列维度不一致，在线查询仍可能失败。
- 风险：本轮不修改 migration，不会自动创建其他维度的向量列。
- 验证：fake PostgreSQL session + monkeypatch env 红灯测试；检索相关测试；全量 API pytest。

## P0 Workbench chunk_count 聚合补充上下文

生成时间：2026-05-20 14:30:32 +08:00

### 1. 相似实现与现有模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
  - 模式：`list_retrieval_sources` 使用 `selectinload(RetrievalSource.chunks)`，适合普通资料源详情读取。
  - 可复用：保留普通列表行为，不破坏依赖 `source.chunks` 的调用方。
  - 需注意：Workbench sources 只需要 `chunk_count`，不需要加载 chunk content、keywords、embedding。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py` 的 `_load_latest_refresh_runs_by_source_id`
  - 模式：先批量收集 source ids，再用聚合/子查询批量取最新 refresh run。
  - 可复用：新增 `_load_chunk_counts_by_source_id` 采用同样的批量 helper 形态。
  - 需注意：避免按 source 逐个 count 造成 N+1。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_workbench_api.py`
  - 模式：已有 `before_cursor_execute` 监听统计 SELECT 数量，保护 Workbench N+1 优化。
  - 可复用：新增 SQL 捕获测试，断言 Workbench sources 不再 SELECT `retrieval_chunks.content` 或 `retrieval_chunks.embedding`。
  - 需注意：保留 `chunk_count` 返回正确性。
- **实现4**: SQLAlchemy 2.0 官方文档（Context7 `/websites/sqlalchemy_en_20`）
  - 模式：`func.count()` 可生成 SQL COUNT 聚合；`Session.execute(select(...))` 可执行 select 并返回 rows。
  - 可复用：`select(RetrievalChunk.source_id, func.count(RetrievalChunk.id)).group_by(RetrievalChunk.source_id)`。

### 2. 本轮接口契约

- 不改变 `GET /api/retrieval/workbench/sources` 响应 schema。
- 不改变普通 `list_retrieval_sources`，避免影响需要 chunks 的路径。
- Workbench sources 路径改为三类批量查询：source 本体、latest refresh runs、chunk counts。

### 3. 风险与验证

- 风险：如果误用 `source.chunk_count` 会触发 relationship 加载；应优先使用聚合 count override。
- 风险：查询数量仍需控制在 3 次以内。
- 验证：SQL 捕获红灯测试、Workbench/retrieval 相关测试、全量 API pytest。

## P6 Redis 缓存与 pgvector 在线验证上下文

生成时间：2026-05-20 14:45:00 +08:00

### 1. Redis 接入模式分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docker-compose.yml`
  - 模式：已声明 `redis:7-alpine`，端口 `6379:6379`，但应用代码此前未使用 Redis。
  - 可复用：默认连接 `redis://127.0.0.1:6379/0`。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/service.py`
  - 模式：`resolve_provider` 每次读取 provider 列表并筛选 capability；`create_provider_config` 是明确写入点。
  - 可复用：缓存 `ProviderResolutionRead.model_dump()`，写入后删除 provider resolve 缓存。
- **实现3**: Context7 Redis-py 文档
  - 模式：`Redis.from_url` 可从 URL 创建客户端；`set(..., ex=ttl)` 可设置过期；`get` 读取字符串；`scan_iter` 可按 pattern 安全删除。
  - 可复用：实现 JSON 缓存 helper，Redis 异常回退 no-op。

### 2. pgvector 在线验证边界

- docker-compose postgres 使用 `pgvector/pgvector:pg16`，端口 `55432:5432`。
- 目标验证：Alembic online `upgrade head`、`vector` extension、`retrieval_chunks.embedding_vector`、HNSW index。
- 若 Docker、端口或既有 volume 导致失败，记录具体错误和补偿步骤。
