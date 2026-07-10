# StoryForge 受控重构计划(第三轮 · 2026-07-11 过夜)

分工:**计划 = Claude(本文件,已拍板全部设计决策)/ 执行 = Codex(GPT-5.6 Ultra,今晚)/ 验收 = 用户(明早)**。
分支:`codex/refactor-overnight-20260711`,自 `master`(起点 ab832a2e)新建。
第一轮(2026-07-08,PR #116)与第二轮(2026-07-10,PR #124)见本文件 git 历史;本轮不重复前两轮已完成批次。

本轮体量约为第二轮的 2.5 倍:**必做 B1-B6,选做 B7-B8**。按序执行;时间不足时选做批次直接 skip 并在 §8 记录,必做批次不绿即回弃、不降级混过。

执行纪律:**按本文件执行,不自由发挥**。设计决策已全部拍板;执行中遇到本文件没覆盖的分叉,选保守路径(回弃当批并记录),不要现场发明新方案。本文件引用的行号是计划期快照,执行时以符号名重新定位,行号漂移不算分叉。

---

## 0. 启动步骤(按序)

1. `git status --short --branch` 记录启动状态。未跟踪的 `.agents/`、`.trellis/`、`.codex/config.toml`、`.codex/hooks*`、`.codex/agents/`、`AGENTS.md` 等本机脚手架视为既有内容,**永不 stage**。
2. 自 `master` 新建分支 `codex/refactor-overnight-20260711`。
3. 通读上下文(执行前置,不可跳):
   - `AGENTS.md`、`CLAUDE.md`(尤其 §6 协作约定)
   - `docs/internal/workflow-capability-migration-ledger.md`(B1/B2 立项依据)
   - `apps/api/app/domains/DOMAINS.md`(红线清单)
   - `git show bfb5c75c` 与 `git show e363265c`(**B1 的逐文件模板**:prose_check / collapse_check 两刀全 diff)
   - `apps/api/app/domains/agent_runs/` 下 `canon_store.py`、`canon_gate.py`、`canon_rebuild.py`、`canon_dossier.py` 全文(B2 前提)
   - `apps/api/app/common/llm_client.py` 全文(B3 前提)
   - `apps/desktop/frontend/src/components/ChatWindow.tsx` 的会话切换 effect、`runAuthorAgent` 终态块、`applyResumedAgentResult`、`applyAgentStreamEvent`(B4/B5 前提)
4. 记录基线数字,写入 `.codex/verification-report.md` 本轮新段开头:
   - `cd apps/api && uv run pytest -q` 总通过数(预期 907 passed / 3 skipped 附近);
   - `npm --prefix apps/desktop/frontend run test` 用例数(预期 24 files / 142 tests);
   - `cd apps/api && uv run ruff check .` 干净。

## 1. 全局红线(违反任一 = 本轮失败)

1. **不删、不改 `apps/workflow` 下任何文件。** salvage 一律「复制进 `apps/api`」;新代码禁止出现 `storyforge_workflow` import。
2. **零 ORM / schema / alembic 变更。** 不碰任何 `models.py`,不新增迁移。
3. **前端 src 白名单。** 本轮允许触碰的 `src/` 文件仅限:`components/ChatWindow.tsx`(handler/effect/ref 逻辑)、`components/chat-window/session-guard.ts` 及同目录**新增**纯逻辑 `.ts` 文件、`lib/api/types.ts`、`lib/api/contracts.ts`、`lib/api-client.ts`。其余 `src/` 零改动;**JSX 结构、样式、token、观感零变更**(`panels.tsx` 明确不碰);`package.json` 依赖与 lockfile 零变更(不装 @testing-library)。
4. **禁 `git add -A` / `git add .` / `git add -u`。** 只显式路径 stage。
5. **改 loop 工具 spec 必须连 `apps/api/tests/fixtures/loop_tool_schemas_golden.json` 一起提交**(B1、B2 各重生一次)。golden 重生注意换行符与既有文件一致(**CRLF 坑**:重生成须对齐既有行尾,否则整文件 rewrite diff)。
6. **不 push、不开 PR。** 本地小步提交,留分支待明早验收。
7. **不读不写真实 LLM key / `.env` / `llm-provider.json`。** 全部验证走确定性测试与 mock。
8. **OpenAPI 预期零漂移。** 本轮无任何路由签名变化;若 drift 检查变红,停下查因或回弃当批,不得刷新快照了事。
9. **每批独立提交;批内门禁不绿不提交;修不绿就 `git restore` 整批回弃并在报告记录。** 宁可少而绿,不要多而花。提交信息简体中文,前缀 feat/refactor/test/docs。
10. **canon 红线:后端绝不写 `canon.json` 本体与任何手稿正文。** 派生缓存写盘白名单只允许本计划点名的新增条目(B2 的 `proposals.json`),其余白名单条目不动。

## 2. B1(必做)·`project.entity_budget_check`——长篇实体预算 advisory 工具

workflow → IDE-agent 能力迁移**第三刀**(首刀 prose_check bfb5c75c、第二刀 collapse_check e363265c)。discovery 已证:tier-2 五件中 `entity_budget` 自包含度最高(单章纯函数、不绑批量 DTO、整个 workflow 里只被 tests 消费),且「第 20 章后禁新地点 / 25 章后禁新谜题 / 30 章后禁新装备证据 + 数量预算」是 canon_gate 完全没有的真实缺口,对连载作者最有用。`name_registry` / `timeline_ledger` 与 canon 能力重叠,**本轮不搬**(name_registry 的核心规则以 advisory 形式并入 B2)。

### 源与目标

- 只读参考(复制素材,**勿改动源文件**):
  - `apps/workflow/storyforge_workflow/narrative/entity_budget.py`(62 行:`ChapterEntityDelta` + `EntityBudgetGate.validate`)
  - `apps/workflow/storyforge_workflow/narrative/plan.py` 的 `EntityBudget` dataclass(默认值 key_characters=5 / core_locations=3 / core_evidence=3 / major_reversals=2 / new_core_entities_after_chapter_20=0 / new_mysteries_after_chapter_25=0)
- 新文件:`apps/api/app/domains/agent_runs/entity_budget_scan.py`,**自包含**(与 `collapse_scan.py` 同模式:单文件、无 workflow import、issue dict 形状内联 `{rule, severity, detail, snippet}`)。

### 设计拍板

- 工具名 `project.entity_budget_check`;**advisory only**;输出 = `{path, chapter, verdict:{status: pass|warn, issues[]}, summary}`,summary-only 回 LLM。
- 参数(JSON schema):
  - `path`:必填,项目内正文文件相对路径。沿用 path-scope 守卫;文件不存在或空内容报 `FsToolError`(不伪造结果)。工具**不分析正文内容**,读文件仅为验证存在性与非空。
  - `chapter`:可选 int。未传时,章节序号 = 该文件在 `canon_rebuild._iter_project_files(root)` 阅读序中的 1-based 位次(**与 canon presence 章号口径一致**,直接复用该迭代器,勿另写一套);传入则以传入为准(作者文件名自带章号时 LLM 可覆盖)。
  - 六个可选 `string[]`:`new_key_characters` / `new_core_locations` / `new_core_evidence` / `new_major_reversals` / `new_mysteries` / `new_equipment`。**语义:字段未传 = 对应规则跳过(诚实缺席);显式传空数组 = 「本章无新增」参与判定。** 由循环内 LLM 读完正文后当抽取器自填(collapse_check 的既定模式)。
  - 六个可选 int 预算覆盖:`budget_key_characters` / `budget_core_locations` / `budget_core_evidence` / `budget_major_reversals` / `budget_new_core_entities_after_chapter_20` / `budget_new_mysteries_after_chapter_25`。未传用 `EntityBudget` 默认值。
- 判定规则:**忠实复制 `EntityBudgetGate.validate` 的全部规则语义,包括硬编码章节阈值(ch≥20 / ch≥25 / ch≥30)与预算计数逻辑,勿自行改语义**。执行时逐行对照源文件搬;规则条目在工具描述里写清「advisory 参考信号,不是质量判定」。
- 与 collapse_scan 的 issue 形状重复照旧容忍(共享地基不在本轮抽)。

### 接线(逐条照 e363265c 的 diff 位置做)

`tooling.py` ToolSpec + `loop_runtime.py` 分发与 output_summary + `runtime.py` handler + `role_catalog.py`(root_agent 与 context_explorer 两处,与 collapse_check 同档) + golden 重生。

### 测试(新 `apps/api/tests/test_agent_entity_budget_scan.py`,参照 `test_agent_collapse_scan.py`)

- 每条规则正例 + 反例;「未传 vs 传空数组」语义区分显式用例;预算覆盖参数生效用例;
- `chapter` 未传时的阅读序推断用例(建两个文件,断言第二个文件 chapter=2)与显式传入覆盖用例;
- path 越界拒绝、文件不存在/空内容报错;
- `test_agent_loop_runtime.py` 加集成断言(工具进 schema、golden 对账)。

### 验证

```powershell
cd apps/api
uv run pytest tests/test_agent_entity_budget_scan.py tests/test_agent_loop_runtime.py -q
uv run pytest -q          # 全量,不得低于基线
uv run ruff check .
node ../../scripts/check-openapi-drift.mjs   # 期望零漂移
```

提交:`feat(agent): project.entity_budget_check 实体预算 advisory 工具(workflow 能力迁移第三刀)`

## 3. B2(必做,本轮旗舰)·`project.canon_delta`——canon 抽取缝确定性提案工具

拆 canon 路线的「抽取缺口」(ledger §2b tier-1 的 extract slice;canon 现只校验作者声明,不从正文抽事实提议更新)。**拍板:不在工具内调 LLM**——沿用「LLM 当抽取器填参数、确定性规则当判定器」模式:循环内 LLM 读完章节后把观察到的 canon 级事实作为结构化参数传给工具,工具做确定性 diff / 冲突检查 / 提案输出。整刀无 LLM、无 key 可验。同时把 `name_registry` 的核心规则(同一表面形指向不同身份)以 advisory 形式并入,不另立工具。

### 源与目标

- 只读参考:`apps/workflow/storyforge_workflow/narrative/extract/`(prompt/parser/facts,**理解字段设计用,不复制 prompt 管线**——工具参数模式已取代 prompt→LLM→parse 三步);`narrative/name_registry.py` 的 `record` 冲突规则(salvage 语义)。
- 新文件:`apps/api/app/domains/agent_runs/canon_delta.py`。可 import 同目录 `canon_store` / `canon_gate` / `canon_rebuild`(进程内既有地基,非 workflow)。

### 设计拍板

- 工具名 `project.canon_delta`;**advisory only;绝不写 `canon.json` 本体**;输出提案落派生缓存 + summary-only 回 LLM。
- 参数(JSON schema,全部可选,未传 = 该类不提议;全部未传或全空 = 诚实返回「无提议」summary,不报错):
  - `entities`:`array`,元素 `{name: string, aliases?: string[]}`——本章观察到的实体;
  - `holder_claims`:`array`,元素 `{item: string, holder: string, from_chapter?: int, to_chapter?: int}`;
  - `exit_claims`:`array`,元素 `{entity: string, exits_after_chapter: int, reason?: string}`;
  - `timeline_claims`:`array`,元素 `{before: string, after: string}`。
  - 形状与 `canon.json` 的 `invariants.single_holder[]` / `lifespan[]` / `timeline_order[]` 逐字段对齐(见 `canon_gate.py` 的读取处),不发明新字段名。
- 确定性处理管线:
  1. `scaffold_canon_if_missing` + `read_canon`;presence 用 `read_derived("presence.json")` 缓存,缓存缺失时 `rebuild_presence` 重建(不新增 refresh 参数,保持工具便宜);
  2. **实体归并**:用 canon `entities[]` 的 canonical_name + aliases 建表面形索引(复用 `canon_rebuild._entity_surface_forms`),把每个提议实体分类为 known(命中既有实体,报 matched id)或 new(提案新增);
  3. **别名冲突(name_registry salvage)**:同一提议 name/alias 命中 ≥2 个不同既有实体,或一个提议实体的表面形横跨两个既有实体 → advisory issue `alias_conflict`;
  4. **提案合并 + 闸对照**:deep-copy canon dict,append 新实体(id 确定性生成:`ent_` + name 的 sha1 前 8 位,与 canon_gate 的 issue-id 手法同风格)与三类 claims,跑 `canon_gate.check(merged, presence)`;同时跑 `canon_gate.check(original, presence)` 作基线,**只报提案引入的新 conflicts/advisories**(按 issue id 差集);
  5. 输出:`{proposals: {new_entities, known_entities, holder_claims, exit_claims, timeline_claims}, alias_conflicts, new_conflicts, new_advisories, summary}`;合并后的 canon 草稿全文写派生缓存 `proposals.json`(`canon_store._ALLOWED_DERIVED_NAMES` 白名单 += `"proposals.json"`,**仅此一条**),作者审阅后自行改 `canon.json` 或让 agent 走 file.revise 待确认补丁(本刀不接线该后续)。
- issue id 差集若因 canon_gate 的 id 生成对输入顺序敏感而不稳定:**降级为「报告合并后全量 check 结果、不做差集」**,在 detail 注明「含既有冲突」,并在报告记录降级——这是计划内保守出口,不算回弃。

### 接线与测试

接线同 B1 四点 + golden 重生(与 B1 累计,本批 golden 含两个新工具)。新 `apps/api/tests/test_agent_canon_delta.py`:
- known/new 实体分类(canonical_name 命中、alias 命中各一例);别名冲突正反例;
- 提案引入 single_holder 章窗交叠 → new_conflicts 捕获;基线已有冲突不重复出现(差集正确性);
- `proposals.json` 写盘成功 + **断言 `canon.json` 内容未被改动**(读回 byte 对比);白名单外文件名拒写既有用例回归;
- 全空参数 → 「无提议」summary;presence 缓存缺失时自动重建路径;
- `test_agent_loop_runtime.py` 集成断言。

### 验证

同 B1 命令集(pytest 目标文件换成 `test_agent_canon_delta.py`)。

提交:`feat(agent): project.canon_delta 确定性 canon 提案工具(抽取缝 slice,含 name_registry 别名冲突规则)`

## 4. B3(必做)·retrieval embedding/reranker 出网统一到 llm_client 传输

F16 最后一段出网收敛:全库真实出网仅剩 `retrieval/embedding_client.py`、`retrieval/reranker_client.py` 两处 httpx。现状还有真实弱点:**零重试、零退避、失败零日志零脱敏**。本批 = 换传输 + 补重试/脱敏,**payload / 端点 / 鉴权头 / env 语义逐字节保持**。

### 设计拍板

1. `app/common/llm_client.py` 新增通用入口 `post_json_with_retry(url, payload, headers, *, timeout_seconds, max_attempts=3, service_label: str) -> dict[str, object]`:复用本文件既有 `_is_retryable_status` / `_sleep_before_retry` / `_RESPONSE_READ_ERRORS` 重试骨架与 `LLMError` 异常,错误消息用 `service_label` 开头(如「embedding 服务返回 HTTP 429…」),失败日志走 `redact_secrets`。**不做 token 记账**(embedding/rerank 无 chat usage 语义)。`_request_chat_completions` 与整条 chat 通道**零改动**(不借机重构,保住第二轮等价性)。
2. `embedding_client.py` / `reranker_client.py`:删 `import httpx`;构造参数 `http_client_factory` 换成可注入 `post_json` callable(默认指向 `llm_client.post_json_with_retry`);请求 URL、body 字段、`Authorization: Bearer` 头、timeout 默认值(30.0)、batch_size 分批逻辑、响应解析与畸形响应 `RuntimeError` 路径全部保持;`resolve_embedding_client` / `resolve_reranker_client` 的 env 分支(`STORYFORGE_EMBEDDING_*` / `STORYFORGE_RERANKER_*`,裸 os.getenv)**零改动**——它们有自己的命名空间,不吃 `resolved_llm_env`,本轮不改配置源。`LocalEmbeddingClient` / `DisabledRerankerClient` / `LocalCrossEncoderRerankerClient` 零改动。
3. **异常语义前置核查(动手前做)**:`rg "except" apps/api/app/domains/{retrieval,story_memory,scene_packets,book_runs}` 找有没有调用方 catch `httpx.*` 或依赖现行异常类型;discovery 结论是 HTTP 错误现状裸逃逸无人 catch——若核查推翻该结论(存在 isinstance/except 依赖),**回弃本批**并记录。换传输后 HTTP/连接失败统一抛 `LLMError`(502 DomainError,消息带 service_label)。
4. ruff:`[tool.ruff.lint.flake8-tidy-imports.banned-api]` 增 `"httpx"`(理由写「出网传输统一走 llm_client」);跑 `uv run ruff check .` 处理波及(预期仅这两个文件,若 tests 有直接 `import httpx` 就重写该测试而非加放行)。
5. 测试:`tests/test_retrieval_real_providers.py` 的 `_FakeHttpxClient` 注入改为注入假 `post_json` callable(20 用例逐一迁,断言的请求 URL/headers/body 形状不变);新增一条重试行为用例(注入先回 429 再成功的假 transport,断言 `post_json_with_retry` 重试后成功——用 monkeypatch 把退避 sleep 置零,勿真睡);`test_retrieval_embedding.py`(Protocol 参数注入)预期零改动。

### 验证

```powershell
cd apps/api
uv run pytest tests/test_retrieval_real_providers.py tests/test_retrieval_embedding.py tests/test_llm_client_channel.py -q
uv run pytest -q
uv run ruff check .
rg "import httpx" apps/api/app    # 期望归零
```

### 退出条件

异常依赖核查不过、或等价性任何一点(payload/头/timeout/解析)拿不准 → `git restore` 整批回弃,报告记录卡点。

提交:`refactor(api): retrieval embedding/reranker 出网统一走 llm_client 传输(F16 出网面收官)`

## 5. B4(必做)·会话守卫 L2:草稿会话 nonce,堵两 null 假匹配

已登记 L2 隐患成立且可达:`isRunResultForActiveSession` 用 `===`,两参都 null(未存会话)时判 match。可达路径:**未存会话 A 的 run 在飞时,点 ConversationHeader「新建会话」→ `onAssistantSessionChange(null)` → 活动会话变成另一个未存会话 B,而两边都是 null → A 的终态/流事件/编辑器回传全部假匹配写进 B**。现有决策表测试(`tests/behavior/agent-session-guard.vitest.ts`)反而把 `(null,null)→true` 钉死了。

### 设计拍板:草稿会话客户端 nonce + 复合会话 key

- `session-guard.ts` 改造:
  - 新增 `conversationKey(sessionId: number | null, draftNonce: string): string`——`sessionId` 非空返回 `` `saved:${sessionId}` ``,否则返回 `` `draft:${draftNonce}` ``;
  - `isRunResultForActiveSession` 改签名为 `(activeKey: string, runKey: string): boolean`,实现仍是 `===`(或新函数 `isRunResultForActiveConversation` + 删旧函数,二选一,不留双份);
- `ChatWindow.tsx` 接线:
  - 新增 `draftNonceRef`(模块级自增计数器生成 `draft-1`、`draft-2`…即可,勿用随机数,便于测试确定性);
  - **nonce 重生成时机(两处)**:①「新建会话」handler(调 `onAssistantSessionChange?.(null)` 之前);②会话切换 effect 观察到 `assistantSessionId` 从非 null 变 null 的转移时(用 prev ref 对比)。null→null 的外部切换现状不存在入口,不处理,注释记一句已知边界;
  - 六个调用点(`applyResumedAgentResult` / `applyAgentStreamEvent` / `runAuthorAgent` 成功终态与 catch 终态 / SUGGESTION_RESULT_EVENT / AUTHOR_LOOP_RESULT_EVENT)全部改传 key:活动侧 = `conversationKey(assistantSessionIdRef.current, 当前 nonce)`;run 侧 = run 起跑时捕获的 `conversationKey` 快照(`runStartSessionIdRef` 升级为存 key 字符串);`applyResumedAgentResult` 的 run 侧 = `conversationKey(response.assistant_session_id, '')`(恒 saved);
  - 成功终态把 run key 推进到 `saved:${后端回的 id}` 的既有逻辑保持(现 `runStartSessionIdRef` 推进处同位改)。
- **行为语义**:同一草稿会话自己的 run(nonce 相同)照常放行——首条消息场景不回归;换了草稿会话(nonce 不同)拒写。
- 测试:重写 `agent-session-guard.vitest.ts` 决策表——`saved 同号 → true`、`saved 异号 → false`、`同 draft nonce → true`、`draft A 起跑 + 切到 draft B → false`(L2 修复的靶心用例)、`draft 起跑 + 切到 saved → false`、`saved 起跑 + 切到 draft → false`。

### 退出条件

改动泄出 `ChatWindow.tsx` + `session-guard.ts` 两文件(需要动父层 App 接线才能成立)→ 回弃并记录;既有 142 用例任何一个因此不绿且 45 分钟内定位不了 → 回弃。

提交:`fix(desktop): 草稿会话 nonce 复合 key,堵会话守卫两 null 假匹配(L2)`

## 6. B5(必做)·切会话清理 run 面板 state(旧 run 面板滞留)

已证:面板渲染 gate 只看 `agentRun` / `writingRunProjection` 非空(`panels.tsx`,**本批不碰**),而会话切换 effect 只清 messages/标题等,**不清 `agentRun`、`writingRunProjection`、`retryRequest`**(全库无任何 `setAgentRun(null)`)→ 上一会话的流程树/进度面板/LightweightStatus 滞留到新会话。守卫只挡写回,挡不住已在 state 里的旧面板继续渲染。

### 关键陷阱(设计已拍板绕开)

草稿会话首条 run 成功后,终态块自己调 `onAssistantSessionChange(新 id)` → `assistantSessionId` prop null→N → 同一个切换 effect 会再跑一次。**天真地在 effect 里清 run state 会把刚完成的流程树当场闪没**——这是自我持久化转移,不是真切会话。

### 设计拍板

- `ChatWindow.tsx` 新增 `selfPersistedSessionIdRef`:成功终态块在调 `onAssistantSessionChange(新 id)` **之前**把该 ref 置为新 id;
- 会话切换 effect 开头:若 `assistantSessionId === selfPersistedSessionIdRef.current` → 清该 ref、**跳过 run-state 清理**(messages 等既有清理行为保持现状,零改动——先读现状确认 messages 在该转移下的行为,照实沿用,不顺手改);否则为真切会话 → 在既有清理之外补 `setAgentRun(null)`、`setWritingRunProjection(null)`、`setRetryRequest(null)`(`agentBusy` 不动,F26/PR#92 的终态守卫已管它);
- 决策抽纯函数:同目录新增 `chat-window/session-switch.ts`,导出 `shouldResetRunPanels(nextSessionId: number | null, selfPersistedSessionId: number | null): boolean`,effect 只消费该函数——与 session-guard 同款「纯函数 + 薄接线」范式,不引入挂载测试(红线 3:零新增依赖)。
- 测试:新 `tests/behavior/session-switch-reset.vitest.ts` 决策表(真切会话 → true;自我持久化转移 → false;null→null 不经 effect,不列)。执行前先读终态块与 effect 的真实顺序,若发现 discovery 结论不成立(存在既有 skip 机制或 messages 行为矛盾),按实际机制对齐并在报告写明差异。

### 退出条件

自我持久化转移的时序在实测中与拍板机制冲突(例如 effect 先于终态块跑)且 45 分钟内理不顺 → 回弃并记录(这格欠账继续留给真机波)。

提交:`fix(desktop): 切会话清理 run 面板 state,自我持久化转移豁免(旧 run 面板滞留)`

## 7. B6(必做,微批次)·Revise 死类型清理

计划前提修正:`requestRevision` 函数本体已在 W0(c5c51975)删除,残留的是类型孤岛。逐一核实过消费者:

- 删 `src/lib/api/types.ts` 的 `ReviseResult`(无任何导入方);
- 删 `src/lib/api/contracts.ts` 的 `ApiAssistantReviseRequest` / `ApiAssistantReviseResponse`(无消费者;只是 shared generated 类型的别名,不动生成物);
- 删 `src/lib/api-client.ts` barrel 的 `ReviseRequest` / `ReviseResult` 两行 re-export;
- **`ReviseRequest` 类型本体保留**在 types.ts——`codecs.ts` 以 `ReviseRequest['contextBundle']` 取形,是 live 链路(不重命名、不重构,纯删死码)。

验证:`npm --prefix apps/desktop/frontend run typecheck`、`npm --prefix apps/desktop/frontend run test`、`pnpm.cmd lint` 三绿。

提交:`refactor(desktop): 清理 REST revise 残留死类型(W0 尾款)`

## 8. B7(选做)·连通性探针测试去 flaky(只修机械,不弱化断言)

`apps/api/tests/test_real_llm_connectivity_probe_script.py` 三个用例(`test_real_llm_connectivity_probe_retries_once_when_chat_content_is_empty` / `test_ten_chapter_wrapper_probe_only_passes_with_local_provider` / `test_acceptance_wrapper_probe_only_passes_with_local_provider`)起真实 `HTTPServer` + subprocess powershell,历史 1/3 概率 flaky。根因诊断:powershell 冷启动 + `Invoke-WebRequest` 逼近 5s/20s 超时预算的时序竞态,非逻辑随机。

拍板整修范围(**断言语义一律不弱化**,精确请求序列断言保留):

1. server 起后先做就绪握手(循环 socket connect 直到接受连接)再 spawn powershell;
2. `subprocess.run(..., timeout=20)` 预算放宽到 60(这是测试 harness 预算,不是被测行为);探针自身的 `-TimeoutSeconds` 是被测参数,**不动**;
3. server 拆解走 try/finally:`shutdown()` + `server_close()` + `thread.join()`,消除跨用例端口/线程残留;
4. 类级可变状态(`_ProbeProviderHandler.requests` 等)改为每用例显式重置已存在——补齐 `chat_count` 等全部字段的重置遗漏(若有)。

验证:该文件连续跑 10 遍全绿(powershell `for` 循环 `uv run pytest tests/test_real_llm_connectivity_probe_script.py -q`,任一遍红即未达标);全量 pytest ≥ 基线。达不到就回弃,flaky 记录归档。

提交:`test(api): 连通性探针测试就绪握手与拆解加固(去 flaky)`

## 9. B8(选做)·usage 记账字段对齐(F16 记账尾款,纯 additive)

三处 chat 出网消费方共用 `llm_client._token_usage` / `_cost_breakdown` 公式(口径已一致),但字段留存不对称:book_runs 落 ModelRun 全字段;agent 循环与 assistant 单轮的证据 JSON 丢 `token_usage`(total)、`cost_breakdown`、`token_usage_source`。

拍板:**纯 additive,零契约变更,零 DB 变更**——

1. `agent_runs/loop_runtime.py` 的 `ChatLoopOutcome` 与 output_summary、`assistant/service.py` 的 chat/draft/revise 证据 JSON,补齐上述三字段(照 F32/PR 补 prompt_tokens 的同款加法);
2. 新 `apps/api/tests/test_usage_accounting_matrix.py`:一处断言三个 sink 的证据/payload 字段集都 ⊇ 公共核心集 `{prompt_tokens, completion_tokens, token_usage, cost_cny_estimated, cost_breakdown, token_usage_source}`(mock LLM 响应带 usage,分别驱动三条链取证)。embedding/reranker 零记账现状**本轮不改**(无 usage 语义,另案)。

验证:目标测试 + 全量 pytest + ruff;OpenAPI 零漂移(证据 JSON 是自由形状,不进契约)。

提交:`feat(api): agent 循环与 assistant 证据补齐 usage 全字段 + 三 sink 一致性矩阵测试`

## 10. 收尾与报告

1. 全部批次完成后统一跑:`pnpm.cmd verify`、`pnpm.cmd e2e`;
2. `.codex/verification-report.md` 追加本轮段:标题(第三轮过夜重构)、基线数字、各批「命令 + 输出摘要」、回弃/skip 项及原因、诚实边界(未做真 LLM/真机验收);
3. 回填本文件 §12 执行结果表;
4. 把 `REFACTOR_PLAN.md`、`.codex/verification-report.md` 与各批改动文件按批次显式路径提交(计划文件随第一个提交进分支)。

## 11. 明早验收清单(用户 / Claude 执行)

1. `git log --oneline master..codex/refactor-overnight-20260711` —— 预期 5~8 个业务提交(+报告),信息与批次一一对应;
2. `git diff master --stat` —— 改动面只落在各批清单内;**`apps/workflow` 零改动;前端 src 只碰白名单;无 models.py / alembic 变更;`panels.tsx` 零改动**;
3. `cd apps/api && uv run pytest -q` 全绿且 ≥ 基线;`uv run ruff check .` 绿;`rg "import httpx" apps/api/app` 归零(若 B3 未回弃);
4. `npm --prefix apps/desktop/frontend run test` 全绿、用例数 > 基线(B4/B5 各有新决策表);typecheck 绿;
5. `pnpm verify` + `pnpm e2e` 绿;OpenAPI 零漂移;golden 含 `project.entity_budget_check` 与 `project.canon_delta` 两个新条目;
6. 抽查:`test_agent_canon_delta.py` 有「canon.json 未被改动」byte 对比断言;`agent-session-guard.vitest.ts` 有「draft A 起跑切到 draft B → false」用例;`proposals.json` 进了派生白名单且仅此一条新增;
7. 读 `.codex/verification-report.md` 新段 + 本文件 §12 结果表;
8. (可选,真 LLM)起桌面问「读一下第 N 章,有没有引入新人物新地点,更新一下设定集」,观察循环串 `fs.read → project.entity_budget_check → project.canon_delta` 并回 advisory 提案。

## 12. 执行结果(Codex 回填)

| 批次 | 状态(done / reverted / skipped) | 提交 hash | 备注 |
| ---- | ---- | ---- | ---- |
| B1 entity_budget_check | done | ee0b31b9 | 批内目标/全量/ruff/OpenAPI 门禁全绿 |
| B2 canon_delta | done | 8eaecaf5 | 批内目标/全量/ruff/OpenAPI 门禁全绿 |
| B3 retrieval 传输统一 | done | 待收尾回填 | 异常依赖核查通过；目标/全量/ruff 门禁全绿 |
| B4 会话守卫 nonce(L2) | | | |
| B5 切会话清 run 面板 | | | |
| B6 Revise 死类型 | | | |
| B7 探针去 flaky | | | |
| B8 usage 字段对齐 | | | |
