<!-- 由 ultracode 多 agent 解构 workflow 生成 (wf_9a0330b9-e66, 2026-06-30)。外部项目参照,非 StoryForge 产物。注:prompt-engineering 维度本轮 agent 失败,该子题偏薄。 -->

# 天命（tianming-novel-ai-writer）解构报告 · 终版：为 StoryForge Desktop Agent orchestrator 取经

> 取经目标：StoryForge 正在设计「中央集权 orchestrator + 子 agent(Planner/Writer/Critic/Reviser) + tools；状态进 DB/文件不进 context；结构批完放跑 + 逐章 Critic 自修 + 硬熔断 tripwire + 导引抽查；deterministic 不变量做硬 gate vs 语义判断做 advisory」。
>
> 本终版在草稿基础上完成了**校核闭环**：天命侧机制保留并补充了被标记为「未独立核实」的召回/嵌入层数值（已逐条抽验为真）；StoryForge 侧的全部映射**重新锚定到真实 live 代码路径**，纠正了草稿把测试专用脚手架当成 live 基座的系统性误判。所有结论带 file:line 证据。校核逐条处置见 §7。

---

## 0. 必读前置：StoryForge 的 live 路径 vs 测试脚手架（最关键纠正）

草稿（以及部分校核意见）把一批文件当成 live 基座来挂建议，实测它们是**测试专用、未接线**。照草稿 P0/P1 直接动手会发现「对 live 链路零影响」——这与 MEMORY 里「agent live/legacy 死路」教训同型。先把真相钉死：

### 0.1 整套 workflow `narrative/` 门禁层是 TEST-ONLY

grep 全仓 `storyforge_workflow.narrative` 的非 narrative 导入者，**全部落在 `apps/workflow/tests/`**，无任何 live 引用：

- `test_narrative_collapse_and_beat_sheet.py`、`test_narrative_entity_budget.py`、`test_narrative_extract.py`、`test_narrative_forbidden_terms.py`、`test_narrative_plan.py`、`test_narrative_registries.py`、`test_book_run_dispatch_payload.py`。

涉及文件（均 test-only）：`narrative/verdict.py`、`plan.py`、`collapse_judge.py`、`extract/{facts,prompt,parser}.py`、`gate_harness.py`、`entity_budget.py`、`name_registry.py`、`timeline_ledger.py`、`repetition_ledger.py`、`beat_sheet.py`、`forbidden_terms.py`。

**它们是高质量的「设计原语库」，不是运行时门禁。** 任何「扩 `gate_harness.py`」「在 `novel_loop` 加 retry」的建议，前置工序都是**先接线**。

### 0.2 真正的 live 逐章判定链

`apps/api/app/domains/book_runs/book_generation.py:194 / :335` 与 `book_generation_parallel.py:290` 调用 **`_judge_and_repair_loop`**（`book_generation_judge.py:65`）：

- `_run_real_judge`（`:170`）→ `deterministic_judge_fallback(payload)`（`:196`，来自 `apps/api/app/domains/judge/deterministic.py:11`）= **live 确定性门禁**；
- **「local gate」快路径**（`book_generation_judge.py:197-211`）：`local_coverage = bool(payload.required_facts) or bool(payload.style_rules)`，若 `_fast_judge_enabled` 且有覆盖且无 local_issues → 直接给 `quality_score=100, fast_path_reason="local_gate_passed"`；
- `semantic_judge_with_status(payload, ...)`（`:219`，来自 `judge/semantic.py:97`）= **live 语义/LLM advisory 评分**，驱动 `REPAIR_THRESHOLD` 重修循环 + `_apply_word_count_floor`（`:119`）。

并发路径的提交钩子 `precommit_chapter`（`book_generation_parallel.py:274`）内部就跑这套 `_judge_and_repair_loop` + `_finalize_scene_decision`，`status = "approved" if approved else "awaiting_review"`（`:316`）。

### 0.3 live 确定性门禁有多薄（直接关系 Q1）

`deterministic_judge_fallback`（`deterministic.py:11-17`）只做两件事：
1. `_detect_setting_conflicts`（`:20`）：对 `required_facts` 找直接矛盾或缺失，**反义模板硬编码到 demo 事实**（`:53-56` 写死 `左臂受伤/右臂受伤` → `左臂完好无损` 等）+「字段：值」冲突（`:72`）；
2. `_detect_style_drift`（`:112`）：仅当 style_rules 含「克制」时匹配 `STYLE_DRIFT_PHRASES`。

**这就是 current-phase.md 要整改的「写死」的一部分**：demo 调参、覆盖面极窄、对真实长程几乎无约束力。配合 0.2 的「local gate 空转」（覆盖即给 100 分），正是 `current-phase.md:98` 把「**收紧 fast-judge 空转**」列为独立根因的原因。

### 0.4 `narrative_gate.py` 是回归门，不在 live 逐章循环里

`apps/api/app/domains/book_runs/narrative_gate.py`（`_auto_gate_results_from_book_export` `:15`、`_chapter_template_fact` `:70`、`source="narrative_fact_heuristic"` `:161`）是一支**整本 book.md 导出后做套路章检测的纯函数**：解析章节 → 五桶动作(arrival/inquiry/inspection/stash/transition) → 叠加 `concrete_detail` 锚点(≥3 数字 / 时间戳 / 对白)做假阳性护栏；`is_template = 动作桶≥3 且 无结构保护 且 无具体锚点`（`:116-120`）。注释 `:112-120` 明确记录了 30 章 CH3/4 系统性误报的修复——**说明它确实被用真实长跑数据调过参**。

**但**：全仓 grep `_auto_gate_results_from_book_export` 的调用者**只有** `golden_regression.py:37`（确定性回归 CLI/harness）+ `tests/test_narrative_gate.py`。它**没有**接进 live `_judge_and_repair_loop`。所以准确表述是：**经长跑调参、有确定性回归护栏（`golden_regression.py`）的整本导出后置检查，而非 live 逐章门禁**。（此处同时纠正校核意见——它把 narrative_gate 称为「已投产 live」，更精确是「regression-gated、调过参，但不在 live 逐章判定路径」。）

### 0.5 live 的结构化连续性引擎（StoryForge 的真实强项，在 API continuity 域）

`apps/api/app/domains/continuity/edge_constraints.py` 是 live 的图约束引擎：`EdgeKind = Literal["relationship","timeline_order","status"]`（`:18`）；`WITH RECURSIVE` 可达性查环（`:72`，`_check_reachability_cycle` `:98`，深度护栏）+ 状态时间窗交叠（`_check_status_window` `:144`）；`check_edge_constraints`（`:212`）按 `edge_kind` 分支（`:228`），severity 分 low/medium/high/blocking。由 `continuity/service.py:106 _validate_and_stage_edges` 调用。

**可达性**：book-run 经 `submit_continuity` 端口可喂数据进来（`book_run_adapter.py:71/:120/:232 continuity_submitter`），但 `novel_loop` 默认是 `_skip_submit_continuity`（`novel_loop.py:47-50`，返回 `{}`）——即**默认不提交**，需注入真实 submitter 才会跑边校验。

> **一句话锚点**：StoryForge 的门禁组件**多已存在但 test-only 未接线**；live 判定（`deterministic_judge_fallback` + local-gate + `semantic_judge_with_status`）**偏薄且 demo 调参**；唯一确定性强项 `edge_constraints` 在 continuity 域、只覆盖关系/时间序/状态时间窗这类**边问题**。这才是和天命对照的真实基线。

---

## 1. 天命整体如何工作：一条端到端主线

天命是 .NET 8 WPF 桌面应用，核心是把「规划」和「写正文」拆成两条彻底分离的链路，中间用「数据中心打包」做缝。

### 1.1 配置模型 → AI 引擎就绪
`SKChatService`（巨型 partial 类）统揽 Semantic Kernel：按「配置指纹」(provider/model/endpoint/apiKey/timeout/longCtx) 缓存 `KernelBundle`，按协议路由到 OpenAI/Anthropic/Gemini/Azure 四类连接器（`SKChatService.KernelManagement.cs:45 EnsureKernelInitialized`、`:89-268 BuildKernel switch`）。每个 Kernel 注册 6 个 `[KernelFunction]` 插件(Writer/System/DataLookup/DataEdit/ContentEdit/Workspace) + 一个 `PlanModeFilter`（`:308-321 RegisterPlugins`）。`NovelAgent` 只是 SK `ChatCompletionAgent` 的薄包装，所谓 agentic loop 就是 `FunctionChoiceBehavior.Auto` 的自动函数调用，不是 SK Planner（`Agents/NovelAgent.cs:28-59`）。

