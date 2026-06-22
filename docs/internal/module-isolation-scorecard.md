# StoryForge 模块隔离与评分

生成时间：2026-05-24 15:35:00  
分析范围：`D:/StoryForge/1-renovel-ai-ai-rag-tavern`  
结论用途：把项目从“整体恶心”拆成可定位的模块痛点，方便只处理真正让人难受的部分。

## 评分口径

| 分数段 | 含义                                                         |
| ------ | ------------------------------------------------------------ |
| 90-100 | 模块边界清楚、证据链完整、自动化支撑强，主要是持续维护问题。 |
| 80-89  | 结构可靠，但仍有集成断点、重复成本或局部复杂度。             |
| 70-79  | 能跑且方向正确，但维护体验明显吃力，需要隔离或收敛。         |
| 60-69  | 有可用骨架，但落地不完整、测试或入口断裂明显。               |
| <60    | 需要优先回炉，不建议继续在其上堆功能。                       |

## 总览结论

这个项目不是整体烂，真正容易让人“极度恶心”的区域集中在 **上下文处理 + Scene Packet + Retrieval + Workflow 多节点联动**。数据库骨架、验证脚本、前端诊断入口和产品世界观设定其实搭得比较扎实；但世界观中心这个实现点目前处于“代码存在、入口不通”的半隔离状态。

| 模块       | 分数 | 状态           | 一句话判断                                               |
| ---------- | ---: | -------------- | -------------------------------------------------------- |
| 核心逻辑   |   78 | 可用但最重     | 方向正确，跨模块状态和上下文链路是主要痛点。             |
| 数据库设计 |   86 | 较扎实         | 模型和迁移覆盖面足，少量迁移注释乱码和聚合一致性风险。   |
| 前端界面   |   82 | 稳定展示层     | 入口清楚、边界诚实，但更多是诊断台而非完整产品台。       |
| 自动化脚本 |   88 | 扎实           | 本地验证、E2E、OpenAPI 刷新链路清楚，维护成本可控。      |
| 世界观设定 |   73 | 设定强、实现断 | 文档雄心完整，API 服务有雏形，但路由未接入导致体验断层。 |
| 共享契约   |   80 | 有骨架         | OpenAPI 快照和 TS 类型存在，但手写类型偏薄。             |

## 模块拆分与证据

### 1. 核心逻辑：78/100

**覆盖范围**：API 领域服务、Scene Packet、Context Compiler、Retrieval、Judge/Repair、Workflow 图编排。

**关键证据**：

- `apps/api/app/main.py`：FastAPI 入口注册大量领域 router，包括 artifacts、evaluations、events、batch_refinery、continuity、judge、model_runs、retrieval、scene_packets、studio、series 等。
- `apps/api/app/domains/context_compiler/service.py`：按 priority、score、token budget、injection_position 进行上下文裁剪和排序。
- `apps/api/app/domains/scene_packets/service.py`：组装资产、连续性记录、检索命中，并附着 compiled context。
- `apps/workflow/storyforge_workflow/graph.py`：LangGraph 串联 `book_director`、`chapter_planner`、`scene_beats`、`draft_writer`、`human_approval`。
- `apps/workflow/storyforge_workflow/state.py`：checkpoint 只保存引用字段，避免全文状态膨胀。

**为什么分数不是更高**：

- 上下文编译、检索、Scene Packet、Workflow checkpoint 同时参与“生成前状态”，心智负担很高。
- `apps/api/app/domains/scene_packets/service.py` 一个服务函数同时做章节校验、资产加载、检索补全、证据构造、预算组包、上下文附着和持久化，隔离度还不够。
- Workflow 当前用 `InMemoryWorkflowStore` 和显式 checkpointer，方向对，但 API/数据库/运行态之间仍需要更清晰的适配层。

**隔离建议**：

