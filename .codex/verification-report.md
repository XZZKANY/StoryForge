# 性能优化方案 A 验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 优化 P1 关键词去重、P3 数据库连接池配置、P4 Workbench source 列表 N+1 查询。
- **范围**: 仅修改后端检索 service、数据库 session 配置和相关 pytest；不实施 pgvector、Redis 或 Studio 前端并行化。
- **交付物**: 代码、测试、上下文摘要、操作日志、本验证报告。
- **审查要点**: API 契约不变、查询数量下降、配置可调、本地测试可重复。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/db/session.py`: 新增连接池配置构建逻辑。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 优化 `_keywords` 去重与 Workbench 最新 refresh run 批量查询。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_db_session.py`: 新增连接池配置测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增关键词去重结构测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_workbench_api.py`: 新增 N+1 查询数量回归测试。

## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_db_session.py tests/test_retrieval_embedding.py::test_keywords_preserve_order_without_duplicate_candidates tests/test_retrieval_workbench_api.py::test_list_retrieval_workbench_sources_batches_latest_refresh_runs -q
```

结果：`5 failed`。失败原因覆盖 `_build_engine_options` 缺失、`_keywords` 未使用 set、Workbench SELECT 数量 `5 > 3`。

### 绿灯验证

```powershell
python -m pytest tests/test_db_session.py tests/test_retrieval_embedding.py::test_keywords_preserve_order_without_duplicate_candidates tests/test_retrieval_workbench_api.py::test_list_retrieval_workbench_sources_batches_latest_refresh_runs -q
```

结果：`5 passed in 0.15s`。

### 相关测试

```powershell
python -m pytest tests/test_db_session.py tests/test_retrieval_embedding.py tests/test_retrieval_workbench_api.py tests/test_retrieval_index.py -q
```

结果：`12 passed in 0.45s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`111 passed in 7.52s`。

## 4. 依赖与风险评估

- 本地 Python 初始缺少 pytest；已按 `apps/api/pyproject.toml` 依赖列表安装后完成验证。
- `python -m pip install -e .` 因 setuptools 发现 `app` 与 `alembic` 多顶层包失败；该问题不属于本轮代码改动，但已记录为环境补偿项。
- `_keywords` 测试含源码结构断言，用于锁定性能复杂度目标；后续若改为其他 O(1) 去重结构，应同步调整测试。
- 连接池默认值适合本地/小型部署起点，生产环境应通过 `STORYFORGE_DB_POOL_SIZE`、`STORYFORGE_DB_MAX_OVERFLOW`、`STORYFORGE_DB_POOL_PRE_PING` 调优。

## 5. 评分

- **代码质量**: 92/100
  - 小范围修改，职责边界清晰，未改变 API 契约。
- **测试覆盖**: 91/100
  - 覆盖红灯/绿灯、配置边界、查询数量和全量 API 回归。
- **规范遵循**: 94/100
  - 使用 sequential-thinking、shrimp-task-manager、Context7、desktop-commander、本地 pytest；文档和注释为简体中文。
- **技术维度评分**: 92/100
- **战略维度评分**: 92/100
- **综合评分**: 92/100

## 6. 审查结论

建议：通过。

理由：本轮方案 A 达成 P1、P3、P4 的低风险优化目标，所有验证均已在本地执行，且未扩大到 Redis、pgvector 或前端链路等未批准范围。

## 7. 后续建议

- 下一轮可实施 P0 轻量版：检索候选裁剪、向量计算批处理或数据库侧向量索引设计。
- Studio 串行瀑布应单独设计，因为后续请求存在真实依赖，不能简单全量并行。
- Redis 缓存应先定义失效策略和测试夹具，再接入热点读取。


# P0 轻量版检索评分热路径验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 优化 `search_retrieval` 内部 Python 评分热路径，降低关键词 membership 与向量相似度计算成本。
- **范围**: 仅修改 `apps/api/app/domains/retrieval/service.py` 私有函数和检索测试。
- **交付物**: 私有函数优化、红绿灯测试、操作日志与验证报告。
- **审查要点**: 不改变 API 契约，不新增依赖，不实施数据库迁移。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: `_score_chunk` 使用 `chunk_keywords` 集合；`_cosine_similarity` 改为单循环累积。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增评分热路径结构与行为测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。

## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_score_chunk_uses_keyword_set_for_overlap tests/test_retrieval_embedding.py::test_cosine_similarity_uses_single_pass_without_slice_allocations -q
```

结果：`2 failed`。失败原因覆盖 `_score_chunk` 未构造关键词集合、`_cosine_similarity` 仍存在切片分配。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_score_chunk_uses_keyword_set_for_overlap tests/test_retrieval_embedding.py::test_cosine_similarity_uses_single_pass_without_slice_allocations -q
```

结果：`2 passed in 0.11s`。

### 检索相关测试

```powershell
python -m pytest tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`11 passed in 0.44s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`113 passed in 7.03s`。

## 4. 依赖与风险评估

- 本轮未新增依赖，避免引入 numpy 或 pgvector 迁移造成环境与数据库变更风险。
- 源码结构断言用于锁定性能目标；若后续替换为等价高性能实现，应同步更新测试。
- 本轮只降低 Python 热路径常数成本，不解决 active chunks 全量加载的根因。

## 5. 评分

- **代码质量**: 93/100
- **测试覆盖**: 91/100
- **规范遵循**: 94/100
- **战略匹配**: 88/100
- **综合评分**: 91/100

## 6. 审查结论

建议：通过。

理由：P0 轻量版目标已达成，验证链路完整，本地全量 API 测试通过；但完整 P0 仍需后续单独设计数据库侧候选裁剪或 pgvector 索引方案。

## 7. 后续建议

- 继续 P0 完整版：设计 `pgvector` ORM 字段、索引、迁移和数据库侧向量排序。
- 或先做 P2：Studio SSR 请求链路拆分，降低首屏串行等待。


# P2 Studio SSR 请求并行化验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 将 Studio SSR 页面中无直接依赖的 API 请求并行化，减少串行等待阶段。
- **范围**: 仅修改 Web Studio 页面和 Web 静态契约测试；不修改后端 API、schema、缓存策略或页面交互。
- **交付物**: `StudioTarget` 目标派生、两段 `Promise.all` 并行读取、红绿灯测试、操作日志和验证报告。
- **审查要点**: 保留 `cache: "no-store"`、endpoint 不变、中文契约不破坏、TypeScript 类型安全。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/studio/page.tsx`: Studio SSR 读取链路从 5 段串行改为 3 阶段调度。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/tests/phase1-navigation.test.tsx`: 新增并行化结构契约测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、修复、验证和补救过程。

## 3. 本地验证命令

### 红灯验证

```powershell
pnpm --filter @storyforge/web test
```

结果：`8 passed / 1 failed`。失败原因：缺少 `type StudioTarget`，证明测试命中旧串行结构。

### 绿灯验证

```powershell
pnpm --filter @storyforge/web test
```

结果：`9 passed`，0 failed。

### TypeScript 校验

```powershell
pnpm --filter @storyforge/web exec tsc --noEmit
```

结果：退出码 0。

## 4. 依赖与风险评估

- 本轮使用 Next.js 官方支持的 async Server Component + `Promise.all` 并行数据获取模式。
- 未运行浏览器 DevTools 或真实后端服务，因此不声称已实测 TTFB 或 Network 瀑布；本轮验证范围为静态契约和 TypeScript 类型安全。
- `readStudioRepairPatches` 从依赖 Judge 状态改为依赖 Scene Packet 状态，因为 endpoint 实际只需要 `scene_packet_id`。
- 若后续后端对 Repair endpoint 增加 Judge 审批依赖，需要同步调整并行边界。

## 5. 评分

- **代码质量**: 93/100
- **测试覆盖**: 90/100
- **规范遵循**: 94/100
- **战略匹配**: 93/100
- **综合评分**: 93/100

## 6. 审查结论

建议：通过。

理由：P2 SSR 串行等待已从 5 段顺序请求改为 3 个依赖阶段，测试和类型校验均通过，且未改变 no-store 与 API 契约。

## 7. 后续建议

- 若要量化收益，应启动本地 API 与 Web，通过浏览器或 Playwright 采集 TTFB 和 Network 瀑布图。
- 后续可继续 P5：合并 Scene Packet 组装中的多次 commit，或进入 P0 完整版数据库侧检索裁剪。


# P5 Scene Packet commit 合并验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 减少 `assemble_scene_packet` 热路径中的重复事务提交。
- **范围**: 仅修改 Context Compiler 持久化函数、Scene Packet 集成调用和相关 pytest。
- **交付物**: `persist_compiled_context(commit=True)` 参数、Scene Packet 路径 `commit=False`、commit 次数红绿灯测试。
- **审查要点**: 直接调用默认提交语义不变；Scene Packet 组装只触发一次 commit；持久化快照仍可查询。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/context_compiler/service.py`: 新增 `commit` 关键字参数，支持 `flush` 模式。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/scene_packets/retrieval_bridge.py`: Scene Packet 调用链使用 `persist_compiled_context(..., commit=False)`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_context_compiler_persistence.py`: 新增 commit 次数回归测试。

## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_context_compiler_persistence.py::test_scene_packet_assembly_commits_once_when_persisting_compiled_context -q
```

结果：失败，`assert 2 == 1`。

### 绿灯验证

```powershell
python -m pytest tests/test_context_compiler_persistence.py::test_scene_packet_assembly_commits_once_when_persisting_compiled_context -q
```

结果：`1 passed in 0.13s`。

### 相关测试

```powershell
python -m pytest tests/test_context_compiler_persistence.py tests/test_scene_packet_context_compiler.py tests/test_scene_packet.py tests/test_scene_packet_retrieval_upgrade.py -q
```

结果：`12 passed in 0.57s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`114 passed in 6.53s`。

## 4. 依赖与风险评估

- SQLAlchemy 2.0 文档确认 `Session.flush()` 会发送 pending changes 并分配主键，但不提交事务。
- `persist_compiled_context` 默认 `commit=True`，保持既有直接调用行为。
- Scene Packet 路径 `commit=False` 后不刷新 compiled context record；当前调用链只使用 compiled_context_id 和 packet 字段，不依赖 record 的 server default 字段。
- 本轮验证的是 commit 调用次数，不声称已实测数据库 round-trip 或端到端延迟。

## 5. 评分

- **代码质量**: 94/100
- **测试覆盖**: 93/100
- **规范遵循**: 95/100
- **战略匹配**: 90/100
- **综合评分**: 93/100

## 6. 审查结论

建议：通过。

理由：Scene Packet 组装路径 commit 调用数由 2 降为 1，直接持久化语义保持不变，相关测试和全量 API 测试均通过。

## 7. 后续建议

- 若继续性能优化，可进入 P0 完整版：数据库侧候选裁剪与 pgvector 索引设计。
- 或执行 P6：Redis/本地缓存层设计，但需先定义失效策略和测试夹具。


# P6 Provider runtime lru_cache 验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 缓存 provider runtime 环境配置解析，降低 provider fallback、embedding、reranker 热路径重复读取环境变量的成本。
- **范围**: 仅修改 provider runtime 配置函数和 provider 相关测试；不接入 Redis，不缓存数据库 provider 查询。
- **交付物**: `load_runtime_provider_config` 的 `lru_cache(maxsize=3)`、缓存行为测试、测试隔离 fixture、操作日志和验证报告。
- **审查要点**: 函数签名不变、调用方无感、环境变量测试隔离、全量 API 回归通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/runtime_config.py`: 为 `load_runtime_provider_config` 增加 `@lru_cache(maxsize=3)`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_provider_gateway.py`: 新增缓存命中测试和 autouse 缓存清理 fixture。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、污染补救和验证结果。

## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_provider_gateway.py::test_runtime_provider_config_uses_lru_cache -q
```

结果：失败，`AttributeError: 'function' object has no attribute 'cache_clear'`。

### 绿灯验证

```powershell
python -m pytest tests/test_provider_gateway.py::test_runtime_provider_config_uses_lru_cache -q
```

结果：`1 passed in 0.02s`。

### 相关测试

```powershell
python -m pytest tests/test_provider_gateway.py tests/test_retrieval_embedding.py tests/test_retrieval_workbench_api.py -q
```

首次结果：失败，provider 用例间缓存污染。

修正后结果：`15 passed in 0.49s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`115 passed in 6.22s`。

## 4. 依赖与风险评估

- 本轮使用标准库 `functools.lru_cache`，不新增依赖。
- `maxsize=3` 覆盖 `llm`、`embedding`、`reranker` 三类 capability。
- 环境变量变化后同一进程不会自动刷新，需要调用 `load_runtime_provider_config.cache_clear()`。
- 本轮不是 Redis 分布式缓存，也不缓存数据库 provider 配置。

## 5. 评分

- **代码质量**: 92/100
- **测试覆盖**: 92/100
- **规范遵循**: 95/100
- **战略匹配**: 86/100
- **综合评分**: 91/100

## 6. 审查结论

建议：通过。

理由：Provider runtime 环境配置已具备进程内缓存，测试覆盖缓存命中、显式清理和全量回归；范围控制清晰，未引入未设计失效策略的 Redis。

## 7. 后续建议

- 若继续 P6 完整版，应先设计 Redis key、TTL、失效触发点和测试替身。
- 若追求最大检索收益，应进入 P0 完整版：数据库侧候选裁剪与 pgvector 索引设计。


# P0 DB 候选裁剪轻量版验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 在无 embedding_client 的关键词检索路径中，用数据库侧 ILIKE 预过滤减少 Python `_score_chunk` 候选数量。
- **范围**: 仅修改 retrieval service 与检索测试；不做 pgvector 迁移，不改变 API 契约。
- **交付物**: SQLAlchemy 候选预过滤 helper、空结果回退、红绿灯调用数测试、操作日志和验证报告。
- **审查要点**: embedding 语义路径不裁剪；关键词路径减少评分候选；检索相关与全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增 `_load_search_candidates`、`_apply_keyword_candidate_filter`、`_keyword_prefilter_terms`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增 `_score_chunk` 调用数测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。

## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_keyword_search_prefilters_candidates_before_python_scoring -q
```

结果：失败，`assert 5 < 5`，证明旧实现评分全量 chunks。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_keyword_search_prefilters_candidates_before_python_scoring -q
```

结果：`1 passed in 0.12s`。

### 检索相关测试