调用边界护栏：本地 per-provider 限流（`ApiRateLimiter.cs:11 Acquire`，超限抛 `LocalRateLimitException`）、key 轮换、指数退避（`SKChatService.cs:380-395`）、流式/非流式自适应 + Polly 熔断（`SKChatService.cs:434 AdaptiveGenerateAsync`、`:860-874 CircuitBreaker`）。

### 1.2 拆书提炼 → 设计数据（两条独立链路，README 说成一条龙、实测需人工搭桥）
- **BookAnalysis（拆书）**：WebView2 浏览器自动化爬取或本地导入 → 存 `CrawledBooks/<id>/`（`NovelCrawlerService.cs:55-148`）→ 精华章选择(目录抽样前120+中段步进+后30 + 联网搜索 + AI 挑黄金章给 reason，`EssenceChapterSelectionService.cs:167-251`)→ AI「拆书分析师」对截断后 12000 字摘录产出 **15 个叙事手法字段** 存 `book_analysis.json`（`BookAnalysisViewModel.Commands.cs:386-459`）。**但拆书报告只作为独立 SmartParsingContext 加载，未链入生成上下文。**
- **ContentRefinery（真正回流通道）**：粘贴任意文本 → AI 按 schema+existing_data+constraints 抽 JSON 实体 → 映射强类型规则 → 人名解析成已存实体 ID 做交叉引用 → 盖依赖版本快照 → 写进五大规则存储（`ContentRefineryService.cs:154-208 / 424-469 / 611-637`）。

### 1.3 五大规则 → 四层规划（层层细化，确定性硬门禁）
「一键直出」其实是 10 步**规划**管线 `OneClickGenerateViewModel.ExecutePipelineAsync`，止步于蓝图、**根本不写正文**（`OneClickGenerateViewModel.PipelineSteps.cs:11-34`，步骤7-10=大纲/分卷/章节/蓝图）。orchestrator 通过统一接口 `IPipelineBatchTarget` 把每步委派给模块 VM，自身只做调度/断点续跑/前序补全/熔断（`PipelineExecution.cs:157`）。

四层「层层细化」的真正纽带是**章节区间分配**：大纲填 TotalChapterCount + 剧情规则填总卷数 → 分卷算出每卷 StartChapter~EndChapter → 章节层对区间每章生成一张卡 → 蓝图对每章一份起承转合。层间用 `GetIncompletePrerequisiteCategoriesAsync` + 区间覆盖检查做**确定性硬门禁**（前卷没写满/没覆盖满直接拒绝下一层，是结构计数不是语义判断，`ChapterViewModel.AIGenerate.cs:647 / :748`、`BlueprintViewModel.AIGenerate.cs:262-291`）。

### 1.4 数据中心打包 → 每章相关性冻结成 ContextIds
四层规划被编译进 `ContentGuide`，**每章一个 `ContextIdCollection`（17 个稳定 ID 字段）**，把「本章需要谁」在打包期解析成清单冻结进 guide JSON（`ContextIdCollection.cs:8-27`）。`BuildBlueprintGuideAsync` 从蓝图 Cast/Locations/Factions 自由文本切词→映射设计元素 ID，**映射失败累积成 Error 并抛 `InvalidOperationException` 阻断打包**（name→ID 解析是硬门禁，`GuideIndexBuilder.GenerationGuides.cs:370-451 / :481-488`）。**相关性筛选发生在打包期，运行期只做按 ID 解引用**——这是「不靠上下文靠状态」的真正落点。

### 1.5 章节生成闭环（长篇有状态全套）
对话 Agent（Plan 模式）把「生成第 X~Y 章」展开成连续章号列表（有缺口直接拒绝，上限 500），交 `TodoExecutionService.StartSequentialRun` 顺序执行。单章 = `WriterPlugin.GenerateChapterAsync` 一次：

1. **写前读取（状态注入而非历史正文）**：`GuideContextService.BuildContentContextAsync` 按 ContextIds 并行解引用 12 项（纯字典查找，`GuideContextService.ModuleExtractors.cs:400-457`），再叠加前章尾段(~1000字)、近窗逐字摘要+跨卷里程碑锚点（O(近窗+锚点) 而非 O(全书)，`:459-538`）、**15 维事实快照** `FactSnapshot` 按 ContextIds 过滤、前卷归档按 focus-id 裁剪、长距召回片段。
2. **写前硬门禁**：Full 模式必须有 FactSnapshot 否则失败；`ValidateContextIdsAsync` 校验引用可解析；change-detection 检出已启用模块有未打包变更则阻断（`WriterPlugin.Generation.cs:89-135`）。
3. **AI 写作 + 门禁 + 自修**：`AutoRewriteEngine.GenerateWithRewriteAsync`（见 1.6/1.7）。
4. **正文落地 + 状态回写（事务）**：见 1.9。
5. **下一章读最新状态**：缓存失效 + 自动切卷，下章读到刚提交的 ledger。

### 1.6 六道门禁（全部确定性，无 LLM）
`GenerationGate.ValidateAsync` 是 fail-fast 短路流水线（`GenerationGate.PublicMethods.cs:87-288`），对「正文 + CHANGES」逐级校验：①CHANGES 协议解析+JSON 修复（`:98`）②ShortId 引用必须存在于账本（`:110`）③`LedgerConsistencyChecker` 8 条账本不变量 V1-V8（`:118`）④未知实体阈值（总数>5 或龙套>3 才 fail，`:165-191`）⑤描写一致（反义词字典邻近匹配，`:193`）⑥蓝图出场（缺席>max(3,总数/3) 才 fail，`:207`）。**100% 确定性算法（正则/HashSet/字典/计数/区间比较），没有一处调 LLM。**

8 条账本不变量（`LedgerConsistencyChecker.cs`）：V1 伏笔未埋先收/已收回退、V2 冲突状态序回退(pending<active<climax<resolved)、V3 角色不在场/等级倒退/能力丢失无事件/信任Δ越界(±30)、V4 移动链断裂/出发地不符、V5 物品持有人不符、V6 同章既盟友又仇敌、V7 承诺重复 create/多终止动作、V8 倒计时同理。

### 1.7 CHANGES 协议（结构化状态提取契约）+ 有界自修
模型在正文末尾输出 `<chapter_changes>` 包裹的固定 **12 类**状态变更 JSON（`TrackingChangeModels.cs:117-146`）。关键减负：系统按 contextIds+snapshot **预填 CHANGES 骨架**（每个在场角色一条、伏笔按当前状态预置 setup/payoff、CharacterMovements.FromLocation 用账本当前位置预填），模型只在骨架上改值（`LayeredPromptBuilder.Changes.cs:280-360 BuildPrefilledChangesJson`）。

归一化层 `ChapterChangesCanonicalizer.Canonicalize`：名称→ID 解析（重名标 ambiguous 直接弃）、账本不存在的伪 ShortId 剔除、伪造率超阈值(≥5 且占比≥80%)整章打回、新实体按 name 用 `ShortIdGenerator.NewDeterministic` 幂等铸造、不变量预纠正。

有界自修 `AutoRewriteEngine.GenerateWithRewriteAsync`（`MaxRewriteAttempts=2`，共 3 次，循环 `for attempt<=MaxRewriteAttempts` 见 `AutoRewriteEngine.PublicMethods.cs:218`）：门禁失败把 `GetHumanReadableFailures` 作为结构化 `previousFailures` 喂回做定向重写；`IsChangesOnlyFailure` 判定「正文 OK 仅 CHANGES 违规」则**只重生 CHANGES、保留正文**；token 超窗先 `DegradeContext` 分级降级、降到底硬停；3 次耗尽 → `RequiresManualIntervention=true`（升级人工而非静默通过，`:139-211 / :691-705`）。

