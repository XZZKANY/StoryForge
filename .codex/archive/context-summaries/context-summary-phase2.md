## 项目上下文摘要（Phase 2）

生成时间：2026-05-15 00:00:00 +08:00

### 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/assets/service.py`
  - 模式：服务层负责领域校验、版本复制和事务提交，路由层不直接操作谱系。
  - 可复用：`lineage_key`、`version`、`list_assets` 最新版本查询、`update_asset` 复制上一版本。
  - 需注意：跨版本能力必须保持不可覆盖历史，新增 Phase 2 记忆也要保留稳定谱系键。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/scene_packets/service.py`
  - 模式：先读取资产、连续性和证据，再组装固定槽位并返回预算统计。
  - 可复用：`EvidenceLinkRead` 输出、固定槽位结构、轻量 token 预算估算。
  - 需注意：Phase 2 世界观中心和风格包只能进入明确槽位，不能把检索片段当真相源。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/judge/service.py`
  - 模式：确定性规则生成结构化问题单，问题单包含 span、证据、修复模式和替换文本。
  - 可复用：`DetectedIssue`、`create_judge_issues`、结构化 payload。
  - 需注意：批量精修必须复用结构化 Judge，不引入不可重复的真实 LLM 行为。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/jobs/models.py`
  - 模式：`JobRun` 保存长任务类型、状态、进度、错误和关联对象。
  - 可复用：批量精修和质量看板应以 `JobRun.progress` 作为可恢复状态来源。
- **实现5**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/tests/phase1-navigation.test.tsx`
  - 模式：Node 原生测试读取源码，验证中文文案、导航和组件契约。
  - 可复用：Phase 2 前端页面继续用静态契约测试保障中文入口和核心展示。

### 2. 项目约定

- **命名约定**：Python 文件、函数和字段使用 snake_case；ORM/Pydantic 类使用 PascalCase；前端组件使用 PascalCase；路由目录使用语义化短横线或小写目录。
- **文件组织**：后端领域代码放在 `apps/api/app/domains/<domain>/`；测试放在 `apps/api/tests/`；前端页面放在 `apps/web/app/<route>/page.tsx`；跨阶段契约放在 `tests/e2e/`。
- **导入顺序**：标准库、第三方库、项目内模块分组；测试中先导入 pytest/FastAPI/SQLAlchemy，再导入 `app.*`。
- **代码风格**：服务层抛领域异常，路由层转换 HTTP 响应；文档字符串、错误提示、测试标题和页面文案必须使用简体中文。

### 3. 可复用组件清单

- `apps/api/app/domains/assets/models.py`：`Asset`、`EvidenceLink`，用于资产谱系和证据追溯参考。
- `apps/api/app/domains/continuity/models.py`：`ContinuityRecord`、`ScenePacket`，用于章节连续性和上下文包。
- `apps/api/app/domains/judge/models.py`：`JudgeIssue`、`RepairPatch`，用于质量问题和修复补丁。
- `apps/api/app/domains/jobs/models.py`：`JobRun`，用于批量任务进度、错误和恢复状态。
- `apps/web/scripts/phase1-contract-test.mjs`：前端契约测试执行器，可继续扩展 Phase 2 页面断言。

### 4. 测试策略

- **测试框架**：后端使用 pytest、FastAPI TestClient、SQLAlchemy SQLite 内存库；前端使用 Node `node:test` 与 `node:assert/strict`；根级闭环使用 `pnpm e2e`。
- **测试模式**：先写失败测试，再实现服务、路由和页面；每个 Phase 2 能力必须有局部测试和根级回归命令。
- **参考文件**：`apps/api/tests/test_scene_packet.py`、`apps/api/tests/test_judge_repair.py`、`apps/api/tests/test_approval_writeback.py`、`apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**：正常流程、跨归属隔离、空输入或缺失目标、版本化历史、稳定排序、中文契约和编码扫描。
### 5. 依赖和集成点

- **外部依赖**：FastAPI、Pydantic、SQLAlchemy 2.0、pytest、Next.js、React、TypeScript、Node 原生测试。
- **内部依赖**：Phase 2 系列记忆会被世界观中心、风格包和质量看板复用；批量精修复用 Judge、Repair、JobRun；质量看板聚合 Judge、Repair、JobRun、导出和系列记忆。
- **集成方式**：新增后端领域需在 `apps/api/app/models.py` 注册 ORM，在 `apps/api/app/main.py` 注册 router；前端新增页面需更新首页导航和契约测试。
- **配置来源**：根 `package.json` 提供 `pnpm test`、`pnpm e2e`、`pnpm openapi`；`apps/api/pyproject.toml` 提供 pytest 路径和 Python 依赖。

### 6. 技术选型理由

- **为什么用这个方案**：Phase 1 已形成可验证闭环，Phase 2 延续同一分层可以避免重复造轮子，并让新增能力进入 OpenAPI、pytest 和 e2e 证据链。
- **优势**：本地可重复、模块边界清晰、测试成本低、便于逐项验收。
- **劣势和风险**：系列级聚合和看板可能产生跨表查询成本；批量精修容易扩大状态机范围；前端静态契约不能替代真实交互测试。

### 7. 官方文档来源

- Context7 `/fastapi/fastapi`：确认 APIRouter、include_router、TestClient 和 dependency_overrides 的模块化测试模式。
- Context7 `/websites/sqlalchemy_en_20_orm`：确认 `Mapped`、`mapped_column`、relationship 与 Session commit/refresh 模式。
- Context7 `/vercel/next.js`：确认 App Router `app/<route>/page.tsx` 与 Server Component 页面组织方式。
- 当前会话没有 `github.search_code` 工具，无法执行开源代码搜索；本次以项目内实现和 Context7 官方文档替代，并在操作日志记录限制。
### 8. 关键风险点

- **并发问题**：版本化写入必须读取同谱系最新版本再插入新行；批量任务更新 `JobRun.progress` 时必须保证单次事务内状态一致。
- **边界条件**：跨系列、跨作品、跨场景数据不得互相污染；世界观中心和质量看板必须处理空数据。
- **性能瓶颈**：看板聚合需限制范围并按作品或系列过滤；世界观中心按稳定顺序读取最新版本，避免无界全表扫描。
- **安全考虑**：本项目 AGENTS 要求不把安全设计设为验收条件；本摘要仅记录数据边界和可验证性，不新增认证鉴权设计。

### 9. 上下文充分性检查

- 能说出至少 3 个相似实现路径：是，已列出 assets、scene_packets、judge、jobs、web contract 五处。
- 理解实现模式：是，后端为 ORM 模型、schema、service、router、pytest；前端为 App Router 页面和 node:test 契约。
- 知道可复用组件：是，Asset、EvidenceLink、ContinuityRecord、ScenePacket、JudgeIssue、RepairPatch、JobRun。
- 理解命名和风格：是，snake_case、PascalCase、中文文档字符串和测试标题。
- 知道如何测试：是，pytest/TestClient/SQLite、node:test、pnpm e2e、compileall、编码扫描。
- 确认没有重复造轮子：是，Phase 2 在现有真相源和长任务模型上扩展，不新增平行闭环。
- 理解依赖和集成点：是，新增领域需注册模型、路由、OpenAPI 和本地测试。