```powershell
python -m pytest tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`12 passed in 0.46s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`116 passed in 6.79s`。

## 4. 依赖与风险评估

- 本轮使用 SQLAlchemy `or_` 与 `ilike`，不新增依赖。
- 仅无 embedding_client 的关键词路径启用预过滤；embedding_client 路径保持全量候选，保护语义召回。
- 若 SQL 预过滤无候选，会回退原全量查询，降低漏召回风险。
- 本轮不是 pgvector 完整方案，也没有创建数据库索引或迁移。

## 5. 评分

- **代码质量**: 91/100
- **测试覆盖**: 91/100
- **规范遵循**: 95/100
- **战略匹配**: 89/100
- **综合评分**: 91/100

## 6. 审查结论

建议：通过。

理由：关键词检索路径已具备数据库侧候选裁剪，减少 Python 评分候选数量；语义路径和既有检索行为通过回归测试保护。

## 7. 后续建议

- P0 完整版仍应设计 pgvector 字段、索引、迁移和 PostgreSQL 实测验证。
- 可继续对搜索端点增加可观测计数日志，记录候选裁剪前后数量。


# P0 候选裁剪摘要验证报告

生成时间：2026-05-20 00:00:00

## 1. 需求字段完整性

- **目标**: 为检索候选裁剪增加内部结构化摘要，便于后续接入日志或 metrics。
- **范围**: 仅修改 retrieval service 私有 helper 和检索测试；不改变 API schema，不新增数据库查询。
- **交付物**: `SearchCandidateLoad` dataclass、候选加载摘要字段、红绿灯测试、操作日志和验证报告。
- **审查要点**: 不引入额外 round-trip；search_retrieval 公开行为不变；检索相关和全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增 `SearchCandidateLoad`，`_load_search_candidates` 返回结构化摘要。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增候选摘要测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。

## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_search_candidate_loader_reports_prefilter_metadata -q
```

结果：失败，`AttributeError: 'list' object has no attribute 'prefilter_enabled'`。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_search_candidate_loader_reports_prefilter_metadata -q
```

结果：`1 passed in 0.11s`。

### 检索相关测试

```powershell
python -m pytest tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`13 passed in 0.48s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`117 passed in 6.53s`。

## 4. 依赖与风险评估

- 本轮使用标准库 dataclass，不新增依赖。
- 不执行额外 count query，因此不会为了观测点增加数据库 round-trip。
- 当前摘要仍是内部结构，尚未接入日志或 HTTP 响应。
- 若后续需要外部可观测性，应单独设计日志字段和采样策略。

## 5. 评分

- **代码质量**: 90/100
- **测试覆盖**: 90/100
- **规范遵循**: 95/100
- **战略匹配**: 84/100
- **综合评分**: 90/100

## 6. 审查结论

建议：通过。

理由：候选裁剪现在具备内部可观测摘要，便于后续 pgvector 或索引优化时对比候选规模；本轮不改变公开契约且全量 API 测试通过。

## 7. 后续建议

- 下一步如继续 P0，应实现真实 PostgreSQL/pgvector 方案设计与迁移验证。
- 也可把 `SearchCandidateLoad` 摘要接入结构化日志，但需先定义日志采样与输出格式。

# P0 pgvector 前置迁移验证报告

生成时间：2026-05-20 10:43:11 +08:00

## 1. 需求字段完整性

- **目标**: 为 P0 完整版数据库侧向量检索准备 PostgreSQL/pgvector 迁移能力。
- **范围**: 仅新增 Alembic raw SQL migration 与静态测试；不修改 ORM JSON 字段、不切换 search_retrieval 查询路径。
- **交付物**: pgvector migration、迁移静态契约测试、上下文摘要、操作日志和本验证报告。
- **审查要点**: 保持 SQLite 测试兼容；迁移链路无多 head；离线 SQL 可生成；风险明确留痕。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/alembic/versions/20260520_0001_add_pgvector_retrieval_index.py`: 启用 vector extension，新增 `embedding_vector vector(4)` generated column，创建 HNSW cosine index。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_pgvector_migration.py`: 静态验证 migration 关键 SQL 和 `down_revision`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-performance-optimization.md`: 记录 pgvector 文档依据、迁移边界和风险。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、调试、绿灯和验证过程。
## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_pgvector_migration.py -q
```

结果 1：失败，`AssertionError: 必须新增 pgvector 检索前置迁移。`

结果 2：补充 `down_revision` 契约后失败，缺少 `c0ffee20260520` 链路。

### 绿灯验证

```powershell
python -m pytest tests/test_pgvector_migration.py -q
```

结果：`1 passed in 0.02s`。

### Alembic 离线 SQL

```powershell
python -m alembic upgrade head --sql
```

结果：退出码 0；输出包含 `CREATE EXTENSION IF NOT EXISTS vector`、`embedding_vector vector(4)`、`USING hnsw` 和 `vector_cosine_ops`。
### 检索相关测试

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`14 passed in 0.45s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`118 passed in 6.53s`。

## 4. 依赖与风险评估

- 本轮不新增 Python 依赖，避免 pgvector ORM 类型影响 SQLite 单测。
- `embedding_vector` 是 PostgreSQL generated column，应用仍写入 JSON `embedding`。
- `vector(4)` 对齐当前 `LocalEmbeddingClient` 的 4 维稳定向量；真实 embedding provider 维度切换前必须补维度配置和迁移策略。
- `python -m alembic current` 在线检查 30 秒无输出并被终止，说明本地 PostgreSQL 在线状态未完成验证；本轮只声明离线 SQL 与 pytest 通过。
- 本迁移是 P0 完整版前置，不代表检索路径已经使用数据库向量排序。
## 5. 评分

- **代码质量**: 91/100
- **测试覆盖**: 90/100
- **规范遵循**: 95/100
- **战略匹配**: 88/100
- **风险评估**: 88/100
- **综合评分**: 91/100

## 6. 审查结论

建议：通过。

理由：本轮以最小侵入方式为 pgvector 检索建立可审查 migration 和索引列，修复了 Alembic 多 head 风险，并通过静态测试、离线 SQL 生成、检索相关测试与全量 API 测试。限制是尚未在线升级 PostgreSQL，也尚未把搜索路径切换为数据库侧向量排序。

## 7. 后续建议

- 启动本地 PostgreSQL/pgvector 后执行在线 `alembic upgrade head` 与 downgrade 回滚验证。
- 为真实 embedding provider 增加维度配置，避免 `vector(4)` 与真实模型维度不一致。
- 下一轮再实现 PostgreSQL dialect 下的向量排序查询，并保留 SQLite/Python fallback。

# P0 pgvector 候选排序验证报告

生成时间：2026-05-20 10:56:33 +08:00

## 1. 需求字段完整性

- **目标**: 在 PostgreSQL/pgvector 条件下为语义检索添加数据库侧候选排序，减少 embedding 路径全量加载。
- **范围**: 仅修改 retrieval service 私有候选加载和检索测试；不修改公开 API、schema 或 ORM 字段。
- **交付物**: pgvector 候选排序 helper、`SearchCandidateLoad` 观测字段、红绿灯测试、操作日志和本报告。
- **审查要点**: PostgreSQL + 4 维向量启用；SQLite/无 embedding/维度不匹配回退；全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增 pgvector 候选排序分支、向量字面量、候选上限和 dialect 检测。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增 fake PostgreSQL session 测试，验证 SQL、params 和 limit。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-performance-optimization.md`: 记录 SQLAlchemy 文档依据和风险。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。
## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_pgvector_candidate_loader_orders_postgresql_embeddings_with_bound_vector -q
```

结果：失败，`TypeError: _load_search_candidates() got an unexpected keyword argument 'query_embedding'`。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_pgvector_candidate_loader_orders_postgresql_embeddings_with_bound_vector -q
```