1. 把“上下文输入候选构造”“预算裁剪”“持久化审计”分成三段契约，避免 Scene Packet 服务继续变胖。
2. 为 Workflow 增加单独的 `runtime adapter` 层，只处理 JobRun、Checkpoint、ModelRun 的读写，不让图节点直接理解 API 领域细节。
3. 把 Context Compiler 的调试输出固定成前端可读协议，减少排障时翻多个模块。

### 2. 数据库设计：86/100

**覆盖范围**：SQLAlchemy 模型、Alembic 迁移、数据库会话、测试替身。

**关键证据**：

- `apps/api/app/models.py`：统一聚合 Book、Chapter、Scene、Asset、ContinuityRecord、ScenePacket、JobRun、JudgeIssue、RepairPatch、SeriesMemory、RetrievalChunk、ModelRun、Artifact、EvaluationRun、CompiledContextRecord 等模型。
- `apps/api/alembic/versions/71dfabf6badf_创建_phase_1_领域模型.py`：初始迁移覆盖 books、chapters、scenes、assets、continuity_records、job_runs、evidence_links、scene_packets、judge_issues、repair_patches 等核心表。
- `apps/api/alembic/versions/c0ffee20260520_add_compiled_contexts.py`：为上下文编译快照补迁移。
- `apps/api/app/db/session.py`：PostgreSQL 默认连接、连接池参数、SQLite 测试替身兼容处理都在同一层封装。

**优点**：

- 数据模型基本按创作资产和审计链路组织，和产品设定一致。
- 迁移存在分阶段增量，说明不是只靠 `Base.metadata.create_all()` 逃生。
- `session.py` 对 SQLite 测试替身做了兼容，测试环境比较友好。

**扣分点**：

- 初始迁移里有一处乱码注释：`Alembic ?? SQLAlchemy ???????? Task 2 ??????`，影响审计观感。
- 模型聚合依赖 `apps/api/app/models.py` 人工维护，后续领域增加时容易漏导入。
- JSON 字段使用多，灵活但会把部分约束推到服务层和测试层。

**隔离建议**：

1. 数据库继续保持“领域表 + JSON 载荷”的务实路线，但给关键 JSON payload 增加 schema 测试。
2. 对 `models.py` 增加模型导入覆盖测试，避免新增领域模型没有进入 Alembic 元数据。
3. 清理迁移乱码注释，保证数据库审计材料干净。

### 3. 前端界面：82/100（历史 Web 评分，已退场）

**当前状态**：本节记录早期 Web 前端评分，2026-06-21 起 `apps/web` 已退场。当前前端事实源转为 `apps/desktop`、Desktop frontend tests 和 Tauri smoke。

**历史覆盖范围**：Next.js App Router 页面、诊断入口、共享组件、API 读取。

**关键证据**：

- `apps/web/app/page.tsx`：首页明确拆分 Studio、Retrieval、Runs 三个主入口，以及 Refinery、Artifacts、Evaluations、Providers 等治理入口。
- `apps/web/lib/api-client.ts`：统一 API base URL、API Key 注入、`cache: "no-store"`、JSON 校验结果封装。
- `apps/web/components/diff-viewer`、`apps/web/components/judge-panel`、`apps/web/components/scene-packet`：组件目录按业务展示块拆分。
- `apps/web/tests/phase1-navigation.test.tsx`：存在页面导航层面的测试。

**优点**：

- 前端很诚实：README 和首页都写明“只展示已验证摘要和边界”，没有把半成品包装成完整工作台。
- API 调用集中在 `api-client.ts`，比各页面散落 `fetch` 好维护。
- 页面入口和后端领域基本对应，定位问题较快。

**扣分点**：

- 当前更像“诊断与验收控制台”，不是完整创作产品界面。
- 路由多但深交互少，后续一旦补表单、diff、审批、上传，组件复杂度会快速上升。
- 前端共享契约仍偏薄，许多响应校验可能散在页面逻辑里。

**隔离建议**：

1. Desktop 继续把“只读诊断”和“可写操作”拆成清晰视图或本地工作流。
2. 将复杂响应 validate 函数下沉到 `packages/shared` 或 Desktop 专用 client/helper，视图只做状态渲染。
3. 对 Agent、编辑器、设置、导出和 API client 维持独立契约测试，避免一个入口坏掉拖垮全局判断。

