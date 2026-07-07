# StoryForge 架构评审与后续架构蓝图(2026-07-03)

> 产出方式:ultracode 多 agent 编排——7 个子系统测绘 + 8 个维度评审 + 每条重大发现 2 名对抗核查员(事实核查 + 价值核查)+ 三方案架构竞标(3 架构师 × 3 裁判)+ 综合 + 补全性批评,共 110+ agent、约 460 万 token。
> 证据存档:审计全文 `audit-final.json`、竞标全文 `design-final.json`(会话工作目录,指针见文末)。
> 性质:规划文档,2026-07-03 经用户拍板采纳(§9 四项开放决策已全部裁定;§8 推翻项第 1 项已批准,第 2-5 项随对应波次 PR 落地)。本文件本身未改动任何代码。

---

## 0. 结论摘要

**总体判决:方向已对,地基错位。** 产品在 2026-06-24/06-30 两次拍板后已收敛为「单机 sidecar + 对话式 agent 的 Cursor for Fiction」,但代码地基仍是 web/多租户/自动整书时代的企业级架构:38 个域、45 张表、五容器云栈、四层重叠门禁——而真正的 live 产品面只有 4 条路由族。审计确认 14 条重大发现(2 critical + 12 high,全部经双重对抗核查存活),其中唯一「不动就会炸」的是 **F01:已装机 Alpha 用户的 sqlite 库零迁移机制**。

**不推荐大爆炸重构。** 三方案竞标中,三位裁判(产品速度/迁移安全/长期演化)全票裁定「渐进绞杀」胜出:8 个独立可合并的波次,每波门禁常绿、直接为三大在途优先级(真机 GUI e2e、Q1-Q8 工具化、质量轨重跑)铺路;极简派的机制洞见(发布态护栏、封存判据)与内核派的机制洞见(工具注册单点、WS 契约化)以嫁接形式全部保留。终态诚实:活代码收缩到现状约 60-70%,换取零停摆与全部已验证资产存续。

**需要用户拍板的推翻项 5 个、真开放决策 4 个**,见 §8/§9。

---

## 1. 审计规模与方法

- 测绘:api-core / agent-live / book-pipeline / desktop / contracts-tests-ci / docs-truth / data-infra 七张地图,全部结论要求 `file:line` 亲读证据。
- 评审:架构边界 / 死代码遗留 / agent 循环 / 数据状态 / 前端 / 测试契约 / 交付链 / LLM 质量八个维度,禁止纯机械拆文件类建议(尊重已有拍板)。
- 对抗核查:38 条原始发现去重为 18 条重大 + 20 条 advisory;18 条重大各派 2 名核查员(一名只核代码事实、一名只核「值不值得动手」),**14 条双票存活、4 条被价值票否决降级、0 条事实被推翻**。

## 2. 确认的重大发现(14 条,均双票存活)

### 数据层(最高危)

**F01[critical] 发布态 sqlite 零迁移机制,双 schema 事实源已现漂移实证。**
`db/session.py:54-65` 仅 `create_all`(只建缺失表不 ALTER);`session.py:68-94` 已出现第一例手写 SQL 补偿补丁,与 `alembic/versions/20260703_0001` **同一逻辑双份维护**。24 个 alembic 迁移用户永远不跑。下一次 ORM 加列(Q1-Q8 工具化几乎必然)发版后,存量库缺列 → `OperationalError` → 升级即丢会话史或崩服。
→ 修法:sidecar 起服改跑 `alembic upgrade head`(sqlite batch 模式),老库先备份再 stamp 基线;fixture 升级测试钉死同步。

**F02[critical] 手稿双真相源。** 本地文件是产品真相(`fs_tools.py:29-34`),但 DB 侧 books/chapters/character_bible/story_memory/retrieval 整栈只认 DB 章节;`deep_consistency.py:78` 已被迫绕开 `character_bible_entries` 表重造文件版检索;`judge/consistency.py` 四个检测器(bible/alias/timeline/style)全部以 DB scope 起步,**无法喂本地文件项目**。不先拍板单一手稿真相,Q1-Q8 每个工具都会重演双轨分叉。
→ 修法:正式宣布「手稿真相=本地文件,DB 只做会话/证据/运行记录」;检测器拆「纯函数核心 + scope 适配器」两层;books/chapters 降级为 BookRun 内部缓存。