结果：`1 passed in 0.07s`。

### 检索相关测试

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`15 passed in 0.45s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`119 passed in 6.61s`。
## 4. 依赖与风险评估

- 不新增依赖，使用 SQLAlchemy `text()`、`order_by(None)` 与 `Session.scalars(statement, params)`。
- pgvector 分支仅在 PostgreSQL dialect 且 query embedding 为 4 维时启用。
- 候选上限为 `max(limit * 8, 32)`，属于召回与性能折中，后续应基于真实数据调参。
- 本轮未连接真实 PostgreSQL，因此不声明查询计划、索引命中或在线延迟收益。
- 真实 provider embedding 维度若不是 4，会回退到原全量语义候选路径。

## 5. 评分

- **代码质量**: 90/100
- **测试覆盖**: 90/100
- **规范遵循**: 95/100
- **战略匹配**: 91/100
- **风险评估**: 86/100
- **综合评分**: 90/100

## 6. 审查结论

建议：通过。

理由：pgvector 候选排序已接入语义检索候选加载路径，并通过红绿灯测试、检索相关测试和全量 API 测试；实现保持 SQLite fallback 与公开契约不变。主要限制是缺少真实 PostgreSQL 在线执行和查询计划验证。

## 7. 后续建议

- 启动 PostgreSQL/pgvector 后执行在线 search smoke test 和 `EXPLAIN`，确认 HNSW 索引命中。
- 将 `SearchCandidateLoad.pgvector_enabled` 接入结构化日志，便于观测线上启用率。
- 增加 embedding 维度配置，支持真实 provider 向量维度迁移。

# P0 候选加载摘要日志验证报告

生成时间：2026-05-20 11:07:46 +08:00

## 1. 需求字段完整性

- **目标**: 为 retrieval 搜索候选加载增加结构化观测日志，便于后续对比关键词预过滤和 pgvector 候选排序启用效果。
- **范围**: 仅新增 retrieval service 内部日志和 caplog 测试；不改 API/schema/数据库结构。
- **交付物**: `_log_search_candidate_load`、候选摘要日志、红绿灯测试、上下文摘要、操作日志和本报告。
- **审查要点**: 不记录 query 原文或 chunk 内容；不增加数据库查询；检索相关和全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增 logger 和候选摘要日志 helper。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增 caplog 测试，验证字段和敏感内容边界。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-performance-optimization.md`: 记录日志字段契约和风险。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。
## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_search_retrieval_logs_candidate_load_summary_without_query_text -q
```

结果：失败，`assert 0 == 1`，未捕获到 `检索候选加载摘要` 日志。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_search_retrieval_logs_candidate_load_summary_without_query_text -q
```

结果：`1 passed in 0.11s`。

### 检索相关测试

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`16 passed in 0.48s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`120 passed in 6.44s`。
## 4. 依赖与风险评估

- 使用 Python 标准库 `logging`，不新增依赖。
- 每次 `search_retrieval` 输出一次摘要日志，不增加数据库 round-trip。
- 日志字段仅包含候选数量、过滤状态、fallback 状态和 pgvector 状态，不包含查询原文、chunk 内容、标题或摘要。
- 当前使用 `info` 级别，后续如日志量过大可调整为 debug 或采样。
- 项目暂无统一日志配置，本轮只保证 logging record 可被本地和运行环境采集。

## 5. 评分

- **代码质量**: 91/100
- **测试覆盖**: 90/100
- **规范遵循**: 95/100
- **战略匹配**: 88/100
- **风险评估**: 88/100
- **综合评分**: 90/100

## 6. 审查结论

建议：通过。

理由：候选加载摘要现在具备可观测输出，便于后续确认关键词预过滤、fallback 和 pgvector 分支是否真实启用；红绿灯测试和全量 API 测试均通过，且敏感内容边界已被测试保护。

## 7. 后续建议

- 后续可增加 pgvector_enabled=True 的 fake PostgreSQL 日志测试。
- 在线 PostgreSQL 验证时结合日志字段与 `EXPLAIN` 对比候选数量和索引命中。
- 如日志量过大，将摘要日志调整为 debug 或增加采样开关。

# P0 pgvector 候选上限配置验证报告

生成时间：2026-05-20 11:19:20 +08:00

## 1. 需求字段完整性

- **目标**: 让 pgvector 候选加载上限可通过环境变量调优，同时保持默认行为不变。
- **范围**: 仅修改 retrieval service 私有候选上限 helper 和检索测试；不改 API/schema/迁移。
- **交付物**: 候选上限环境变量、非法值回退 helper、红绿灯测试、上下文摘要、操作日志和本报告。
- **审查要点**: 默认仍为 `max(limit * 8, 32)`；配置可覆盖；非法、空值和非正值回退默认；全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增默认常量、`_positive_int_env`、环境变量驱动的 `_vector_candidate_limit`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增环境变量覆盖和非法值回退测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-performance-optimization.md`: 记录配置契约和风险。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。
## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_vector_candidate_limit_uses_environment_overrides tests/test_retrieval_embedding.py::test_vector_candidate_limit_falls_back_for_invalid_environment -q
```

结果：`1 failed, 1 passed`；失败显示设置 multiplier=3、min=10 后 `_vector_candidate_limit(2)` 仍返回 32。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_vector_candidate_limit_uses_environment_overrides tests/test_retrieval_embedding.py::test_vector_candidate_limit_falls_back_for_invalid_environment -q
```

结果：`2 passed in 0.02s`。

### 检索相关测试

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`18 passed in 0.49s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`122 passed in 6.66s`。
## 4. 依赖与风险评估

- 新增配置项：`STORYFORGE_RETRIEVAL_VECTOR_CANDIDATE_MULTIPLIER`，默认 `8`。
- 新增配置项：`STORYFORGE_RETRIEVAL_VECTOR_MIN_CANDIDATES`，默认 `32`。
- 不新增依赖，不新增数据库查询。
- 非法、空值和非正值均回退默认，避免错误配置导致检索异常。
- 不缓存环境变量，便于测试和运行时调参；线上需谨慎变更，避免候选规模漂移。
- 候选上限过小可能影响召回，过大可能增加 Python scoring 成本，后续应结合日志和在线延迟调参。

## 5. 评分

- **代码质量**: 92/100
- **测试覆盖**: 92/100
- **规范遵循**: 95/100
- **战略匹配**: 89/100
- **风险评估**: 90/100
- **综合评分**: 92/100

## 6. 审查结论

建议：通过。

理由：pgvector 候选规模现在可在不改代码的情况下调优，默认行为保持不变；非法配置回退和全量 API 回归均已验证。

## 7. 后续建议

- 在线 PostgreSQL 验证时结合候选摘要日志调节 multiplier/min candidates。
- 若运行环境要求稳定配置，可后续改为启动期加载并记录配置快照。

# P0 pgvector 维度配置验证报告

生成时间：2026-05-20 14:12:45 +08:00

## 1. 需求字段完整性

- **目标**: 将 pgvector 启用条件中的硬编码 4 维改为环境变量配置，默认仍为 4。
- **范围**: 仅修改 retrieval service 私有 helper 和检索测试；不修改 API、schema 或 Alembic migration。
- **交付物**: `STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS` 配置读取、非法值回退、红绿灯测试、上下文摘要、操作日志和本报告。
- **审查要点**: 默认与当前 `vector(4)` 保持一致；非法配置回退默认；配置维度必须匹配数据库列维度；全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增 `DEFAULT_PGVECTOR_DIMENSIONS` 和 `_pgvector_dimensions`，pgvector 启用判断改用配置维度。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`: 新增维度覆盖和非法值回退测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-performance-optimization.md`: 记录配置契约和数据库列维度风险。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。
## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_pgvector_candidate_dimension_uses_environment_override tests/test_retrieval_embedding.py::test_pgvector_candidate_dimension_falls_back_for_invalid_environment -q
```