### 1.8 15 维快照（12 动态 + 3 静态）
`FactSnapshot` 共 15 个集合（`FactSnapshot.cs:8-22`）：**12 维与 12 类 CHANGES 一一对应、可被章节回写**；另 **3 维（角色描写/地点描写/世界规则约束）是从设计数据抽的只读字段**，不被 CHANGES 回写，仅用于描写一致性与世界观硬约束校验。「15 维」并非全来自逐章抽取。

### 1.9 状态回写（事务化提交 + 崩溃恢复）
`ContentGenerationCallback.OnContentGeneratedInternalAsync`（`ContentGenerationCallback.Core.cs:273-477`）：门禁复验 → CHANGES 先写 **WAL** (`changes_wal/<ch>.json`) → 正文写 `.staging` 再原子 `File.Move`（旧文件留 `.bak`）→ `UpdateTrackingGuides` 11 个维度服务 `Task.WhenAll` 并行 apply → `FlushAllAsync`(两阶段 `.flush_staging`+`_commit` 标记+原子 move) → `VerifyCommitSync` 通过才删 WAL（否则留待重启恢复）→ 失效缓存 → 重建摘要/向量/关键词/里程碑。崩溃恢复双层：`GuideManager.RecoverPendingFlush` + `ConsistencyReconciler.ReconcileChangesWalAsync`。每维账本 per-volume 追加式 StateHistory（打章节戳），读取 `GetCharacterStateAtAsync` 跨卷二分取「≤目标章」状态（`CharacterStateService.cs:38-76 / :83-133`）——下一章 prompt 字段值来自此读取，**不是模型回忆**。

### 1.10 长距召回（advisory，多路混合）— 数值已抽验为真
`WriterPlugin.PopulateLongDistanceRecallAsync` 与门禁并行：本章计划+角色+未回收伏笔构造查询(≤400字) → 三路召回（TF/BM25 全文 + 关键词 + bge ONNX 三桶向量，章级粗筛→候选章内段级精排）→ **RRF 融合**(k=60，实测 `GuideContextService.cs:106 SemanticRrfK = 60`) → `PickByCategoryQuota` 按类配额（伏笔/角色/通用，`WriterPlugin.LongDistanceRecall.cs:201-204 / :260`）取约 5 段，排除当前/前章 → **全程 try/catch「非致命」**。嵌入是本地 bge-small-zh-v1.5 ONNX（实测 `BgeSmallZhEmbeddingService.cs:18-19 DefaultDimension=512 / MaxSequenceLength=512`，CLS/`last_hidden_state` `:271`，L2 归一化，闲置自动卸载，异常返回零向量降级）。

### 1.11 统一校验（与生成门禁分层）
`UnifiedValidationService.ValidateChapterAsync` = 确定性门禁复跑（`RunGateChecksAsync`，记为 StructuralConsistency）+ **LLM 十条语义规则评分（advisory，不阻断、只看正文前 1000 字，进校验看板）**。卷级用确定性抽样 clamp(ceil(n/5),3,50)+首尾必取。注意：名为 `ConsistencyReconciler` 的「一致性调和」实为**数据完整性对账**（WAL 回放/孤儿清理/索引重建），**不做叙事跨章矛盾检测**。

> **天命数值抽验结论（回应校核「未独立核实」）**：本轮在 `D:/tianming-novel-ai-writer` 源码逐条核对了召回/嵌入/仿人化层的代表性数值，全部命中：RRF `SemanticRrfK=60`、bge `DefaultDimension/MaxSequenceLength=512` + `last_hidden_state`、`SemanticGuard GuardCosineThreshold=0.85f`（`CandidatePicker.cs:21/:68`）、`PlanModeFilter MaxConsecutiveFailures=3`（`:14`）、`AutoRewriteEngine` 重写循环 `attempt<=MaxRewriteAttempts`（`:218`）、`FileBasedVectorIndex` int8 量化 `(sbyte)quantized[i]*Scale`（`:239/:287`）、首次描写阈值 `EntityFirstChapterIndex.cs:25 _threshold=0.5`、N-gram `NGramScorer.cs:18-19 SmoothingK=0.01/TrigramLambda=0.6`、类别配额 `PickByCategoryQuota`。**该层不是 findings 复读，是实测属实。**

---

## 2. 架构与依赖地图（Modules → Services → Framework ← Core，SK 从哪进来）

天命是分层单体，依赖方向是 **Core 装配一切，业务向下依赖 Framework**，但被全局 `ServiceLocator` 反模式打穿（`ServiceLocator.cs:15`）。

```
Core/            应用装配层（最顶）
  App/Bootstrap/DependencyInjection.cs   ~400 行手写 DI：约200服务全 Singleton + ServiceLocator.Initialize(:406)
  Capabilities/CapabilityServices.cs     provider 能力探测 + DefaultPipeline 静态 Lazy

Modules/         业务模块（UI VM + 规划管线）
  Design/Templates/OneClickGenerate/...  10步规划管线 orchestrator
  Design/SmartParsing/{BookAnalysis,ContentRefinery}  拆书 + 回流
  Generate/Elements/Chapter/...          章节区间分配
  Validate/...                           统一校验看板 + ChapterRepairService

Services/Framework/AI/SemanticKernel/    ★SK 从这里进来★
  SKChatService(.partial 跨8文件)         KernelBundle 缓存 / Adaptive流式 / Polly
  SKChatService.KernelManagement.cs       BuildKernel(:89) + RegisterPlugins 6插件(:308)
  PlanModeFilter.cs                       ★统一工具拦截层★ 白名单+熔断(3次)+确认门+事件
  Agents/NovelAgent.cs                    ChatCompletionAgent 薄包装（非 Planner）
  Plugins/AutoRewriteEngine/             逐章 生成→门禁→自修→人工介入 闭环
  Plugins/LayeredPromptBuilder/          分区 XML prompt 组装

Services/Modules/ProjectData/Implementations/   ★状态机本体★
  Guides/GuideContextService             写前读取（解引用+快照+归档+召回）
  Generation/GenerationGate              六道门禁
  Generation/ContentGenerationCallback   事务化回写(WAL+staging+commit)
  Tracking/{CharacterStateService,LedgerConsistencyChecker,...}  15维账本+8不变量

Framework/       通用底座（最底）
  Common/Services/{ServiceLocator,ModuleServiceBase}
  UI/Workspace/Services/{TodoExecutionService,...}  多章顺序驱动
```

**SK 进入点单一**：`BuildKernel` 是唯一建 Kernel 处，`RegisterPlugins` 注册 6 插件 + `PlanModeFilter`。**反面教训**：所谓 `AIRequestPipeline` 7 个 middleware 大多退化成 telemetry marker，真正的重试/降级/key 轮换/流式回退控制流全 hand-coded 在 1500+ 行巨类里（40+ 处 `RunStageAsync`），是「伪管道」。

---

## 3. 值得借鉴的精妙技术清单（按对 StoryForge 价值排序）