### 发布形态失守

**F05[high] apps/workflow 定位崩坏。** LangGraph 编排链全 test-only(book_loop/novel_loop 根本不 import langgraph,dispatch 消费函数仅测试调用);API 靠 `workflow_prompt_bridge.py:19-23` 的 `parents[4]` 文件路径 importlib 桥消费 prompts——**PyInstaller 冻结 exe 内该路径不存在,装机产品里 bookrun.start / 导出整条是死路**(bookrun.start 是桌面 agent 可达 intent)。
**F13[high] 发布形态零自动化门禁。** `run_windows.py` + PyInstaller spec 在全部测试中零引用;门禁却在护永不发布的 alembic/postgres 形态。
**F15[high] dev/交付倒挂。** 日常开发是唯一在维护 pg+Redis+MinIO 五容器云栈的场景;测试与交付全是 sqlite;pgvector ANN 只在 pg 生效,检索行为在用户机器上不复现(`retrieval/pgvector.py:47-57` 静默降级关键词召回)。

### live 循环行为缺口(真机 e2e 必撞)

**F09[high] 循环对 pause/stop 免疫。** `loop_runtime.py` 8 轮循环体内无任何 `run.status` 读取;点「停止」只改 DB 字段,后端继续烧最多 8 轮 BYO-key;进程重启后 run 永远停在 running 无人收尸。中断/恢复机制只建在已降级的固定管线上——投资方向与产品优先级倒挂。
**F10[high] 前端 360s 硬超时 vs 后端 8×300s 结构性错配。** 超时即 reject+close(`agent-socket.ts:15-49`),run 照跑照花钱,最终结果静默丢进会话历史;`agent_result` 不落事件表,断线后无法重建终态。作者看到「失败」,实际「成功但看不见」——对证据链红线最直接的体验背叛。
**F11[high] 中文关键词表抢跑双轨。** `intent.py:49-50`「审查/检查/问题/一致性/节奏/结构」任一命中即劫自由文本进固定管线;前端已被迫传显式 intent 绕行(`ChatWindow.tsx:638` 注释自认);「一致性/检查」还会把用户请求劫离循环内 consistency 工具,与 Q1-Q8 路线正面相撞。

### 契约与测试反噬