结果：`1 failed, 1 passed`；失败显示设置 `STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS=3` 后 3 维 query embedding 仍未启用 pgvector。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_embedding.py::test_pgvector_candidate_dimension_uses_environment_override tests/test_retrieval_embedding.py::test_pgvector_candidate_dimension_falls_back_for_invalid_environment -q
```

结果：`2 passed in 0.02s`。

### 检索相关测试

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`20 passed in 0.50s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`124 passed in 6.21s`。
## 4. 依赖与风险评估

- 新增配置项：`STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS`，默认 `4`。
- 非法、空值和非正值通过 `_positive_int_env` 回退默认。
- 该配置必须与数据库 `retrieval_chunks.embedding_vector` 列维度一致；当前 migration 仍是 `vector(4)`。
- 本轮不修改 migration，也不创建其他维度索引。
- 不缓存环境变量，便于本地测试和运行时切换，但线上应以部署配置为准。

## 5. 评分

- **代码质量**: 92/100
- **测试覆盖**: 92/100
- **规范遵循**: 95/100
- **战略匹配**: 89/100
- **风险评估**: 90/100
- **综合评分**: 92/100

## 6. 审查结论

建议：通过。

理由：pgvector 维度启用条件现在可配置，默认仍与本地 embedding 和当前 migration 保持一致；非法值回退和全量 API 回归均已验证。

## 7. 后续建议

- 如需真实 provider 维度，先新增对应维度 migration，再调整 `STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS`。
- 可将 pgvector 维度、候选上限等环境变量补充到本地启动/运维文档。

# P0 Workbench chunk_count 聚合验证报告

生成时间：2026-05-20 14:30:32 +08:00

## 1. 需求字段完整性

- **目标**: 优化 Retrieval Workbench source 列表，避免为展示 `chunk_count` 加载完整 chunk 大字段。
- **范围**: 仅修改 retrieval service 的 Workbench source 列表内部查询和 Workbench 测试；不改变公开 API schema。
- **交付物**: Workbench 专用 source 查询、chunk_count 聚合 helper、SQL 捕获红绿灯测试、上下文摘要、操作日志和本报告。
- **审查要点**: 不影响普通 `list_retrieval_sources`；Workbench 不再 SELECT `retrieval_chunks.content` 或 `embedding`；chunk_count 正确；全量 API 测试通过。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`: 新增 `_list_retrieval_sources_for_workbench`、`_load_chunk_counts_by_source_id`，`_build_workbench_source` 支持 chunk_count override。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_workbench_api.py`: 新增 SQL 捕获测试，验证 Workbench sources 不加载 chunk payload。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-performance-optimization.md`: 记录设计依据和风险。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`: 记录红灯、实现和验证结果。
## 3. 本地验证命令

### 红灯验证

```powershell
python -m pytest tests/test_retrieval_workbench_api.py::test_list_retrieval_workbench_sources_uses_chunk_count_aggregate_without_loading_chunk_payloads -q
```

结果：失败，SQL 捕获到 `retrieval_chunks.content` / `retrieval_chunks.embedding` 大字段查询。

### 绿灯验证

```powershell
python -m pytest tests/test_retrieval_workbench_api.py::test_list_retrieval_workbench_sources_uses_chunk_count_aggregate_without_loading_chunk_payloads -q
```

结果：`1 passed in 0.12s`。

### Workbench 测试

```powershell
python -m pytest tests/test_retrieval_workbench_api.py -q
```

结果：`5 passed in 0.24s`。

### 检索相关测试

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_retrieval_index.py tests/test_retrieval_workbench_api.py -q
```

结果：`21 passed in 0.55s`。

### 全量 API 测试

```powershell
python -m pytest -q
```

结果：`125 passed in 6.27s`。
## 4. 依赖与风险评估

- 不新增依赖，使用 SQLAlchemy `func.count` 和 `Session.execute(select(...))`。
- Workbench sources 查询数量仍控制在 source 本体、latest refresh run、chunk count 三类查询内。
- 普通 `list_retrieval_sources` 保持 selectinload chunks，不影响需要 chunks 的路径。
- 聚合 count 返回缺失 source 时默认 0，适配无 chunk 资料源。
- 后续若 Workbench 需要 chunk 预览，应新增专用轻量预览接口，而不是恢复完整 chunk payload 加载。

## 5. 评分

- **代码质量**: 92/100
- **测试覆盖**: 93/100
- **规范遵循**: 95/100
- **战略匹配**: 92/100
- **风险评估**: 91/100
- **综合评分**: 93/100

## 6. 审查结论

建议：通过。

理由：Workbench source 列表现在通过聚合查询获取 chunk_count，避免加载 chunk content/embedding 大字段；红绿灯测试、Workbench 测试、检索相关测试和全量 API 测试均通过。

## 7. 后续建议

- 可继续检查其他列表页是否存在为了计数加载完整 relationship 的问题。
- 若需要展示 chunk 预览，应设计分页/摘要字段，避免一次性加载 embedding JSON。


# Redis 缓存与 pgvector 在线验证收口报告

生成时间：2026-05-20 15:45

## 1. 需求字段完整性

- **目标**：完成剩余 Redis Provider 缓存接入，并执行 PostgreSQL/pgvector 在线验证。
- **范围**：Provider Gateway resolve/create 热路径、Redis 缓存 helper、pgvector Docker Compose 在线升级与 SQL 检查。
- **交付物**：Redis cache helper、Provider Gateway 缓存读写/失效、Provider 测试、在线验证执行记录、补偿验证记录。
- **审查要点**：缓存可命中、缓存可失效、Redis 不可用时降级；pgvector 在线环境可用时能执行 Alembic 与 SQL 检查。

## 2. 交付物映射

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/common/redis_cache.py`：新增 Redis JSON 缓存 helper。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/provider_gateway/service.py`：Provider resolve 接入缓存，provider 创建后失效相关缓存。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_provider_gateway.py`：新增 Redis 缓存命中和失效测试。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`：记录 Redis 绿灯和 pgvector 在线验证环境阻塞证据。

## 3. 本地验证命令与结果

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
python -m pytest tests/test_provider_gateway.py::test_provider_resolution_uses_redis_cache_and_invalidates_on_provider_create -q
```