| # | 技术 | 天命证据 | 价值 / 对 StoryForge 借鉴 |
|---|------|---------|---------|
| 1 | **CHANGES 结构化变更协议 + 系统预填骨架** | `TrackingChangeModels.cs:117-146`、`LayeredPromptBuilder.Changes.cs:280-360` | 直击 Q1。把「事实自洽」从语义降级为机械校验；预填骨架天然约束模型能改哪些实体 |
| 2 | **deterministic 不变量硬 gate + 语义判断 advisory 分层** | `GenerationGate.PublicMethods.cs:87-288`、`UnifiedValidationService.Validation.cs:18-59` | 正中设计立场；StoryForge `verdict.py` 已有原语（但 test-only），缺的是不变量广度 + 接线 |
| 3 | **名称→ID 归一化 + 伪造 ID 剔除 + 同名幂等铸造** | `ChapterChangesCanonicalizer.cs:30-635`、`GenerationGate.PublicMethods.cs:487-501` | 多 agent 共享状态不串味前提；StoryForge `name_registry` 只做 dedup + caller 自带 id，**无 ID 铸造** |
| 4 | **WAL + staging 两阶段提交 + 启动对账重放/回滚** | `ContentGenerationCallback.Core.cs:273-477`、`ConsistencyReconciler.cs:118-179` | 长程跑批中任一章中断不留半写；StoryForge 回写需 applied-or-replayable 保证 |
| 5 | **每章相关性在打包期冻结为 ContextIds manifest** | `ContextIdCollection.cs:8-27`、`GuideContextService.ModuleExtractors.cs:400-457` | 「状态进 DB 不进 context」最干净落地；但 StoryForge 落地是**净新增子系统**（见 §4.6） |
| 6 | **有界自修 + 定向反馈 + 范围化重写 + 耗尽转人工** | `AutoRewriteEngine.PublicMethods.cs:218 / :691-705` | 「逐章 Critic 自修」参照；StoryForge `novel_loop` 已有骨架（max_repairs→awaiting_review），缺范围化分流 |
| 7 | **顺序提交硬熔断 tripwire** | `TodoExecutionService.cs:202 / :221-227` | StoryForge `book_loop` 已有 barrier 停批（`book_generation_parallel` 已 wire），需把硬不变量塞进去 |
| 8 | **多路召回 RRF 融合 + 类别配额 + 粗到细两级** | `WriterPlugin.LongDistanceRecall.cs:201-204 / :260`、RRF k=60 `GuideContextService.cs:106` | 配额机制比纯 topK 更保伏笔召回率；StoryForge 用 pgvector + 全文 + 实体命中可复刻 |
| 9 | **多分辨率状态压缩 + token 预算分级降级阶梯** | `GuideContextService.ModuleExtractors.cs:459-538`、`AutoRewriteEngine.PrivateMethods.cs:44 DegradeContext` | scale-by-size 注入预算；降级阶梯次序暴露价值排序（正文计划>设定>近期摘要>跨卷状态>向量召回） |
| 10 | **同构子任务接口 `IPipelineBatchTarget` + 瘦 orchestrator** | `IPipelineBatchTarget.cs`、`PipelineExecution.cs:157` | 对应「中央 orchestrator + 子 agent」；orchestrator 对 Planner/Writer 一视同仁 |
| 11 | **声明式 profile 表 + 统一工具拦截层（白名单+连续失败熔断+确认门+事件）** | `ModeProfileRegistry.cs:14-123`、`PlanModeFilter.cs:67 / :131-152 / :14 MaxConsecutiveFailures=3` | 「谁能用什么工具」集中可测；3 次连续失败熔断是 tripwire 最小实现 |
| 12 | **Plan 阶段不调模型，从结构数据确定性拼装计划** | `PlanModeMapper.cs:111 TryBuildPlanWithoutModelAsync` | 「结构批完放跑」：逐章 plan steps 从 DB 读，省 token、可复现、避免每章重规划漂移 |
| 13 | **语义守卫（改写前后局部窗口 cosine<0.85 回退原文）** | `SemanticGuard.cs`、`CandidatePicker.cs:21 GuardCosineThreshold=0.85f / :68` | 防 Reviser「改着改着改跑题」；便宜、可量化、可做硬 gate 的防漂移不变量 |
| 14 | **依赖版本盖章 + DAG 陈旧检测** | `VersionTrackingService.cs:134-167`、`DependencyConfig.cs:9-29` | 结构改动后只重生成受影响子树，是 orchestrator 增量重规划依据 |
| 15 | **Provider 能力自探测 + 持久化缓存 + native→prompt-tool 降级 + max_tokens 探测阶梯**（草稿漏列） | `CapabilityServices` DefaultResolver、`model_discovery_cache.json`、`SKChatService.cs:327-332` 端点能力静态缓存 | StoryForge 多 provider（mimo 等），`apps/workflow provider_adapter` 正需要这套探测/降级，避免每次重复试错 |

---

## 4. 逐条映射到 StoryForge Desktop Agent orchestrator（已重锚 live 路径）

> 格式：天命怎么做 → StoryForge **真实基线（live/test-only/缺失）** → 怎么落（含**前置接线**）。

### 4.1【快照 + Writer + Q1 核心】先把真·逐章抽取接进 live，再叠加实体状态 CHANGES
- **天命**：Writer 写完正文输出 12 类 `<chapter_changes>`，系统预填骨架 → canonicalize（名称→ID/剔伪造/幂等铸造）→ 写 15 维账本（`TrackingChangeModels.cs:117-146`、`ChapterChangesCanonicalizer.cs:30-635`、`CharacterStateService.cs:83-133`）。
- **StoryForge 真实基线（纠正草稿）**：
  - `current-phase.md:98` 的根因「真实逐章事实抽取替换**写死抽取**」，被替换的是 **live 路径里的写死/启发式抽取**——即 `deterministic_judge_fallback` 的 demo 反义模板（`deterministic.py:53-56`）与/或 `narrative_gate._chapter_template_fact`（`source="narrative_fact_heuristic"`）；**不是** `extract/prompt.py`。
  - `extract/prompt.py`（`build_narrative_fact_extract_prompt:8`）恰恰是一个**真·LLM 抽取 prompt 构造器**（输出 `primary_scene_mode/action_sequence/conflict_type/cost/relationship_delta/irreversible_consequence/clue_usage_mode/...` 等**场景工艺**字段，`:27-38`），但**全仓无 live 调用方（test-only）**。它是「真·逐章抽取」的**替换件候选**，不是被替换对象。
  - 草稿关于「StoryForge 现有抽取是场景工艺、非实体状态」的**正交观察成立**（`extract/facts.py` 的 `NarrativeSceneFact` 确为工艺维），错只在指错了「写死抽取」的文件。
- **怎么落（分两层，别混为一谈）**：
  1. **Q1 根因（先做）**：把一个真·逐章 LLM 抽取（可直接复用 `extract/prompt.py` 脚手架）**接进 live `_judge_and_repair_loop`**，替换 `deterministic_judge_fallback` 的 demo 模板；同步**收紧 local-gate 空转**（`book_generation_judge.py:197-211`，别让「有 required_facts 覆盖」就给 100 分）。这才是 current-phase 根因项的一对一兑现。
  2. **CHANGES 实体状态（在 Q1 之上扩展）**：新增与场景工艺正交的「实体状态 CHANGES」schema（角色态/位置/物品/伏笔 setup-payoff/冲突状态/承诺-倒计时），prompt 要求模型只在 orchestrator 预填的骨架上改值，骨架由 API `continuity`/`character_bible`/`story_memory` 当前状态生成。**不要宣称「CHANGES 提案 == current-phase 根因项」**。
  3. **落库的可复用面有限（纠正草稿）**：`edge_constraints` 只能吸收 CHANGES 的**关系/时间边子集**（`relationship`/`timeline_order` 成环 + `status` 时间窗，`edge_constraints.py:18/:228`）；角色等级/能力/信任(V3)、伏笔三态(V1)、物品持有(V5)、承诺/倒计时(V7/V8)这些**节点状态机**不是边问题，需 §4.2 的 net-new `state_ledger`。

### 4.2【门禁】补节点状态机不变量集（net-new），与现有图引擎互补
- **天命**：`LedgerConsistencyChecker` V1-V8 全确定性账本不变量。
- **StoryForge 真实基线（纠正草稿的「只有 1 条」低估）**：确定性能力分散在多处——
  - **live**：`deterministic_judge_fallback`（薄，demo 调参）；`narrative_gate`（整本套路章，regression-only）；`edge_constraints`（图可达性查环 + 状态时间窗，**唯一较强的 live 确定性引擎**，在 continuity 域）。
  - **test-only 组件**：`timeline_ledger`（1 条 availability 不变量）、`entity_budget`（阶段门 ch20/25/30 + 数量预算，`entity_budget.py:26-62`）、`name_registry`（dedup + 单用途线索人物 audit，`:75-90`）、`repetition_ledger`（母题/动作重复门）、`beat_sheet`（节拍门）、`forbidden_terms`（系统词门）、`collapse_judge`（场景工艺塌缩 hard/soft）。
- **怎么落**：**不要照抄天命扁平字符串比较**（对重名/异域设定脆弱），保留 StoryForge `edge_constraints` 图模型优势，**新增** `state_ledger`（伏笔三态机、承诺/倒计时终止动作去重、等级单调、物品持有），与图检查互补；这些不变量**必须由 4.1 的逐章实体状态 delta 喂数据**。门禁聚合：因 `gate_harness.py` 是 test-only，**真实工作量是「接线」**——把状态门挂进 live `_judge_and_repair_loop`（或 `precommit_chapter`），而非「扩 `gate_harness`」（扩了对 live 无影响）。