### 4. 自动化脚本：88/100

**覆盖范围**：本地验证、E2E、OpenAPI 契约刷新、根脚本编排。

**关键证据**：

- `package.json`：定义 `verify`、`test`、`test:desktop`、`test:shared`、`test:api`、`test:workflow`、`e2e`、`openapi`。
- `scripts/verify-local.ps1`：检查 Node.js、pnpm、Python、Docker、关键路径和 postgres/redis/minio 容器。
- `scripts/run-e2e.mjs`：刷新 OpenAPI 契约后执行 Node contract tests，再执行 API pytest 和 workflow pytest。
- `scripts/generate-openapi.ps1`：负责 OpenAPI 产物刷新。

**优点**：

- 自动化不是摆设，已经把 Desktop、shared、API、Workflow、E2E 串起来。
- `run-e2e.mjs` 会先刷新 OpenAPI，再跑契约，避免拿陈旧快照自欺欺人。
- 本地验证脚本明确检查 Docker 容器，失败原因可读。

**扣分点**：

- `scripts/run-e2e.mjs` 混合 OpenAPI 刷新、Node 测试、API pytest、Workflow pytest，脚本职责偏重。
- PowerShell 与 Node 脚本并存，Windows 友好，但跨平台体验需要额外维护。
- 当前验证脚本依赖环境中已装工具，缺工具时只能报告，不能自动补齐。

**隔离建议**：

1. 保持根命令不变，内部把 `run-e2e.mjs` 拆成可复用函数或子脚本：OpenAPI、契约、API、Workflow 四段。
2. 在 `.codex/verification-report.md` 中持续记录每次验证的命令和失败补偿，不要只写“通过”。
3. 不新增第二套验证入口，避免门禁口径分裂。

### 5. 世界观设定：73/100

**覆盖范围**：产品设定文档、资产中心、世界观中心 API、系列记忆。

**关键证据**：

- `docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md`：明确提出“资产驱动工作流”“世界状态、文风状态、剧情状态、评审历史和版本谱系共享”。
- `docs/architecture/phase5-context-memory-architecture.md`：明确上下文编译、结构化长效记忆、时间线演化、Agent 提案仲裁、LangGraph 引用型状态。
- `apps/api/app/domains/worldbuilding/service.py`：聚合 Series、SeriesMemory、Asset、ContinuityRecord，输出角色、地点、组织、世界规则、未回收伏笔、跨书约束、章节约束。
- `apps/api/app/domains/worldbuilding/router.py`：定义 `/api/worldbuilding/center` 读取接口。
- `apps/api/tests/test_worldbuilding_center.py`：构造了世界观上下文，但当前断言 `response.status_code == 404`。

**优点**：

- 设定层很强，目标不是“Prompt 堆料”，而是显式资产和可恢复工作流。
- 世界观服务本身职责清楚：只读聚合，不直接写入复杂状态。
- schema 把 series、asset item、series memory 分开，前端可消费性不错。

**扣分点**：

- `worldbuilding.router` 没有在 `apps/api/app/main.py` 注册，导致服务存在但入口不可达。
- 测试目前断言 404，说明该能力更像被故意隔离或尚未发布，而不是已完成模块。
- 世界观设定文档很完整，实际实现覆盖还只是聚合中心的一小段，落差明显。

**隔离建议**：

1. 明确世界观中心当前状态：如果是未发布模块，就把 router/test 标成实验区；如果要上线，就注册 router 并把测试改成 200 与字段断言。
2. 把“世界观设定文档”与“世界观中心 API”分开追踪，避免文档雄心掩盖实现断点。
3. 将世界观写入、冲突仲裁、只读聚合拆成三个模块，不要让一个 worldbuilding 服务吃下全部野心。

### 6. 共享契约：80/100

**覆盖范围**：共享 TS 类型、OpenAPI 快照、前后端契约。