结果：`1 passed in 0.11s`。

```powershell
python -m pytest tests/test_provider_gateway.py -q
```

结果：`6 passed in 28.52s`。

```powershell
python -m pytest -q
```

结果：`126 passed in 47.17s`。


## 4. pgvector 在线验证结果

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis
```

结果：失败，Docker Desktop Linux Engine 未运行或不可访问：`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`。

```powershell
python - <<'PY'
import psycopg
psycopg.connect('postgresql://storyforge:storyforge@127.0.0.1:55432/storyforge', connect_timeout=3)
PY
```

结果：失败，`ConnectionTimeout: connection timeout expired`。

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
python -m alembic upgrade head
```

结果：数据库不可达，进程长时间无输出后手动终止；未能执行在线 SQL 检查。

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py -q
```

结果：`15 passed in 0.31s`，静态 migration 契约和 pgvector 检索分支测试通过。

## 5. 依赖与风险评估

- Redis 缓存对主流程是非强依赖：Redis 读写异常会降级为未命中，不阻断 Provider resolve。
- Provider 创建会失效 global 和 workspace 相关缓存，避免新增配置后继续返回旧解析结果。
- pgvector 在线验证受本机 Docker daemon 和 PostgreSQL 运行状态阻塞；当前没有可用 `127.0.0.1:55432` 数据库。
- 当前只能确认 pgvector 迁移与检索分支的静态/单元测试通过，不能确认真实 PostgreSQL 已创建 extension、generated vector 列和 HNSW 索引。

## 6. 评分

- **代码质量**：92/100
- **测试覆盖**：91/100
- **规范遵循**：93/100
- **战略匹配**：88/100
- **风险评估**：90/100
- **综合评分**：90/100

## 7. 审查结论

建议：需讨论。

理由：Redis 缓存接入已通过本地测试和全量 API 回归；pgvector 在线验证已按流程执行，但当前机器 Docker daemon 不可用且数据库端口不可达，因此在线 SQL 检查未成功。已记录失败原因和补偿计划；启动 Docker Desktop 或提供可访问 PostgreSQL/pgvector 后可立即重跑在线验证。


# Docker pgvector 在线验证补跑通过报告

生成时间：2026-05-20 16:10

## 1. 触发原因

用户启动 Docker Desktop 后，重新执行标准 Docker Compose PostgreSQL/Redis 在线验证。此前阻塞原因为 Docker daemon 不可用；本次已进入真实 compose 数据库验证路径。

## 2. 发现与修复

- `docker compose up -d postgres redis` 成功启动 `storyforge-postgres` 与 `storyforge-redis`。
- `docker compose ps` 显示 PostgreSQL 与 Redis 均为 `healthy`。
- 首次 `python -m alembic upgrade head` 暴露 Alembic 历史链缺口：pgvector migration 执行时 `retrieval_chunks` 尚不存在。
- 已补充 pgvector migration 前置建表契约：`retrieval_sources`、`retrieval_chunks`、`retrieval_refresh_runs` 和相关索引均使用 `CREATE TABLE/INDEX IF NOT EXISTS`，避免新库在线升级失败。
- Redis 运行态暴露 Provider 测试缓存污染，已在测试 autouse fixture 中清理 `storyforge:provider-resolution:*`。

## 3. 在线验证证据

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
docker compose up -d postgres redis
docker compose ps
```

结果：`storyforge-postgres` 与 `storyforge-redis` 均为 `healthy`。

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
python -m alembic upgrade head
```

结果：exit code 0，升级至 `20260520_0001`。

SQL 检查结果：

- `pg_extension`：存在 `vector`。
- `retrieval_chunks.embedding_vector`：`udt_name = vector`，`is_generated = ALWAYS`，表达式为 `((embedding)::text)::vector(4)`。
- `pg_indexes`：存在 `ix_retrieval_chunks_embedding_vector_hnsw`，定义为 `USING hnsw (embedding_vector vector_cosine_ops)`。
- `alembic_version`：`20260520_0001`。

## 4. 回归验证

```powershell
python -m pytest tests/test_pgvector_migration.py -q
```

结果：`1 passed in 0.02s`。

```powershell
python -m pytest tests/test_pgvector_migration.py tests/test_retrieval_embedding.py tests/test_provider_gateway.py -q
```

结果：`21 passed in 0.48s`。

```powershell
python -m pytest -q
```

结果：`126 passed in 6.60s`。

## 5. 最终结论

建议：通过。

综合评分：94/100。

理由：Redis 缓存接入、Docker Compose PostgreSQL/Redis 启动、Alembic 在线迁移、pgvector extension/列/索引 SQL 验证、相关测试和全量 API 回归均已通过。当前性能优化计划中的剩余两项已完成。

# 项目总结推送验证报告

生成时间：2026-05-20 17:09:56 +08:00

## 1. 验证目标

确认本轮新增的 `PROJECT_SUMMARY.md` 和 `.codex/context-summary-项目总结推送.md` 是否存在、内容是否为简体中文、是否覆盖项目定位、当前阶段、交付物、验证方式、风险和下一步。

## 2. 本地验证命令

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
Test-Path PROJECT_SUMMARY.md
Test-Path .codex/context-summary-项目总结推送.md
```

结果：两个文件均存在，返回 `True`。

```powershell
git diff --check -- PROJECT_SUMMARY.md .codex/context-summary-项目总结推送.md .codex/operations-log.md .codex/verification-report.md
```

结果：针对本轮新增文档未报告文本错误；仅出现 `LF will be replaced by CRLF` 的工作区提示。

```powershell
Select-String -Path PROJECT_SUMMARY.md,'.codex/context-summary-项目总结推送.md' -Pattern '项目定位','当前阶段','本版主要交付','本地验证入口','关键风险点' -SimpleMatch
```

结果：命中项目定位、当前阶段、主要交付、本地验证入口和关键风险点字段。

```powershell
git diff --name-only -- PROJECT_SUMMARY.md .codex/context-summary-项目总结推送.md .codex/operations-log.md .codex/verification-report.md
```

结果：当前仅显示 `.codex/operations-log.md` 与 `.codex/verification-report.md` 的本轮追加变更；`PROJECT_SUMMARY.md` 与上下文摘要已生成但未被 `git diff` 列出，属于未跟踪文件。

## 3. 结果与结论

- 本轮新增文档已创建成功，且内容符合简体中文要求。
- 文档覆盖了项目定位、当前阶段、交付物、验证方式、风险和下一步。
- 本轮验证未发现新增文档的文本错误。
- 现有仓库中部分既有代码存在尾部空行提示，但不影响本轮文档交付。

## 4. 评分

- **需求符合度**：94/100
- **技术质量**：92/100
- **集成一致性**：93/100
- **可验证性**：91/100
- **综合评分**：92/100

## 5. 审查结论

建议：通过。

理由：项目总结文件与上下文摘要均已落地，验证命令能复现，且结果覆盖了交付要求；仅有既有仓库 CRLF 提示，不构成本轮文档问题。

# Phase 5/6 收口验证报告

生成时间：2026-05-20 17:20:00 +08:00

## 1. 验证目标