### 4.3【门禁 + Critic】hard gate 阻断 vs advisory 评分严格分层
- **天命**：六道门禁全确定性、阻断；十规则 LLM 评分 advisory、只进看板，且明确「别重复检查门禁已抓到的确定性问题」。
- **StoryForge 真实基线**：live 已**天然分层**——`deterministic_judge_fallback` 是确定性、`semantic_judge_with_status` 是 LLM advisory（`book_generation_judge.py:196/:219`）；`verdict.py` 原语（hard/soft + revision_strategy，test-only）可在接线时复用。
- **怎么落**：硬 gate 用 §4.2 的状态不变量（接进 live）；Critic 的 LLM advisory 用**已 live** 的 `semantic_judge_with_status`（不是新建 HTTP 集成），但要**澄清其职责**：评 `narrative_gate`/确定性门覆盖不到的**语义维**（风格/逻辑顺滑/人物口吻），**不重复**塌缩判定（塌缩是确定性的）。把硬 gate 已抓到的问题显式排除出 LLM 评审范围（省 token + 避免 LLM 在确定性问题上瞎判）。

### 4.4【Reviser】有界自修按 revision_strategy 分流 + 耗尽转人工
- **天命**：`AutoRewriteEngine` 3 次上限、结构化 failure 定向重写、`IsChangesOnlyFailure` 时只重生 CHANGES、耗尽 → `RequiresManualIntervention`。
- **StoryForge 真实基线（纠正草稿「缺有界重试」）**：**live 的 `novel_loop.run_single_chapter_loop` 已有**有界 judge→repair 循环（`max_repairs` 默认 1，`novel_loop.py:135/:155-221`），高严重度静态问题 → `awaiting_review`（`:157-159`），耗尽 → `awaiting_review`（`:223-231`）——「有界自修 + 耗尽转人工」骨架已在 live；`collapse_judge` 的 issue 已带 `revision_strategy`（test-only）。
- **怎么落**：补的是**分流粒度**——把判定结果按 `revision_strategy` 路由（纯状态错只重跑事实抽取那一步、不重写正文；字数错走另一路），对照天命 `IsChangesOnlyFailure` 省 token；`novel_loop` 已把耗尽映射到 `awaiting_review`，对齐 §4.5 停批语义即可。注意：当前 live repair 由注入的 `repair_scene`/`judge_scene` 驱动，分流逻辑要落在这层而非 test-only 的 narrative gate。

### 4.5【orchestrator + tripwire】扩展现有 arc barrier，而非填空钩子
- **天命**：`TodoExecutionService.StartSequentialRun` 顺序执行，任一章自修耗尽即 break 整批，`ManualInterventionRequiredException` 不重试。
- **StoryForge 真实基线（纠正草稿「空钩子」）**：**已 wire 的 live** `consistency_barrier` + `precommit_chapter`——`book_generation_parallel.py:163/:166` 是参数，`precommit_chapter` 实现于 `:274`（内跑 `_judge_and_repair_loop` + `_finalize_scene_decision`），`_arc_consistency_barrier_from_blueprint` 于 `:490` 构造 `ArcConsistencyBarrier`，`:333/:344-345` 注入 `run_book_loop_with_thread_sessions`。当前 barrier **只校验 arc 连接/完成率**（从 blueprint `planning_summary.chapter_arc_links` + `arc_completion_ratio`，无规划则 `return None` 放行）。
- **怎么落**：建议改为「**把 §4.2 的硬状态不变量扩进现有 `_arc_consistency_barrier_from_blueprint`/`ArcConsistencyBarrier`**」，而非「接进空钩子」。把「可重试瞬时错」与「需人工的硬错」分开（天命 `ManualInterventionRequiredException` 不重试这点要抄）。

### 4.6【数据中心 + Planner】每章 ContextIds manifest = 净新增子系统（不是接现成件）
- **天命**：打包期 `BuildBlueprintGuideAsync` 把蓝图引用解析成稳定 ID 清单并冻结，name→ID 失败抛错阻断（`GuideIndexBuilder.GenerationGuides.cs:481-488`）。
- **StoryForge 真实基线（纠正草稿「plan.locked 是天然落点」）**：
  - `NarrativePlan.locked` **不是冻结基础设施**：它是个 frozen dataclass 布尔字段（`plan.py:202`），仅序列化（`:220/:229`）。**唯一消费点**是 dispatch 前置校验 `book_run_adapter_payload.py:60`（`narrative_plan.get("locked") is not True → raise`，由 `book_run_adapter.py:75` 调用）——即一个**布尔放行门**，**不携带任何冻结/manifest 语义**。
  - `ChapterBeat`（`plan.py:126-160`）**没有 `context_ids` 字段**；`NarrativePlan`（`:187-202`）是 frozen dataclass，**无写库路径**（全是 `from_dict`/`compact_summary`）。
  - StoryForge **缺一个可解析的稳定实体 ID 库**：`EntityRef` 只有 `display/aliases`（`plan.py:11-23`），`name_registry` 由 caller 自带 `identity_id`、**不铸造 ID**。
  - 当前 scene_packets 是**请求驱动**：`assembly.load_active_assets` 用调用方传入的 `payload.active_asset_ids`（`assembly.py:11-14`），无冻结 manifest。
- **怎么落（点明前置）**：这是**新建子系统**，依赖三件 StoryForge 目前没有的东西：(a) `ChapterBeat` 加 `context_ids` 字段；(b) `NarrativePlan` 的持久化层；(c) 稳定实体 ID 库 + name→ID 解析器（含幂等铸造，对照天命 `ShortIdGenerator.NewDeterministic`）。建成后：Planner 在 locked 前为每个 `ChapterBeat` 预解析 `context_ids` 写库 + 一道**引用完整性 tripwire**（任一章引用不存在 id 即 fail-fast，在烧 token 前拦截）；Writer 改为从冻结 manifest 读 `active_asset_ids`。**节拍层结构门可直接复用现成 `beat_sheet.BeatSheetGate.validate(plan)`**（test-only，需接线）——对应天命蓝图「起承转合」硬门。

### 4.7【快照 + scale-by-size】状态注入分层 + 相关性截断 + 降级阶梯 + 裁剪取舍
- **天命**：写前注入 = 前章尾段 + 近窗逐字摘要 + 里程碑锚点（O(近窗+锚点)）+ 15 维快照（按 ContextIds 过滤）+ 前卷归档（focus-id 裁剪）+ ≤5 段召回；超窗 `DegradeContext` 逐层剥离（向量召回→首次描写→里程碑→归档→摘要→任务层）再硬停。
- **StoryForge 借鉴**：StoryForge「状态进 DB」比天命「状态进文件」更干净（按 id 精确 SELECT），但同样面临「无界状态压进有界 prompt」。`prompts/_continuity_budget.py`、`prompts/context.py` 有预算雏形；`retrieval` 域有 embedding/reranker client。
- **怎么落 + 必须直面的取舍**：把「分辨率随距离衰减 + 逐层降级」做成可配置预算（近 K 章逐字、更早只取弧线锚点；按 `ChapterBeat` context_ids 只 SELECT 相关实体最新状态；超预算按显式价值阶梯降级并把降级日志作为可观测信号反哺导引抽查）。**但要正面权衡天命的「裁了就召不回」**（草稿只在 §6 提了一句）：天命 `Importance` 分级 + `LedgerTrimService` 会裁掉 normal 重要度的历史，跨千章回收当年标 normal 的小伏笔时账本可能已无该切片。StoryForge「DB 选择性投影」必须为此设计**「本章 CHANGES 涉及但未注入」的强制兜底拉取**，否则相关性截断会让旧实体逃过一致性校验（天命最大的规模化裂缝，见 §6.1）。