**关键证据**：

- `packages/shared/src/index.ts`：导出 `ApiErrorResponse`、`ProviderResolution`、`JobRunSummary` 等共享类型。
- `packages/shared/src/contracts/storyforge.openapi.json`：作为 OpenAPI 契约快照存在。
- `scripts/run-e2e.mjs`：E2E 前刷新 OpenAPI 快照，降低契约陈旧风险。

**判断**：

共享契约方向是对的，但手写 TS 类型覆盖面偏小；真正的契约重心仍在 OpenAPI 快照和测试。这个模块不恶心，但还没有完全承担“前后端唯一事实源”的职责。

**隔离建议**：

1. 不要随手在页面里新增临时类型，优先沉到 `packages/shared/src`。
2. 对核心响应类型建立“OpenAPI → shared 类型”的生成或校验流程。
3. 保持 OpenAPI diff 必须解释的发布规则。

## 最恶心模块定位

### 第一名：上下文处理 / Scene Packet / Retrieval 交界面

**原因**：

- 涉及 `apps/api/app/domains/context_compiler/service.py`、`apps/api/app/domains/scene_packets/service.py`、`apps/api/app/domains/retrieval`、`apps/workflow/storyforge_workflow/state.py`。
- 同时处理 token 预算、优先级、检索命中、证据链接、状态引用、持久化审计。
- 任何一个字段错，都可能表现成“生成质量差”“证据缺失”“状态恢复失败”“前端读不到摘要”，排查路径很长。

**建议处理方式**：先不扩功能，先切接口。把它当成一个独立“上下文装配子系统”，用固定输入输出和黄金样例测试包住。

### 第二名：世界观中心落地断层

**原因**：

- 文档设定强，服务代码也有，但 router 没进 `main.py`。
- 测试断言 404，说明当前行为是“不可用”而非“可用但有 bug”。
- 这类断层最容易让人产生厌恶感：看起来做了，实际入口没有。

**建议处理方式**：二选一，不要暧昧：

1. 标成实验模块：保留 service/schema，router 不注册，测试继续证明未开放。
2. 标成上线模块：注册 router，测试改为 200，并让前端新增只读入口。

## 相对扎实模块

- **数据库骨架**：模型和迁移覆盖主链路，`session.py` 对测试替身友好。
- **自动化脚本**：根命令清楚，E2E 不是纯前端假跑，会进入 API 与 Workflow 验证。
- **前端入口层**：页面没有假装完成全流程，而是明确展示已验证入口和边界。
- **引用型状态设计**：`checkpoint_reference_state()` 明确避免全文进入 LangGraph checkpoint，这是正确的复杂度隔离。

## 后续隔离优先级

| 优先级 | 模块                               | 动作                               | 目标                           |
| ------ | ---------------------------------- | ---------------------------------- | ------------------------------ |
| P0     | Context / Scene Packet / Retrieval | 固化输入输出协议，增加黄金样例测试 | 降低核心链路排障成本           |
| P1     | Worldbuilding                      | 明确实验或上线状态                 | 消除“有代码但不可用”的心理噪声 |
| P1     | Workflow runtime adapter           | 隔离图节点与 API 持久化            | 让多 Agent 编排更可测          |
| P2     | Shared contracts                   | 扩大共享类型或生成契约             | 减少前端页面临时类型           |
| P2     | E2E 脚本                           | 内部拆段但保留根命令               | 降低脚本维护成本               |

## 最终判断

如果你现在觉得这个项目恶心，不要把情绪平均分摊到整个仓库。真正该隔离出来骂、改、重构的是：

1. **上下文处理链路**：复杂但必要，是第一优先级。
2. **世界观中心落地断层**：不是复杂，而是状态不明确。
3. **Workflow 与 API 运行态桥接**：需要适配层，不要继续让图和业务互相认识太多。

其他部分——数据库、自动化、前端入口、产品设定——不是完美，但已经有可维护骨架，属于可以继续加固而不是推倒重来的区域。