确认 Phase 5 与 Phase 6 已按当前批准边界完成文档、审计和验证收口：已实现能力保持可追溯，未联通能力继续标为后续功能待办，当前主线明确进入 Phase 7 发布治理。

## 2. 交付物映射

- 上下文摘要：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-ph5-ph6-closure.md`
- 状态入口：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/README.md`
- 任务池：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md`
- 当前 Phase 事实入口：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/current-phase.md`
- 交接摘要：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/PROJECT_SUMMARY.md`
- 操作记录：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`
## 3. 本地验证命令与结果

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
Test-Path .codex/context-summary-ph5-ph6-closure.md
Test-Path README.md
Test-Path TODO.md
Test-Path .codex/current-phase.md
Test-Path PROJECT_SUMMARY.md
```

结果：五项均返回 `True`。

```powershell
Select-String -Path README.md,TODO.md,.codex/current-phase.md,PROJECT_SUMMARY.md,.codex/context-summary-ph5-ph6-closure.md -Pattern '当前边界已收口','当前批准边界已收口','后续功能待办','Phase 7' -SimpleMatch
```

结果：README、TODO、current-phase、PROJECT_SUMMARY 和上下文摘要均命中收口与后续待办关键字。
```powershell
git status --short --branch
git diff --check -- README.md TODO.md .codex/current-phase.md PROJECT_SUMMARY.md .codex/context-summary-ph5-ph6-closure.md .codex/operations-log.md
```

结果：`master...origin/master` 无 ahead/behind；本轮只有文档与 `.codex` 审计文件变更。`git diff --check` 未报告空白错误，仅提示 LF/CRLF 工作区转换。

```powershell
pnpm test
```

结果：通过。Web 9 项中文契约测试通过，共享包配置检查通过，API compileall 通过，Workflow compileall 通过。

## 4. 审查清单

- 需求字段完整性：通过，目标、范围、交付物、验证命令和审查要点已记录。
- 原始意图覆盖：通过，Phase 5/6 均已按“当前边界收口 + 后续待办保留”处理。
- 交付物映射：通过，代码未变更，文档、上下文摘要、操作日志和验证报告均已落地。
- 依赖与风险评估：通过，未实现的真表 adapter/client、批准回写、失败恢复、独立证据跳转、Runs 页面读取和 Artifacts/Evaluations 真实数据读取均保留为后续功能待办。
- 审查结论留痕：通过，见本报告时间戳与评分。

## 5. 技术维度评分

- **代码质量**：94/100，本轮不新增运行时代码，只做事实校准，低回归风险。
- **测试覆盖**：91/100，已运行文档存在性、关键字一致性、diff check 和 `pnpm test`；未额外运行 e2e，因本轮未改功能代码。
- **规范遵循**：95/100，遵循简体中文、`.codex` 留痕、本地验证和不自动提交约束。

## 6. 战略维度评分

- **需求匹配**：95/100，Phase 5/6 均完成当前边界收口。
- **架构一致**：94/100，继续以 `apps/api`、`apps/web`、`apps/workflow`、`docs`、`.codex` 的既有边界为事实源。
- **风险评估**：93/100，没有虚假关闭未实现功能，后续待办保持显式。
## 7. 综合评分与结论

- **综合评分**：94/100
- **建议**：通过

结论：Phase 5/6 已按当前批准边界完成收口。当前主线应继续保持 Phase 7 发布治理，不再扩 Phase 5 运行时能力或 Phase 6 工作台数据源；后续若要实现真表 adapter/client、批准回写、失败恢复、证据跳转或 Artifacts/Evaluations 真实读取，需要作为新功能重新立项和验证。

# Phase 7 环境与 Alembic 在线验证收口报告

生成时间：2026-05-20 18:50:00 +08:00

## 1. 验证目标

确认 Phase 7 发布治理中 Docker 基础服务和 Alembic 在线迁移记录不再停留在过期状态；将当前本机真实验证结果同步到 `TODO.md`、`docs/operations/alembic-validation.md` 与 `.codex/operations-log.md`。

## 2. 交付物映射

- 上下文摘要：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-ph7.md`
- 任务池更新：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md`
- Alembic 验证记录：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/alembic-validation.md`
- 操作日志：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`
- 本验证报告：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/verification-report.md`
## 3. 本地验证命令与结果

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm verify
```

结果：首次因 MinIO 未运行失败；执行 `docker compose up -d minio` 后复跑通过，Node.js、pnpm、Python 3.12.10、Docker、必需路径、PostgreSQL、Redis、MinIO 均通过。

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic upgrade head
uv run alembic current
uv run alembic current --check-heads
```

结果：通过。`uv run alembic current` 与 `uv run alembic current --check-heads` 均输出 `20260520_0001 (head)`。

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm run test:api
pnpm run test:workflow
git diff --check -- TODO.md docs/operations/alembic-validation.md .codex/context-summary-ph7.md .codex/operations-log.md
```

结果：API compileall 通过，Workflow compileall 通过，`git diff --check` 未报告空白错误，仅有仓库既有 LF/CRLF 提示。
## 4. 审查清单

- 需求字段完整性：通过，目标、范围、交付物、验证命令和风险均已记录。
- 原始意图覆盖：通过，本轮只处理 Phase 7 发布治理问题，不新增产品功能。
- 交付物映射：通过，TODO、运维文档、操作日志和验证报告均已更新。
- 依赖与风险评估：通过，Docker/PostgreSQL/Redis/MinIO 状态和 Alembic head 均有本地证据。
- 审查结论留痕：通过，见本报告时间戳与评分。

## 5. 风险记录

- 本轮在线迁移基于当前本机 Docker Desktop 与既有 PostgreSQL 数据卷；它证明当前本机数据库可升级并处于最新 head，但不等价于已在全新空库上执行清库重建验证。
- 若后续需要证明全新空库路径，应先清理或更换 PostgreSQL 数据卷，再执行 `docker compose up -d postgres redis minio`、`pnpm verify`、`uv run alembic upgrade head`、`uv run alembic current --check-heads`。
- 本轮未运行 `pnpm e2e`，因为未改 OpenAPI 或运行时代码；已运行与本轮治理问题直接相关的环境、迁移和 compileall 验证。

## 6. 评分

- **代码质量**：94/100，本轮不改运行时代码，文档校准范围清晰。
- **测试覆盖**：92/100，覆盖 Docker 基础服务、Alembic 在线升级、当前版本 head 检查、API/Workflow 语法验证和文本 diff 检查。
- **规范遵循**：95/100，遵循简体中文、本地验证、`.codex` 留痕、不自动提交和 Phase 7 不扩产品功能约束。
- **技术维度评分**：94/100
- **战略维度评分**：94/100
- **综合评分**：94/100

## 7. 审查结论

建议：通过。

理由：Phase 7 本轮最小治理问题已经闭环：MinIO 已启动，`pnpm verify` 通过，Alembic 当前 head `20260520_0001` 的在线升级与 `--check-heads` 均通过，过期文档状态已同步修正。当前仍保持不自动提交。

# Phase 7 发布门禁推进验证报告

生成时间：2026-05-20 19:25:00 +08:00

## 1. 验证目标

执行 Phase 7 发布治理推进计划：证明干净数据库迁移路径可复现，压缩审计恢复入口，并复跑发布前本地门禁后提交推送。

## 2. 交付物映射

- 计划文档：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/superpowers/plans/2026-05-20-phase7-release-governance.md`
- Alembic 记录：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/alembic-validation.md`
- 当前事实入口：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/current-phase.md`
- 任务池：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md`
- 操作日志：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`