### 4.8【数据中心/检索】多路召回 RRF + 类别配额 + 语义守卫 + 重复门
- **天命**：BM25 + 关键词 + 向量三路 RRF(k=60) 融合，按伏笔/角色/通用配额取章；改写前后局部 cosine<0.85 回退原文；`DetectContentRepetition` 专项重写。
- **StoryForge 借鉴**：用 `apps/api/app/domains/retrieval`（`embedding_client.py`/`reranker_client.py`）+ pgvector。
- **怎么落**：为 Writer 备料时同时跑 pgvector 相似 + 全文检索 + 实体 id 精确命中，RRF 融合 + 配额（保证未回收伏笔不被高分通用挤掉）；Reviser 每次 patch 落地前加嵌入守卫（patch 前后段落 cosine 低于阈值就拒绝并记 advisory）。**天命重复检测 → StoryForge 已有 `repetition_ledger`**（草稿漏列的最现成对照）：policy 驱动，`record_motif`(left_arm_old_injury>5 即 fail，`repetition_ledger.py:50`)、`record_action_pattern`(save/encrypt/sync>3 即 fail，`:78`)——直接对应天命 contentRepetition 专项重写，**需接线**到 live。

### 4.9【quota gate】实体预算 + 阶段门（StoryForge 已超前，补天命「分级容忍」）
- **天命**：未知实体>5 或龙套>3 才 fail；缺席>max(3,总数/3) 才 fail；漏报按维度分级 AutoPatch（出场类自动补）vs WarnOnly（状态迁移类只告警不伪造）。
- **StoryForge 真实基线**：`entity_budget.EntityBudgetGate.validate` **已实现**阶段门（ch20+ 禁新地点、ch25+ 禁新谜题、ch30+ 禁新设备/证据 + 数量预算，`entity_budget.py:26-62`），`name_registry.audit` 已做单用途线索人物 warn——这块设计上不弱，**但同样 test-only，需接线**。
- **怎么落**：补**分级容忍**——别让 tripwire「任一违规即停」，区分功能性违规（熔断）与背景噪声（warn 放跑）；把漏报检测的 AutoPatch/WarnOnly 分级用到 Critic：出场类漏报自动补，状态迁移类只标记待人工，绝不让 Critic 编造状态值污染事实源。

### 4.10【可观测】事件溯源 telemetry + 依赖版本陈旧检测 + Provider 能力探测
- **天命**：`RequestLifecycleCollector` 按 runId 聚合 ttfb/tokens/toolcalls/retry/fallback/熔断（`RequestLifecycleCollector.cs:19-31`）；依赖版本盖章 + DAG 陈旧检测；Provider 能力自探测 + 持久化缓存 + native→prompt-tool 降级。
- **StoryForge 借鉴**：已有 `agent_runs/event_sink.py`/`event_types.py`/`trace.py`、`/metrics` 业务计数器。
- **怎么落**：一条事件总线聚合每 run 执行轨迹作为 tripwire 判定输入 + 导引抽查驱动；结构改动后用依赖 hash 比对只重生成受影响章节（Planner 增量重规划依据）；**`apps/workflow provider_adapter` 接多 provider（mimo 等）时落地天命的能力探测/持久化/降级阶梯**（草稿漏列的高相关项）。

---

## 5. 天命 vs StoryForge 现状的差异与启示（已据 live 真相重写）

### 5.1 Context 纪律：天命「有界状态注入」，StoryForge 应是「DB 选择性投影」——降级阶梯 + 兜底拉取这一课必须学
天命 README「完全不依赖上下文窗口/写到 3000 章仍连贯」是**过度宣称**：代码恰恰显式按 `ContextWindow` 估 token、`DegradeContext` 分级降级、降到底硬停转人工。真相是「不把历史正文堆进窗口，改注入压缩状态快照，但每章 prompt 仍须塞进窗口」。

**启示**：StoryForge「状态进 DB」立场比天命「文件全量加载」更干净，但要吸收两个教训：①「不依赖窗口」是幻觉——单章 prompt 仍随相关实体/未回收伏笔密度膨胀，必须有显式预算 + 降级阶梯（§4.7）；②天命默认 ledger keep-recent 几乎不裁，高密度章节仍触发降级——StoryForge 要把注入上限设成**真会生效的有界值**，并对「本章 CHANGES 涉及但未注入」的实体做**强制兜底拉取**，否则相关性截断会让旧实体逃过一致性校验。

### 5.2 门禁广度：StoryForge 不是「啥都没有」，而是「组件多已存在但未接线 + 不变量集偏薄 + live 判定 demo 调参」（重写，纠正草稿低估）
双方都认同「确定性不变量做硬 gate」。StoryForge 的 `edge_constraints.py` 图可达性查环（`:72/:98`）在原理上**优于**天命的扁平字符串比较（天命 V4 移动链、V6 关系矛盾都是 flat 比较，对重名/链式传递脆弱）。

但真实差距不是草稿说的「只有 1 条时间账本不变量」。完整盘点 StoryForge 已有门禁资产：
- **live**：`deterministic_judge_fallback`（薄、demo 调参）、`narrative_gate`（整本套路章 + 假阳性护栏，regression-only，`golden_regression.py` 做确定性回归）、`edge_constraints`（图 + 状态时间窗，唯一较强）、`semantic_judge_with_status`（LLM advisory）。
- **test-only（组件齐但未接线）**：`collapse_judge`(hard/soft + revision_strategy)、`entity_budget`(阶段门+预算)、`name_registry`(冲突门+audit)、`timeline_ledger`(1 不变量)、`repetition_ledger`(重复门)、`beat_sheet`(节拍门)、`forbidden_terms`(系统词门，含「测试」直命中 DoD 硬失败项「测试痕迹残留」)、`verdict`(原语)。

**真实结论**：组件覆盖面其实不弱（甚至比草稿想象的全），**核心债是三条**——(1) 多数门禁 test-only **未接线**；(2) 不变量集**偏薄，尤其缺逐章实体状态机**（节点状态机 V1/V3/V5/V7/V8 类没有 live 实现）；(3) live 判定 `deterministic_judge_fallback` **demo 调参过薄** + local-gate 空转。天命的价值不在「广度碾压」，而在**已把这些做成熟并真正接进生成回路**。

### 5.3 CHANGES = 状态提取，是 Q1 的「扩展层」而非「等价兑现」（重写）
`current-phase.md:88-98` 的重跑 DoD 要求零硬失败（时间线矛盾/测试痕迹残留/缺章/结尾未收束/未回收伏笔任一即退回）。30 章退回阻塞里「17/18 章时间线冲突、线索膨胀、人物称谓混乱」**全是实体状态层问题**，正是天命 CHANGES + 账本不变量直接解决的类别。

**但要分清两层（纠正草稿的一对一宣称）**：
- **Q1 根因兑现 = 把真·逐章 LLM 抽取接进 live 门禁，替换写死/启发式抽取 + 收紧 fast-judge 空转**（`extract/prompt.py` 脚手架现成可用，但 test-only 待接线；live 待替换的是 `deterministic_judge_fallback` demo 模板）。
- **CHANGES 实体状态 schema = 在 Q1 之上的正交扩展**（场景工艺 vs 实体状态）。

落地最稳路径仍是抄天命三件套：①固定 schema 的状态变更对象（别让 LLM 自由产 fact 列表）②系统用 DB 当前状态预填骨架，模型只改值 ③canonicalize（名称→ID、伪造剔除、幂等铸造）后过确定性不变量再 WAL→DB 事务写回。称谓混乱用 `name_registry` + **新增**幂等 ID 铸造解决；线索膨胀用 `entity_budget` 阶段门 + CHANGES 伏笔 setup/payoff 配对解决；时间线冲突用 `edge_constraints` 状态时间窗 + 新增 `state_ledger` 时间序解决。**组件大多已在，缺的是把 CHANGES 这条数据管线打通并接进 live。**

### 5.4 orchestrator 形态：天命「规划一键 + 正文逐章」，无单一 runaway loop——与 StoryForge「结构批完放跑」一致，且 StoryForge 已更成熟
天命没有把 3000 章自动跑完的单一循环（顺序批 ≤500 章/次，任一章硬失败即熔断）。StoryForge `book_loop` 的 sequential/parallel + 已 wire 的 `_arc_consistency_barrier` + `precommit_chapter` + budget/provider 降级暂停**已经是更成熟的同款骨架**。差异在天命用 `IPipelineBatchTarget` 让 orchestrator 对所有步骤一视同仁——StoryForge 可借此把 Planner/Writer/Critic/Reviser 实现成统一契约（execute / prereq-check / confirm-commit），让中央 orchestrator 零业务逻辑。