**F06[high] Agent WS 协议(产品主动脉)完全游离契约体系外。** 两侧手写镜像、零 schema、零 shape 校验;「契约测试」实为 61 处源码字符串断言。
**F07[high] source-evidence 字面子串断言机制反向锁定架构。** 钉死已知死代码(requestRevision)、锁门禁脚本自身文本(门禁测门禁)、每次重构必产标记漂移(PR#63/64 九失败实证)——它制造的全是假行为缺口,与「只接受真实行为缺口驱动」的拍板直接冲突,且正在向前端单测自我复制。
**F12[high] CI 移除后全仓无任何自动化环节跑测试。** pre-push 仅 lint+drift;30477 行 API 测试在合并链路零强制执行;PR#63 九失败正是此后果。
**F14[high] 门禁四层重叠、五处平行实现。** 833 个用例被 verify/test/e2e 跑 2-3 遍;OpenAPI drift 三份独立实现;verify/openapi 脚本 mjs/ps1 双轨——每天都在付的迭代税。
**F18[high] 写回红线零行为测试。** 产品最高红线 100% 由前端链保证(ChatWindow→事件总线→useSuggestionWriteback→tauri fs),恰是测试最薄一层;自制无 DOM runner 的 tauri invoke stub 直接 throw,IPC 行为结构性不可测;「硬闸测试」=断言源码含某句中文。前端源码/测试比 0.21(API 侧 0.81)。

### LLM 通道

**F16[high] 出网通道碎片化 + 依赖倒挂。** 全仓 7 条独立 LLM HTTP 实现;主产品循环寄生在已降级 book_runs 域的私有函数上(`loop_runtime.py:21` import `_call_llm_messages`);judge/story_state 裸 httpx 无重试、不查状态码、硬编码 Bearer(对照 book_generation_llm 有 429 退避 + 双鉴权);story_state 漏迁 resolved_llm_env → sidecar 下 grounding 静默失活。同一把 BYO-key:正文生成能跑、语义评审 100% 失败。

## 3. 被价值票否决的发现(事实成立,但不值得开刀)

- **F03** e2e 白名单全是休眠域——但 `pnpm test` 本就全量跑,e2e 的 pytest 阶段是纯重复子集,真正的修法归入 F14 门禁收敛,不必单独立项。
- **F04** 38 域/45 表超配——死域惰性无害、不阻塞任何在途优先级;「9 个可直删域」清单实证至少错 3 个(如 prompt_packs 被活跃域 model_runs 引用)。修法降级为「先卸载 router 冻结、models 全保留、物理删除按判据后评」。
- **F08** production 环境分支死代码——惰性零伤害,唯一真实症状(起服告警)一行豁免即可消音,不需要 M 级手术。
- **F17** 会话史按 project_path 键控——项目改名只丢左栏列表入口,**数据零丢失**(按 id 检索完好、版本快照在项目目录内随项目走);未来补「认领/归并」接口零成本恢复,推迟不积债。

## 4. Advisory 择要(20 条,未经对抗核查)

行为类:F26 会话切换竞争(run 完成强切回旧会话)/ F27 写盘非原子 + 快照失败照写 / F28 Tauri IPC 全盘任意路径写删、`..` 不解析 / F29 sqlite 并发写零防护(无 WAL/busy_timeout,重复序号事故已发生)/ F36 单补丁守卫只约束单条消息 / F37 版本快照无保留策略、证据链 sqlite 零备份。
结构类:F24 加一个循环工具要跨 3 文件改 6-7 处 / F25 权限系统四轨并存、PermissionGate 真实路径永不生效 / F23 memory.resolve_conflict 假成功命令污染证据链 / F32 BYO-key 成本可观测名存实亡 / F35 跨消息零记忆(每条消息重读文件重烧 token)。
认知修正:**F34 `test_ide_agent_orchestrator.py` 1172 行不是死路护栏**(测的是活行为经 facade,可删的只有 40 行 facade + 1 个 F401 import)——旧记忆在制造认知税。

## 5. 方案竞标与裁决

| 方案 | 主张 | J1 产品速度 | J2 迁移安全 | J3 长期演化 |
|---|---|---:|---:|---:|
| A1 极简单机派 | 38 域→5 域、sqlite 三态同构、删 workflow/shared/docker,压到 AI 一次会话装下 | 6.15 | 6.3 | 7.5 |
| A2 Agent 内核派 | 七原语内核 ≤3k 行 + 一切能力为工具包,加工具=1 文件+1 行 | 6.65 | 6.8 | 6.9 |
| **A3 渐进绞杀派** | **先修门禁、再拆炸弹、每波只绞一条已核实寄生边,8 波独立可合并** | **8.1** | **7.9** | **8.4** |

三裁判理由趋同:**单人 + AI 项目里大重构的头号死因是中途停摆留下两套真相**(本仓已两次为平行实现付费:ide/orchestrator vs runtime、book_generation vs workflow adapter)。A1 败于删除清单与 F04 反驳实证冲突 + 行为修复被压后;A2 败于 kernel 大搬家正是平行实现陷阱的再现窗口。A2 的「BookRun→内核 managed run」被否决(推翻刚拍板决策 + 质量轨重跑前动已验证资产),留作质量轨完成后的开放决策。

## 6. 最终蓝图(A3 底盘 + 双向嫁接)

**目录结构:不做 kernel 大搬迁,原地绞杀 + 清单治理。**
- `app/common/llm_client.py`:唯一 LLM 出网点(自 book_generation_llm 原样下沉,移动不重写)。
- `app/domains/DOMAINS.md`:live / background / frozen 三档清单,AI 会话第一入口;冻结域只卸 router 不删代码。
- alembic 升格为 pg+sqlite 双方言唯一 schema 事实源;create_all 降级为显式回退。
- `agent_runs/tooling.py` 原地升级 ToolSpec 单点注册(自动派生 function schema / 名称映射 / 系统提示词段 / 错误文案)。
- apps/workflow:prompts + skills/audit.py 迁入 api 后,`git tag attic/workflow` 封存 + 物理删除(工作区零 attic 目录,`docs/attic-index.md` 登记恢复入口)。
- packages/shared 保留,双快照:openapi.json(随死域卸载收缩)+ 新增 agent-ws.schema.json;desktop 六层相对路径改包出口。
- `docs/architecture/` 存 A2 四层终态图作北极星(未来真删除/内核化的现成地图,不现在执行)。

**七件事咬合:** 进程模型零改动(单进程 sidecar + BackgroundTasks);数据模型两条铁律(手稿真相=本地文件、schema 事实源=alembic);LLM 单通道 + resolved_llm_env 全覆盖;契约=双快照单命令单实现 + 废除 61 处字符串断言;测试=四层金字塔每层只跑一遍 + 三条门禁(pre-push <3min 快测集 / verify 全量一遍 + sidecar-smoke / e2e 契约-only);可观测=证据链本身(补 usage 记账)+ structlog,Prometheus 不投资不立即删。

**保留的红线(8 条):** 证据链可追溯(并加固:删假成功命令、补 usage、收尸留痕);后端永不直写用户文件、patch 确认写回(从字符串断言换成行为护栏);advisory 语义;bookrun.start 不开放给循环 LLM 自主调用;单机 sidecar + BYO-key 交付形态不变;已验证资产零作废(打包链/headless 实跑证据/Q9 修复);质量轨资产不删一行直到重跑完成;**(新增)密钥只存在 llm-provider.json 与进程内存,永不进 DB/日志/证据链/导出物**。

## 7. 路线图(W0→W7 + E2E-1,已并入补全批评的 8 项修正)

> 每波独立可合并、门禁常绿;W0-W3 绑定三大优先级时间线有天然 deadline。标 ⊕ 的条目来自蓝图补全批评的修正。

**W0[M] 门禁止血 + 发布态首护栏**(动任何删除之前)
sidecar-smoke 上线,⊕分两档:daily 档跑 `run_windows.py`+临时 sqlite(挂 pnpm verify),packaged 档先 pyinstaller build 再对冻结 exe 跑同套 smoke(每波合并前 + 发版前强制,顺手记录冷启动耗时预算);sqlite 补 WAL+busy_timeout;版本快照加保留上限;宣布 schema 冻结(W2 前不合并 ORM 加列,新工具先做纯文件版);pre-push 升级为 verify:fast + 活路径快测集(<3min);同 PR 先补 OpenAPI 结构断言再删 61 处字符串断言与被钉死的死码(requestRevision 链 / ps1 双实现 / 游离 tauri-fs / 2.5G 缓存);verify/test/e2e 去重;删三个假成功命令;.codex 300+ 历史交接摘要归档移出工作区。
Gate:verify 全绿且总时长下降;sidecar-smoke 双档首绿;「重命名一个前端组件」不再触发 e2e 假红;pre-push 实测拦截一次故意注入的失败。

**W1[M] live 循环语义收口**(为真机 e2e 让路)
循环每轮读 run.status,paused/stopped 即收尾落库;起服收尸非终态 run(reason=process_restart);agent_result 关键字段补进 AGENT_RUN_COMPLETED 事件 payload;前端超时改「转后台轮询」;intent.py 关键词表下线,固定管线只认显式 intent;⊕sidecar 版本握手(/health/ready 加 app_version,Tauri 启动探测版本不符即 taskkill 再 spawn;或动态端口 + 端口发现文件),消除覆盖安装后新前端连旧孤儿 exe 的串台;用现有 runner 补「before 漂移拒写回」纯函数级红线测试。
Gate:新增行为测试绿;真机 e2e 清单新增「点停止→事件表无后续 tool_trace」「超时→转后台仍取回结果」「强杀宿主→重启无孤儿且连新 sidecar」;headless 复跑无回归。

**⊕E2E-1[里程碑] 真机 GUI 端到端首轮验收**(W1 与 W2 之间,显式排号防幽灵化)
NSIS 装机(⊕含一台默认 Defender 开启的干净 Windows,把 SmartScreen 拦截从未知变已知;分发说明附 SHA256 与「仍要运行」指引)→ 打开项目 → 对话(工具循环流程树/会话史/欢迎页首条 prompt)→ 审稿 → 修订 → diff 确认 → 写回 → 版本记录;人工清单逐项留证据落 .codex。其结果同时充当 W4 手测冒烟与 W6 WS 重构的回归基线。

**W2[M] sqlite schema 单一事实源**(唯一定时炸弹,须赶在首个带列变更的工具发版前)
起服:检测 alembic_version → ⊕先用 sqlite backup API(VACUUM INTO/Connection.backup,规避 WAL 半截)备份并跑 PRAGMA quick_check(失败即中止迁移),⊕备份文件名带版本号、保留最近 3 份、文档写明恢复步骤 → inspect 逐表比对 → stamp 基线 → upgrade head(batch 模式);create_all 降显式回退 + 告警;fixture 测试「旧版真实安装包库→升级→与 fresh 库逐表比对」;⊕自本波起迁移脚本要求 downgrade 可用,fixture 加 upgrade→downgrade→旧版 ORM 冒烟(私测阶段最常用的止损是发旧包回退);双份补丁收敛 alembic 单份;完成后解除 schema 冻结。24 个 pg 迁移不压扁(止损点)。
Gate:fixture 升级/降级测试绿;人工验证旧版 NSIS 存量库换新 exe 起服且会话史完整。

**W3[M] LLM 单一通道**(切断 live→book_runs 寄生,须在 Q1-Q8 批量诞生前)
`_call_llm/_call_llm_messages`/退避/双鉴权/记账原样搬 `common/llm_client.py`,book_runs re-export 保旧测试零改动 + ruff banned-api 禁新代码走旧路 + 显式拆除条件;loop_runtime/assistant 切公共客户端;judge/story_state 退化为纯 prompt 构建 + 解析,统一 resolved_llm_env(修漏迁),未配置返回 configured=False 落审计;usage 记入 assistant_tool_calls + 留流式回调缝;fake-provider 矩阵(bearer/api-key × 429 × reasoning-leak)断言三路径行为一致;⊕key 脱敏三件套:异常剥离 headers/URL query 再抛、logging filter 对 key 值子串替换、矩阵加断言全部日志与证据 payload 不含 key 子串。
Gate:全量 pytest 绿(零测试改动);矩阵断言一致;headless 复跑证据续期。

**W4[M] 死域冻结隔离**(收缩 AI 上下文噪音面,不删一行质量轨资产)
DOMAINS.md 三档清单(CLAUDE.md 指路为新会话第一入口);main.py 卸载第一批 9 个 frozen router(每个先 grep 全调用面);护栏测试:frozen 路由不在 app.routes + 无新增 live/background→frozen import 边(试引即红);ide 域前端零调用 6 端点一并卸载(先解除 event_logs 假 Workspace 行依赖);openapi 刷新解释收缩 diff;CLAUDE.md §5 改写 + A2 北极星图入 docs/architecture/;一个发版观察期后第二批卸载(workspaces/assets/prompt_packs/evaluations 的 router 面,models 全保留);自本波起「每波合并当天同步改 CLAUDE.md/MEMORY/current-phase.md」制度化。
Gate:OpenAPI 收缩且 drift 绿;桌面全功能冒烟无损;护栏可证伪;回滚成本=一行 include_router。

**W5[M] workflow 吸收归档**(修复装机 exe 内 BookRun/导出死路)
prompts + skills/audit.py 迁入 `app/domains/book_runs/prompts/`,删两个 importlib 路径桥;apps/workflow 整包 tag 封存 + 物理删除,langgraph 依赖树与独立 uv 环境退役;重打 sidecar 验证 prompts 进冻结产物;dev 侧跑 deterministic BookRun 最小闭环确认质量轨资产无损;若 sidecar-smoke 已稳定两个发版:pnpm dev 默认切 sqlite,docker 栈降 `pnpm dev:pg` opt-in。
Gate:⊕packaged 档 smoke 断言装机 exe 内 bookrun.start prompt 装配可达(删除「或人工验证」松口);deterministic 闭环 + Markdown 导出成功;verify/e2e 总时长再降。

**W6[L] WS 契约化 + 工具注册单点 + Q1-Q8 切面样板**(为优先级②定型;排在 E2E-1 之后)——✅ slices 1-3 已合并(2026-07-07,PR #105/#106/#107);slice 4/5 经用户拍板不做
四类 WS 消息建 Pydantic 模型(golden JSON 逐字节等价先绿再切 encode);agent-ws.schema.json 进 shared,并入 pnpm openapi 单命令;api-types 纳入 drift 门禁;前端手写 WS 段换 generated;ToolSpec 单点注册 + 元测试(注册 demo 工具断言 schema/提示词段/证据链全自动可用且 git diff=1 新文件+1 行注册);权限四轨收敛 spec.risk 单点;timeline 或 alias 检测器拆「纯函数核心 + DB 适配器」,新增文件版装配器挂进循环成为第一个 Q 工具(advisory);顺手删 orchestrator facade + F401、docs/internal 封档文档移 archive。
Gate:故意改一个 WS 字段名→前端 typecheck 红;样板 Q 工具 headless 实跑留证据;加第二个 Q 工具改动面实证收敛。
落地记录(2026-07-07):
- **slice 1(PR #105)**:六类出站帧建 Pydantic 单一事实源(`agent_runs/ws_messages.py`),`event_encoders` 只做字段装配,`to_wire()` 不 exclude_none 保全键契约;`test_ws_contract_golden.py` 逐字节金测 14 例。
- **slice 2(PR #106)**:`build_agent_ws_schema()` 从帧派生 JSON Schema → `packages/shared/.../agent-ws.schema.json`,并入 `pnpm openapi` 单命令 + drift 门禁数组;`emit-agent-ws-types.mjs` 确定性投影前端 `generated/agent-ws.ts` + 编译期契约。**Gate 实证达成**:临时改 `run_id` 字段名 → `pnpm openapi` → 前端 typecheck TS2344 红,还原复绿。
- **slice 3(PR #107)**:`tooling.py` 加 `LoopToolSchema` + `AgentRuntimeToolSpec.loop_schema`,`build_loop_tool_schemas/name_map/patch_tool_specs` 单点派生,删 `loop_runtime.py` ~140 行手写镜像;golden byte-identical + 元测试证「加循环工具=加一条带 loop_schema 的 spec」。
- **未做(经用户 2026-07-07 拍板)**:①权限四轨收敛 —— `requires_confirmation` 无法纯从 `risk_level` 派生(`bookrun.pause` 是 long_running 却 confirm=False),权限安全敏感,slice 3 已带 rationale 显式跳过。②slice 4「第一个 Q 工具」**跳过** —— 从 prose 抽结构化边需已 park 的 story_state/typed-delta 方向或启发式,且真·LLM headless gate 跑不了,且与 `project.deep_consistency` 部分重叠,需产品定向。③slice 5「删 orchestrator facade」**保留 facade** —— 该 40 行 compat 非死码(live `runtime.py` noqa-import 作 monkeypatch 靶 + `test_ide_agent_orchestrator.py` 专门测试保护),删它价值低于风险。

**W7[M] 前端行为测试基建**(写回红线换行为护栏;在 Q1-Q8 工具 UI 大量挂 ChatWindow 前落位)
vitest + happy-dom 替换自制 runner(唯一新增 devDependency);三条红线行为测试:①before 漂移拒写(可证伪)②接受补丁→快照→写盘→闭环记录时序 ③会话切换中途 run 完成不污染当前会话(修 F26);顺手写盘原子化(临时文件+rename)与快照失败阻断写回(修 F27);既有 18 个测试文件双跑一个 PR 周期后删 verify-unit.mjs。
Gate:三条行为测试绿且各自可证伪;verify 总时长不升。

## 8. 推翻的已拍板决策

> 第 1 项已于 2026-07-03 获用户批准;第 2-5 项蓝图已采纳,随对应波次(W0/W2/W4/W5)的 PR 评审逐个落地生效,每项独立可回退。

1. **「CI 整体移除」部分推翻(✅ 2026-07-03 已批准)**:pre-push 加 <3min 活路径快测集。理由:决策当时接受的残留风险已实际兑现(PR#63 九假红零拦截)。
2. **「pnpm e2e=真实 HTTP pytest + source-evidence」推翻**:e2e 收敛契约-only,61 处字符串断言废除。理由:「真实 HTTP」实为 TestClient+内存库;字符串断言只产假红还反向钉死死代码。
3. **「API 是业务真相源」修订**为「API 是流程判定与证据真相源,手稿真相是本地项目文件」。理由:给已发生事实补文书(F02)。
4. **「Workflow 负责长任务边界」三 app 架构推翻**:workflow 撤销独立 app 地位、吸收后删除。理由:LangGraph 全 test-only + 路径桥在冻结 exe 内必断(F05)。
5. **sqlite create_all 自建表机制推翻**(保留 sqlite 拍板本身):schema 演进改 alembic 单事实源。理由:F01 双份维护漂移已有实证。
6. (顺延非推翻)dev 默认 docker 五容器 → sidecar-smoke 稳定两个发版后默认切 sqlite,pg 栈降 opt-in。

## 9. 开放决策 —— 已于 2026-07-03 全部拍板

1. **pre-push 变慢换防线:✅ 接受**。pre-push = verify:fast + 活路径快测集(<3min),W0 落地。
2. **死域终局:✅ 彻底删除**。执行路径不变(W4 先卸载冻结 → 两个发版周期观察 → 物理删除),终态由"评估"改为"确定删除";含已验证语义的模块删除前按判据打 `attic/*` tag 留恢复入口,工作区零残留。
3. **BookRun→内核 managed run:✅ 质量轨重跑完成后必须重评**。届时 W1 建好的中断/收尸语义与 W6 的 ToolSpec 机制可直接复用,重评时以 A2 方案存档(design-final.json)为起点。
4. **代码签名证书:✅ 先不买**。E2E-1 靠"干净 Windows 实测 Defender 拦截 + 分发说明附 SHA256 与『更多信息→仍要运行』指引"兜底;若私测用户实际被拦比例不可接受,再回桌重议。

## 10. 主要风险(压缩表)

| 风险 | 缓解 |
|---|---|
| W4 卸载撞隐性消费者(死域清单实证至少错过 3 个引用) | 逐域 grep 全调用面;分两批 + 观察期;models 一律保留;回滚=一行重挂 |
| W2 alembic 在用户老库上失败,砸 Alpha 会话史 | backup API + quick_check + 版本化备份×3;失败回落 create_all + 告警;fixture 用真实旧版库;私测基数小是窗口期 |
| W3 客户端下沉引入行为漂移 | 移动不重写;re-export 全部旧测试零改动继续守护;合并前 headless 对照复跑 |
| W0 删字符串断言出现护栏空窗 | 同 PR 先加结构断言再删;净护栏量只增不减 |
| 渐进变永远渐进 | W0-W3 绑定三大优先级天然 deadline;封存判据 + 复评时点写入 DOMAINS.md;允许体面弃坑 |
| AI agent 按旧记忆/旧文档改错位置 | 每波合并当天同步三份事实源进 gate;DOMAINS.md 第一入口;banned-api 把约定变 lint 硬约束 |
| 诚实的天花板:终态仍保留 domains 平铺 + 2308 行 runtime.py | 接受;北极星图 + 冻结清单为未来真收缩留好地图,冻结工作全部复用 |

## 11. 证据指针

- 审计全文(7 地图 + 14 confirmed + 4 contested + 20 advisory,含全部 verdict 理由):会话目录 `workflows/audit-partial-wrq6bth69.output.json`(第一轮)与 scratchpad `audit-final.json`(最终)。
- 竞标全文(3 方案 + 3 评分卡 + 蓝图 + 8 条补全批评):scratchpad `design-final.json`。
- 审计 run:`wf_33b1b554-c6e`;竞标 run:`wf_0564f0de-99a`(同会话可 resume 复查)。