## 3. 本地验证命令与结果

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run alembic heads
uv run alembic current --check-heads
```

结果：通过，均指向 `20260520_0001 (head)`。

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
# 创建 storyforge_phase7_clean_verify 后设置 DATABASE_URL 指向临时库
cd apps/api
uv run alembic upgrade head
uv run alembic current --check-heads
```

结果：通过。临时空库从 `71dfabf6badf` 依次升级到 `20260520_0001`；验证后已删除临时数据库。
```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm verify
pnpm openapi
pnpm test
pnpm e2e
git diff --check
```

结果：全部通过或无错误。

- `pnpm verify`：Node.js、pnpm、Python 3.12.10、Docker、PostgreSQL、Redis、MinIO 和必需路径均通过。
- `pnpm openapi`：使用 `uv run python` 生成 OpenAPI 契约；未产生 `packages/shared/src/contracts/storyforge.openapi.json` diff。
- `pnpm test`：Web 9 项中文契约测试通过，共享包配置检查通过，API compileall 通过，Workflow compileall 通过。
- `pnpm e2e`：14 项 Node 契约测试通过；当前环境 FastAPI HTTP pytest 自动切换到 compileall + Phase 1/2/3/4 服务层补偿验收，API 7 项、Workflow 5 项 pytest 通过。
- `git diff --check`：未报告空白错误，仅有既有 LF/CRLF 工作区提示。

## 4. 审查清单

- 需求字段完整性：通过，目标、范围、交付物、验证命令和风险均已记录。
- 原始意图覆盖：通过，完成干净数据库验证、审计入口压缩、发布门禁复跑和推送准备。
- 交付物映射：通过，计划文档、运维文档、TODO、current-phase、operations-log 和 verification-report 均已更新。
- 依赖与风险评估：通过，临时数据库验证不影响主库；FastAPI HTTP pytest 环境限制已记录为补偿验收。
- 审查结论留痕：通过，见本报告评分。

## 5. 评分

- **代码质量**：95/100，本轮不改运行时代码，治理文件职责清晰。
- **测试覆盖**：96/100，覆盖 Docker、OpenAPI、Web/API/Workflow、E2E、Alembic head 和干净库升级路径。
- **规范遵循**：95/100，遵循简体中文、本地验证、`.codex` 留痕和不扩 Phase 5/6 范围约束。
- **技术维度评分**：95/100
- **战略维度评分**：96/100
- **综合评分**：95/100

## 6. 审查结论

建议：通过。

理由：Phase 7 发布门禁验证已闭环，干净临时库可升级到 `20260520_0001 (head)`，完整本地门禁通过，且未新增产品功能或扩大 Phase 5/6 数据源范围。
# 验证报告：Studio 批准回写与失败恢复摘要

生成时间：2026-05-20 19:35:00

## 审查清单
- 需求字段完整性：已覆盖目标、范围、交付物和审查要点。
- 原始意图覆盖：新增只读摘要 API 和页面展示；未实现真实按钮执行流；未写回章节。
- 交付物映射：后端 schema/service/router、API pytest、Studio 页面展示均已完成。
- 依赖与风险：依赖 ScenePacket、RepairPatch、JobRun；前端恢复摘要依赖 `job_run_id`，无值时显示中文不可用说明。
- 审查结论：通过。

## 技术维度评分
- 代码质量：92/100，沿用现有 Studio 分层和命名风格。
- 测试覆盖：90/100，API 覆盖可用、不可用和失败恢复路径。
- 规范遵循：94/100，限定文件内修改，中文文案，无写回副作用。

## 战略维度评分
- 需求匹配：94/100，满足两个摘要 API 与页面状态展示要求。
- 架构一致：92/100，继续使用只读 service 和 FastAPI router 模式。
- 风险评估：88/100，未运行前端类型检查，但用户要求的相关 API pytest 已通过。

## 综合评分
score: 92

## 建议
通过。

## 本地验证结果
- 命令：`python -m pytest apps/api/tests/test_studio_book_list_api.py`
- 结果：16 passed。

## 2026-05-20 四项剩余风险收口验证报告

### 审查结论

- 技术维度评分：93/100。实现沿用既有 FastAPI router/service/schema 与 Next SSR 页面级读取模式，未新增全量 client 或微服务。
- 战略维度评分：94/100。四项风险均从“待办”推进到可验证的只读摘要交付，同时保留执行流未实现边界。
- 综合评分：93/100。
- 建议：通过。

### 需求字段完整性

- 目标：Runs 真实读取、Studio 批准/恢复摘要、Artifacts/Evaluations 真实读取、连续工作流与治理压缩。
- 范围：仅做模块化单体内的单点读取和只读摘要，不做写回按钮、失败续跑、制品下载、趋势图或详情页。
- 交付物：Web 页面、Studio API schema/service/router、API/Web 测试、OpenAPI 契约、计划文档、上下文摘要、Phase/TODO/架构文档和审计日志。
- 审查要点：真实端点、失败态、registry 状态、未实现边界、发布门禁。

### 本地验证结果

```powershell
cd D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api
uv run pytest tests/test_model_runs.py -q                      # 5 passed
uv run pytest tests/test_studio_book_list_api.py -q            # 16 passed
uv run pytest tests/test_artifacts.py tests/test_evaluations.py -q # 2 passed
uv run alembic current --check-heads                           # 20260520_0001 (head)

cd D:/StoryForge/1-renovel-ai-ai-rag-tavern
pnpm --filter @storyforge/web test                             # 9 passed
pnpm --filter @storyforge/web exec tsc --noEmit                # 通过
pnpm verify                                                    # StoryForge 本地验证通过
pnpm openapi                                                   # 已生成 OpenAPI 契约
pnpm test                                                      # Web/shared/API/workflow 通过
pnpm e2e                                                       # 14 项契约测试、API 补偿验证 7 passed、workflow 5 passed

git diff --check                                               # 通过，仅 CRLF 提示
```

### OpenAPI diff 来源确认

- `packages/shared/src/contracts/storyforge.openapi.json` 的新增 diff 来源于本轮新增的 `GET /api/studio/approval-summary`、`GET /api/studio/recovery-summary` 及其 `StudioApproval*`、`StudioRecoverySummaryRead` schema。
- 该 diff 与 `apps/api/app/domains/studio/router.py`、`schemas.py` 的新增端点和响应模型一致，不属于无来源契约漂移。

### 风险与未实现边界

- Runs 当前默认读取 `job_run_id=1`，干净库无数据时页面应展示可重试错误摘要。
- Studio 批准/恢复当前只展示资格摘要，不执行批准写回或失败续跑。
- Artifacts/Evaluations 当前只展示列表摘要；制品下载、指标趋势图、报告详情页和失败样例详情仍未实现。
- `pnpm e2e` 内部仍记录当前环境对 FastAPI HTTP pytest 不稳定，已由独立 API 定向 pytest 和 compileall 补偿验证。

summary: '四项剩余风险已按最小摘要读取边界完成，验证链通过，执行流与详情型能力保留为后续待办。'
```Scoring
score: 93
```