### 5.5 工程纪律的反面教训
天命「伪 middleware 管道」（控制流仍 hand-coded 在 1500 行巨类）、`ServiceLocator` 服务定位反模式、进程内静态字典做能力降级、单 `SKChatService` 有状态单例（`_currentMode` 等可变字段竞态）——**都是 StoryForge 设计中央集权 orchestrator 时要主动避免的**。要么让中间件真正拥有控制流（责任链），要么明确它只是观测层，不要两头不靠。**StoryForge 自身的对应风险**：test-only 门禁层若长期不接线，就会变成新的「legacy 死路」（与 MEMORY 的 agent live/legacy 教训同型）——要么接线，要么明确标注弃用。

---

## 6. 天命的局限 / 风险（StoryForge 借鉴时要绕开的坑）

1. **相关性截断削弱规模化一致性（最严重）**：快照按 `SnapshotMaxXInject` 上限注入，`LedgerConsistencyChecker` 对「注入快照里不存在」的实体直接 `continue` 跳过。相关旧实体没被选中注入，该章对它的矛盾就检测不到。「3000 章连贯」依赖相关性筛选恒选中真正相关的旧状态——**强假设**。StoryForge 用 DB 可缓解（按 id 精确拉取），但必须对「本章 CHANGES 涉及但未注入」的实体强制兜底校验（§4.7/§5.1）。
2. **CHANGES 自报是唯一真值源，正确性 ≠ 正文事实正确性**：整条链校验「声明的 JSON 之间/与账本是否自洽」，无法保证正文真写了声明的事（模型可正文写 A、CHANGES 报 B，只要 B 自洽就蒙混）。漏报检测只按实体名字符串匹配正文，易被改名/指代/错别字绕过。**账本可能与正文渐行渐远而门禁全绿。**
3. **名称→ID 解析对重名脆弱 + 确定性 ID 按小写名作 seed 会碰撞**：同名映射到不同 ID 即标 ambiguous 移除；两个真正不同但同名的物品会被铸造成同一 ID 误并（`ChapterChangesCanonicalizer.cs:936-947`）。StoryForge 若建 ID 库要用全局唯一 seed，别用名字。
4. **语义检查全是字符串/正则/反义词字典，无语义理解**：发色矛盾靠「金发」字面邻近黑发名，世界观约束靠负向词+10 字窗口，极易漏报（换说法）和误报（反讽/引用）；非常规修炼体系/自造状态词会绕过等级回退检测。
5. **向量检索内存全量暴力点积，无 ANN/HNSW**：3000 章段级向量上十万级时召回延迟存疑，仓库无基准证据；BM25 每次遍历所有 md 逐块算分，O(全书)。StoryForge 用 pgvector + ANN 可绕开。
6. **跨章叙事矛盾是「前置预防」非「事后检测修复」**：一旦某章带错误状态通过门禁（或人工导入未走门禁），没有任何模块回头扫已写章节发现并修复彼此矛盾——README 暗示的「自动发现并修复跨章矛盾」在代码里不存在。
7. **持久化是单进程文件方案，非多写者安全**：原子性只到单文件级，跨文件多状态写无事务，靠重启 reconciler 兜底；版本号纯内存异步回写。StoryForge 若多 agent 并行写同一状态源，**不能直接照搬文件级提交，需用 DB 事务/乐观锁**。
8. **README 系统性过度包装**：「完全不依赖上下文窗口/3000 章仍连贯/一键直出整书/middleware 管道/四层 Planner」均与代码有出入；真实成立的是较弱但扎实的命题：「状态落盘 + 按 ContextIds 有界注入 + 确定性硬 gate + 有界自修 + 数据层对账」。**取经要取真实机制，不取宣传话术。**

---

## 7. 校核意见逐条处置（要么补证据，要么标「未坐实」）

### 7.1 unsupported_claims（草稿过度宣称）

| 校核项 | 处置 | 证据 |
|---|---|---|
| plan.locked 当成已有冻结基础设施 | **采纳并精修**：locked 是 frozen dataclass 布尔字段，但**有一个 live 消费点**（dispatch 前置 `raise if not locked`），无冻结/manifest 语义 | `plan.py:202`；`book_run_adapter_payload.py:60`（raise）；`book_run_adapter.py:75`（调用）；ChapterBeat 无 context_ids `plan.py:126-160` |
| 把 `extract/facts.py`+`prompt.py` 当「写死抽取」 | **采纳**：`prompt.py` 是真·LLM 抽取脚手架（非 hardcoded）且 test-only；live 写死在 `deterministic_judge_fallback` + `narrative_gate` 启发式 | `extract/prompt.py:8`（LLM prompt builder）；`deterministic.py:53-56`（demo 模板）；`narrative_gate.py:161`（`narrative_fact_heuristic`） |
| §5.2「只有 1 条时间账本不变量」系统性低估 | **采纳**：补全 entity_budget/name_registry/repetition_ledger/beat_sheet/forbidden_terms/collapse_judge + live narrative_gate/golden_regression（见 §5.2） | 各文件 file:line 见 §5.2 |
| §4.5 把 barrier/precommit 当空钩子 | **采纳**：已 live wire | `book_generation_parallel.py:163/:166/:274/:333/:490` |
| 天命召回/嵌入数值未独立核实 | **已抽验为真**（见 §1.10 抽验结论），非 findings 复读 | `GuideContextService.cs:106`、`BgeSmallZhEmbeddingService.cs:18-19/:271`、`CandidatePicker.cs:21`、`PlanModeFilter.cs:14`、`NGramScorer.cs:18-19`、`EntityFirstChapterIndex.cs:25` |

### 7.2 missing_coverage（草稿漏项）

| 漏项 | 处置 | 落点 |
|---|---|---|
| `repetition_ledger` → 天命 contentRepetition | **已补** §4.8、§5.2、技术表 | `repetition_ledger.py:50/:78` |
| `forbidden_terms` → 天命世界观负向门 + DoD「测试痕迹残留」 | **已补** §4.2、§5.2、§5.3 | `forbidden_terms.py:9-21/:52` |
| `beat_sheet.BeatSheetGate` → 天命起承转合结构门 | **已补** §4.6 规划层落点 | `beat_sheet.py:10-87` |
| live `narrative_gate` + `golden_regression` | **已补**（含正确 liveness：regression-only，非 live 逐章），§0.4、§5.2 | `narrative_gate.py:70-120`、`golden_regression.py:18-37` |
| 天命 Provider 能力探测/降级 | **已补** 技术#15、§4.10 | `CapabilityServices`、`SKChatService.cs:327-332` |
| Importance 分级 + LedgerTrim「裁了就召不回」取舍 | **已补** §4.7 正面权衡 + §6.1 | 天命 `LedgerTrimService`/`SnapshotMaxXInject` |

### 7.3 weak_mappings（草稿映射偏弱）

| 校核项 | 处置 |
|---|---|
| §4.1「复用 check_edge_constraints」只对 EDGE 成立 | **采纳**：§4.1.3 明确只吸收关系/时间边子集，节点状态机需 §4.2 net-new `state_ledger`，消除与 §4.2 自相矛盾 |
| §4.6 隐藏前置依赖 | **采纳**：§4.6 点明三件净新增前置（context_ids 字段 / plan 持久化 / 稳定 ID 库 + name→ID 解析），明确「新建子系统」 |
| §4.2/4.4/4.5 锚错 test-only 基座 | **采纳**：全部重锚 live 路径，§0 总披露 + 各节标「先接线」 |
| §4.3 假定 judge HTTP 集成 + 部分冗余 | **采纳**：§4.3 澄清用**已 live** 的 `semantic_judge_with_status`，且评语义维（非重复塌缩判定） |

### 7.4 must_fix（关键必改）— 全部已落实

1. **live-vs-脚手架披露**：§0 整节专述；§4/§5 全部重锚到 live（`book_loop` via `book_generation_parallel` + `_arc_consistency_barrier_from_blueprint` + `_judge_and_repair_loop`），test-only 项一律标「先接线」。
2. **纠正「写死抽取」指向**：§4.1、§5.3——Q1 根因 = 把真·逐章 LLM 抽取接进 live 替换启发式 + 收紧 fast-judge 空转；CHANGES 是其上扩展，非一对一兑现。
3. **plan.locked 不当作冻结基础设施**：§4.6——惰性布尔门（有 dispatch 消费点但无冻结语义），冻结 + 每章 manifest 是净新增 + 依赖缺失的稳定 ID 库。
4. **§5.2 门禁广度纠偏**：补全已有门禁清单，差距重述为「组件多已存在但未接线 + 不变量集偏薄（尤缺逐章实体状态机）+ live 判定 demo 调参」。
5. **承认已 live 的 barrier/precommit**：§4.5 改「扩展现有 arc barrier」；§4.1 澄清 edge_constraints 仅吸收边子集，节点状态机走 net-new state_ledger，消除冲突。

> **本轮未坐实/需后续核实**：天命 `LedgerConsistencyChecker` V1-V8 全部分支、`ContentGenerationCallback` 事务全步、`ChapterChangesCanonicalizer` 全归一化规则等**核心机制**本轮沿用草稿/findings 的 file:line（校核意见亦确认这些已在前序逐条 file:line 验证为真），未在本轮重新逐行复跑；如需作为实现蓝图，建议实现前再对照天命源码二次核验对应行号。StoryForge 侧所有 live/test-only 结论均为本轮 grep + 读码实测。

---

## 附：StoryForge 落地优先级建议（基于 live 真相）

1. **P0 = Q1 根因**：把真·逐章 LLM 抽取（复用 `extract/prompt.py` 脚手架）**接进 live `_judge_and_repair_loop`**，替换 `deterministic_judge_fallback` demo 模板；同步**收紧 local-gate 空转**（`book_generation_judge.py:197-211`）。这是 30 章退回阻塞与 current-phase.md:98 的直接根因解。
2. **P1 = 接线 + 补节点状态机不变量**：把 test-only 的 `entity_budget`/`name_registry`/`repetition_ledger`/`forbidden_terms`/`beat_sheet`/`collapse_judge` 挂进 live judge/precommit；**新增** `state_ledger`（伏笔三态、承诺/倒计时单调、等级单调、物品持有），与 live `edge_constraints` 图检查互补；硬不变量**扩进现有 `_arc_consistency_barrier_from_blueprint`**。
3. **P1 = 实体状态 CHANGES 数据管线**：固定 schema + 预填骨架 + canonicalize（**新建稳定实体 ID 库 + name→ID 解析 + 幂等铸造**）→ 喂 §4.2 不变量 → WAL/事务写回。
4. **P2 = 每章 ContextIds manifest（净新增子系统）**：`ChapterBeat` 加 context_ids + plan 持久化 + locked 时预解析 + 引用完整性 tripwire；Writer 改从冻结 manifest 读 `active_asset_ids`。
5. **P2 = 有界自修按 revision_strategy 分流 + 注入降级阶梯 + Provider 能力探测**（§4.4/§4.7/§4.10）。

---

## 附录：key_design_implications（机器提炼）

1. live-vs-脚手架是第一前提：StoryForge 整套 workflow narrative/ 门禁层(collapse_judge/extract/gate_harness/entity_budget/name_registry/timeline_ledger/repetition_ledger/beat_sheet/forbidden_terms/verdict/plan)经 grep 证实仅被 apps/workflow/tests 导入,是 TEST-ONLY 设计原语库;任何'扩 gate_harness/在 novel_loop 加 retry'的建议前置工序都是'先接线',否则对 live 零影响(同 MEMORY 的 agent live/legacy 死路教训)。
2. 真正 live 的逐章判定链是 book_generation._judge_and_repair_loop(book_generation.py:194/335, parallel:290) → deterministic_judge_fallback(judge/deterministic.py:11,薄且 demo 调参,写死 左臂受伤 反义模板) + local-gate 快路径(book_generation_judge.py:197-211,覆盖即给 100 分=fast-judge 空转) + semantic_judge_with_status(judge/semantic.py:97,LLM advisory)。改门禁只改这条链才生效。
3. current-phase.md:98 的'写死抽取'指 live 路径里的 deterministic_judge_fallback demo 模板/启发式,不是 extract/prompt.py;后者恰是未接线的真·LLM 抽取脚手架(场景工艺字段),是替换件候选而非被替换对象。Q1 根因=把真·逐章抽取接进 live + 收紧 fast-judge 空转;实体状态 CHANGES 是其上的正交扩展,不能宣称一对一兑现。
4. narrative_gate.py(_chapter_template_fact, source=narrative_fact_heuristic)是整本 book.md 导出后的套路章检测纯函数,经 30 章 CH3/4 真实调参且有 golden_regression 确定性回归护栏,但全仓只被 golden_regression+tests 调用,不在 live 逐章循环——表述应为'regression-gated 调过参的后置检查',不是'live 逐章门禁'(此处比校核意见更精确)。
5. plan.locked 不是冻结基础设施:它是 frozen dataclass 布尔字段,唯一 live 消费点是 dispatch 前置 raise(book_run_adapter_payload.py:60),无冻结/manifest 语义;ChapterBeat 无 context_ids 字段、NarrativePlan 无写库路径、EntityRef 仅 display/aliases、name_registry 由 caller 自带 identity_id 不铸造 ID。每章 ContextIds manifest 是净新增子系统,依赖 StoryForge 目前没有的稳定实体 ID 库+name→ID 解析器。
6. StoryForge 确定性引擎 edge_constraints(continuity 域,live,WITH RECURSIVE 图可达查环+状态时间窗)只覆盖关系/时间序/状态这类边问题;天命 CHANGES 大头是节点状态机(角色等级/能力/信任 V3、伏笔三态 V1、物品持有 V5、承诺/倒计时 V7/V8),不是边问题,须新建 state_ledger,且其数据必须由逐章实体状态 delta 喂活。
7. consistency_barrier/precommit_chapter 已 live wire(book_generation_parallel.py:163/166/274/333/490),当前 _arc_consistency_barrier_from_blueprint 只校验 arc 连接/完成率(blueprint planning_summary),建议是'扩展现有 arc barrier 纳入硬状态不变量'而非'接空钩子';novel_loop.run_single_chapter_loop 也已有有界 judge→repair(max_repairs 默认1)→awaiting_review 骨架,缺的是按 revision_strategy 的范围化分流。
8. 门禁广度差距不是'StoryForge 啥都没有':组件覆盖面其实不弱(8 个 narrative 门 + entity_budget 阶段门 + forbidden_terms 命中 DoD 测试痕迹项),真实债是三条——多数 test-only 未接线、不变量集偏薄(尤缺逐章实体状态机)、live 判定 deterministic_judge_fallback demo 调参过薄;天命价值在'已做成熟且接进生成回路',不在广度碾压。
9. 天命召回/嵌入/仿人化层数值已逐条抽验属实(RRF k=60、bge 512/CLS、SemanticGuard 0.85、MaxConsecutiveFailures=3、MaxRewriteAttempts 循环、int8 量化、首次描写 0.5、N-gram λ=0.6/k=0.01、类别配额机制),不是 findings 复读;可作为实现参考但实现前建议二次核验行号。
10. 规模化一致性最大坑(天命+StoryForge 共担):相关性截断让未注入旧实体逃过一致性校验(天命对未注入实体直接 continue 跳过),StoryForge'DB 选择性投影'必须为'本章 CHANGES 涉及但未注入'的实体设计强制兜底拉取,并正面权衡'Importance 裁剪→跨千章召不回'的取舍。
11. 可直接借鉴且 StoryForge 已有对照件的高杠杆项:CHANGES 协议+系统预填骨架(对 Q1)、WAL+两阶段提交+启动对账(对状态回写)、名称→ID 归一化+伪造剔除+幂等铸造(对多 agent 共享状态)、有界自修+耗尽转人工+范围化重写(对 Reviser)、统一工具拦截层(白名单+3 次连续失败熔断+确认门,对 tripwire)、Provider 能力探测+降级阶梯(草稿漏列,对 provider_adapter 接 mimo)。
12. 工程纪律反面教训:天命伪 middleware 管道(控制流 hand-coded 在 1500 行巨类)、ServiceLocator 反模式、有状态单例竞态都要避免;StoryForge 自身对应风险是 test-only 门禁层长期不接线会变成新的 legacy 死路,要么接线要么明确弃用。