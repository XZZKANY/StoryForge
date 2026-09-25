## 2026-09-25 Desktop UI/UX 原生 smoke 校准（子审查）

- 仅校准 `src-tauri/src/main.rs` 隔离 smoke 路径与 `smoke_ui.rs`：无项目 Explorer 隐藏、项目总览先行、真实可见导航、侧栏隐藏/恢复、总览往返节点身份；全部点击验证可见/禁用/窗口边界/命中，保留拒绝/漂移/接受/快照/版本安全断言。
- `node --test apps/desktop/scripts/native-smoke-ui.test.mjs`：3 passed；`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml smoke_ -- --nocapture`：5 passed，真实 Rust 编译通过。
- Target ESLint、Prettier、rustfmt (`skip_children=true`) 和 `git diff --check`：pass。未另跑全量 verify 或完整 Tauri smoke；父任务集成运行后记录结果，不能把单元测试当原生验收。
- 详细追踪：`.trellis/tasks/09-20-desktop-client-experience/research/patch-final-audit.md`；生产权限/健康客户端未修改，无 provider 调用及真实稿件访问。
- 后续几何审读加严：patch/diff 需包含于 Editor，底部留白沿用基线，100%恢复比较完整 Editor 矩形（均1px），拒绝动画/旧layout过早放行。新增回归先红后绿；Rust smoke_ **6 passed**，Node探针 **3 passed**，target rustfmt/diff-check通过；完整native再次由父任务运行。

## 2026-09-18 清理项目保护性废弃代码(第二批次:workflow 兼容遗留全清)

- 任务 `09-05-code-cleanup-quality` 第二批次。第一批次(四组孤立符号 + artifacts 异常收窄)已于此前落地;本批次翻转其 PRD「兼容 seam 保留」决定——历史消费方 `apps/workflow` 已于 2026-07-26 物理退役,全仓实证零生产消费方后用户拍板整链清除(范围=①workflow-dispatch 链+②record_workflow_model_run_payload 链;不含 ide 6 条零调用路由与 lineage_service)。
- **① workflow-dispatch 链**(desktop 前端零 fetch、顶层 e2e 零引用、13 个 dispatch alias + 4 个 gate alias 仓内零 import):
  - 整删 `book_runs/dispatch.py`(337 行)、`book_runs/gate.py`(143 行,唯一消费方是 dispatch,零独立测试,删后必孤儿化——非 live `book_generation*` 生成链成员,不触红线)。
  - `book_runs/router.py`:删 `GET /{id}/workflow-dispatch` 端点 + 2 处 import;`service.py`:删 dispatch/gate facade re-export(`_coerce` facade 保留,live `timeline`/`progression` 消费);`schemas.py`:删 `BookRunWorkflowDispatch/Chapter/PlanningRefs` + `BookRunVolumePlanItem`,**保留 `BookRunChapterRange`**(live `BookRunVolumeProgress`→PATCH progress 请求体消费)。
  - 整删 `tests/test_book_run_workflow_dispatch.py`(739 行专属测试)。
- **② record_workflow_model_run_payload 链**(生产代码零调用,仅 3 个专属测试在调):删 `recording.py` 实现 + 7 个孤儿私有 helper(`_require_positive_int` 等,其他模块各有独立同名局部函数,已逐一核对无跨模块引用)+ `service.py` wrapper/facade 转导出;保留 `create_model_run`/`record_runtime_model_run`/`record_failed_runtime_model_run`/`_validate_references`/`ModelRunError` 真表链路。删 `test_model_runs.py` 3 个专属测试。
- **护栏翻转 + 文档**:`test_source_pruning.py` 删「必须保留 record_workflow_model_run_payload」旧断言,新增 `test_workflow_compat_dispatch_and_payload_facade_stay_pruned`(文件不复活 + 源码标记归零 + 路由不重挂载,可证伪);`refactor-master-plan.md` B2/RT 段落加「2026-09 废弃清理更正」;任务 PRD/design/implement 已更新第二批次(PRD 记录决策翻转依据)。
- **契约**:`pnpm openapi` 刷新——paths −1(workflow-dispatch)、schemas −3,契约+生成类型纯删 379 行、零新增;过滤核对无非预期删除行。`workflow_nodes`(live ToolSpec 字段)与本链同名无关,未动。
- **验证**:
  - 定向 pytest 7 文件(source_pruning/model_runs/book_runs/writing_runs/source_code_standards/api_surface/job_runtime_bridge):**66 passed**。
  - 全量 `uv run pytest`:**1574 passed, 7 skipped, 0 failed**(基线 1592−15 删除用例−3 model_runs 用例=1574,精确对账,零回归)。
  - `uv run ruff check app tests`:All checks passed;`import app.main` 冒烟 OK。
  - `pnpm e2e`:**20/20 PASS**(含 OpenAPI drift + Phase 7 快照一致性);`pnpm --filter @storyforge/shared test`(tsc --noEmit)绿;`git diff --check` 干净。
  - 全仓检索 `build_book_run_workflow_dispatch|BookRunWorkflow*|record_workflow_model_run_payload|BookRunVolumePlanItem|book_runs.dispatch|book_runs.gate`:生产代码/测试/契约归零,仅剩护栏断言字符串与文档更正记录(预期)。
- **改动面**:14 tracked 文件(3 整删 dispatch.py/gate.py/test_book_run_workflow_dispatch.py + 11 修改),+56−1872,净删 −1816 行保护性废弃代码。
- 未做/不碰:安全护栏(限流/认证/写回/边界/快照/原子写)一行未动;`.pytest_full.log`/`.sf_tmp/` 等无关 untracked 按约定不动;`.trellis/` 在 gitignore,任务文档更新仅落盘。

## 2026-09-18 清理 .trellis WebView 缓存污染与历史 Prettier 漂移

- 背景承接 09-18 UIUX 收口时留下的两件遗留（任务 `09-18-clean-webview-cache-prettier-drift`）。
- **R1 缓存删除**：`.trellis/tasks/09-06-desktop-uiux-optimization/research/native-ui-20260906-192750/` 下的 `webview/`（34.8 MB EBWebView 缓存，lint 阻塞源）、`local-data/`（sidecar sqlite+wal 运行时库）、`config/`（空）为运行时生成物，全部删除；`sample/` 示例项目与顶层 60+ 审计文档/截图/日志（研究证据）保留。根因链：flat-config `eslint .` 不读 `.gitignore`，`.trellis/` 不在 `eslint.config.mjs` ignores 里 → 缓存里的 `adblock_snippet.js` 10 个错误短路 `pnpm lint` → `prettier --check` 从未执行。按既定方向删除源头而非加 ignore 遮蔽。
- **R2 格式修复**：`CommandPalette.tsx`（+14−5... 实为 3 处超 100 列折行）与 `ContextMenu.tsx`（1 处三元并回一行）用 `prettier --write` 修复。逐行核对全部 diff：零 token 变更，纯折行重排。定向测试 `command-palette.test.tsx` + `context-menu.test.tsx` 4/4 通过（exit 1 仅为 PowerShell 把 vitest stderr 的既有 act 警告升格为错误，测试本体全绿）。
- **验证**：
  - `pnpm.cmd lint`：**完整通过**（此前被 eslint 10 错误短路 + prettier 2 文件漂移）。
  - `pnpm.cmd verify` 后台首跑：lint / typecheck / shared / project-core / 前端 688 tests 全绿；**API pytest 阶段 `test_real_llm_connectivity_probe_script.py::test_interactive_acceptance_wrapper_probe_only_passes_with_local_provider` 失败**——隔离复跑该文件 10/10 通过、全量 `uv run pytest` **1592 passed / 7 skipped** 通过。定性：后台 pytest 与前台两次 vitest 并发抢本地端口的资源竞争 flake（该测试 spawn PowerShell 子进程探测本地 mock HTTP 服务），与本次改动无关（本次零 API/`.codex` 改动）。完整输出留档 `.trellis/tasks/09-18-clean-webview-cache-prettier-drift/verify-run.log`。
  - verify 剩余阶段按序补齐：`ruff check .` 全绿；`sidecar-smoke`（daily 档）全绿；OpenAPI drift 无漂移。九个门禁等效全部通过。
- 未做：`.pytest_full.log`、`.pytest_full2.log`、`.sf_tmp/` 等其它未跟踪项按约定不动；不改 eslint/prettier 配置；任务归档自验见任务目录。

## 2026-09-17 Desktop UI/UX 全维度优化（第十四波：D1 视觉统一 · 面板头部图标按钮收敛）

- 用户转向 D1「视觉统一」。体检发现一个明确可证伪的不一致：同是**面板头部图标按钮**（刷新/新建/扫描），存在两套写法并错位到半边产品：
  - **A 派**（BookProfileView / ManuscriptView / ObservatoryView）：`grid place-items-center` + `text-muted` + `transition-colors`
  - **B 派**（SidePanel / KnowledgeInboxView）：`flex items-center justify-center` + `text-subtle`，且 **SidePanel 两个按钮还漏了 `transition-colors`**——hover 变色是硬切。
- 实现（3 文件 / +58−3）：
  - SidePanel 两个「新建文件 / 新建文件夹」按钮、KnowledgeInboxView 的「刷新」按钮（`RefreshCw`）统一到 A 派；KnowledgeInboxView 补 `aria-label` 链条上缺的 `data-testid="knowledge-inbox-refresh"`（其它头部按钮都已带 testid）。
  - ObsPanel 的「关闭」按钮、Titlebar 的窗控按钮**刻意不动**：它们属于不同视觉/系统层级，尺寸与色板刻意不同；本波只统一「面板头部通用当前面板操作的图标按钮」这一族。
- `accessibility-guards.test.ts` 新增 D1 静态护栏 `PANEL_HEADER_ICON_BUTTONS`：六个面板头部按钮逐一断言 `grid place-items-center`、`text-muted` 基色、`transition-colors`——对应 JSX 挂回非 grid/非 muted/漏过渡任一漂移立即红。用 braces-aware 提取函数找 `<button>` 标签边界，避开箭头函数 `=>` 中误吞的 `>`。
- **非空虚性已变异验证（2 处）**：
  1. 把 SidePanel 的新文件按钮改回「B 派」 → 红「应用 grid 布局」（幂等回滚：恢复 `transition-colors`/muted/grid 后转绿）。
  2. 从 KnowledgeInboxView 删 `transition-colors` → 红「应有 transition-colors」；恢复转绿。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**103 files / 681 passed**（基线 680 → +1，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 未做：ObsPanel / Titlebar 特殊按钮族不动（见上）；`.assistant-md` 等 markdown 正文样式非本波对象；「面板头部按钮」之外的其他图标按钮族（面板内列表操作、对话框、ContextMenu）发现性差异极小，暂保留各自写法；真机 hover 过渡实感未测。未动 API/契约/权限/写回。

## 2026-09-17 Desktop UI/UX 全维度优化（第十三波：D4 信息级层 · 面板标题语义化）

- 用户转向 D4「信息架构」。体检发现：所有左栏面板标题（搜索 / 手稿 / 作品 / 世界线观测镜 / Knowledge Inbox / 观测）都是裸 `<span>`，h1/h2/h3 在六个文件里**全为 0**；而主工作区 BookOverview / Welcome 却规范用了 h1/h2。读屏作者按 H 键跳标题**完全跳不到左栏任何面板**。
- 实现（6 文件 / +43−7，纯标签改动）：
  - 左栏五个视图标题 `span` → `<h2>`（同层级，都是项目导航一级）：SearchView / ManuscriptView / BookProfileView / ObservatoryView / KnowledgeInboxView。
  - ObsPanel 标题 `span` → `<h4>`（它是壳内子区域，比左栏 h2 低一级，避免与面板标题撞级）。
  - Tailwind 3.4 preflight 默认重置 h2/h4 margin，视觉零变化。
- 行为测试：在每个面板的既有测试文件里补一条「标题是正确层级的语义标题元素且文本正确」；`accessibility-guards.test.ts` 新增静态护栏 `PANEL_HEADINGS`——逐一断言每个文件的标题文本包在对应层级的 `<h2>`/`<h4>` 里、且不存在裸 `<span>` 回退。
- **非空虚性已变异验证**：把 ManuscriptView 的 `手稿` 从 `<h2>` 改回 `<span>`，静态护栏红（精确指到文件+文本）、behavior 测试红（`h2` 查询失败）；恢复后转绿。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**103 files / 680 passed**（基线 679 → +1，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 未做：主工作区已合规（BookOverview/Welcome h1/h2），不改；`.assistant-md` 内的 markdown 标题样式与本波无关；真机 NVDA 按 H 键跳转的实测未跑；未动 API/契约/权限/写回。

## 2026-09-17 Desktop UI/UX 全维度优化（第十二波：D5 铺开 · 共享 LiveStatus 原语 + 四个异步面板）

- 用户要求「D5 剩余异步面板 live region 铺开」。至此 live region 覆盖齐了七个异步面板；为防止又一波内联复制粘贴漂移，本波把「常驻 sr-only live region」提取成共享原语 `shell/LiveStatus.tsx`（跟 `PanelError` 同目录同模式），并顺手把此前三波的内联写法（SearchView / ChatWindowView / BookOverview）全部迁移到原语上。
- 四个新面板补 live region（相位级措辞，同相位内恒定、跨相位才变文案）：
  - **ObservatoryView**：扫描中 / 完成（带时间）/ 失败。点「重新扫描」后读屏作者能感知扫描进度。
  - **ManuscriptView**：读取中 / 完成（带章数）/ 失败。
  - **BookProfileView**：保存失败（优先）/ 拆书取消中 / 拆书生成中 / 统计失败 / 统计中。保存失败单独播报错误详情——这是作者必须立即知道的。
  - **KnowledgeInboxView**：刷新中 / 待处理提案数（每 5s 轮询 + 手动刷新都触发）。
- 迁移后 `chat-run-live-region.test.tsx` 的接线护栏写法跟着换：旧的按 `<p ... data-testid=...>` 抓标签断言顺序无敏感属性，现在只断言 `<LiveStatus testid="agent-run-live" />` 挂载 + 文案源是 `runLivePhaseText`；LiveStatus 本体（role / aria-live / sr-only / 常驻 `<p>`）由该测试文件里新增的「LiveStatus 原语自身」护栏钉死。
- 新增静态铺开护栏 `accessibility-guards.test.ts`：七处 `LIVE_REGION_SITES` 逐一断言「引用了 LiveStatus 且挂了对应 testid」——铺开若被下波删掉某一处的接线，这里立刻红。
- **非空虚性已变异验证（4 处）**：改 ObservatoryView「完成」→「扫描完毕」、ManuscriptView「读取完成」→「手稿就绪」、KnowledgeInboxView 待处理数文案、BookProfileView 删统计中分支——对应测试都立刻红并精确指到断言；恢复后转绿。
- 途中教训（已记证）：曾用 PowerShell 字符串替换改 ObservatoryView.tsx 源码，立刻把文件编码写坏（此前 D6 波已踩过、记为「勿用 shell 改源码」）——恢复后改用 edit 工具。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**103 files / 679 passed**（基线 672 → +7，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 未做：ObsPanel（ObservatoryView 的右栏对应面板）未加 live region——它与左栏 ManuscriptView 共用 useBookContext，重复播报两处会双念；CommandPalette 的「正在读取项目文件…」是短瞬态、焦点在列表里，无独立 live 需要；真机 NVDA 实测未跑；未动 API/契约/权限/写回。

## 2026-09-17 Desktop UI/UX 全维度优化（第十一波：D5 流式 · Agent 运行相位 live region）

- 用户继续 D5，选 ChatWindow 流式。侦察确认缺口：chat-window 全目录 `role="status"`/`aria-live`/`role="alert"` **零命中**——Agent 运行相位（运行 → 等待确认 → 暂停 → 终态）对读屏作者完全不可见。视觉上的 `run-action-active-step`（正在处理 + 三点动画）与 `run-action-status`（等待你确认/已暂停/…）都是普通节点，状态翻转读屏感知不到。
- 与上一波（搜索 live region，脏数据按状态播报）相反：Chat 的状况更刁钻——`runStatusText` 已把运行相位派生成漂亮措辞，但它**藏在跳过性文案里**，且运行中每换一个步骤详情文案就变 → 若直接拿去播报，长程 run 会每一步都吵一遍。
- 实现（3 文件 / +31−1，纯前端）：
  - 新增 `runLivePhaseText(run)`（`display-utils.ts`）：**相位级**话术——同一相位内步骤/详情再怎么变都返回同一句恒定文本 → live region 只在相位切换（运行 → 等待权限 / 等待修订 / 暂停 / 停止 / 失败 / 完成）时念诵一次。等待权限与等待修订确认给出**不同措辞**，读屏作者能区分「批权限」和「收补丁」；运行中恒定「Agent 正在处理本轮…」不吵。
  - `ChatWindowView.tsx` 顶部加常驻视觉隐藏的 `<p role="status" aria-live="polite" className="sr-only" data-testid="agent-run-live">`，文案来自 `runLivePhaseText(state.agentRun)`；可见操作条/轻状态条原样保留，避免见字又听字。
  - **复用上一波加的 `.sr-only` 工具**，零新增 util。
- 纠错：第一版静态接线护栏用固定属性顺序的正则（`data-testid=...[^>]*aria-live`），而 JSX 里我把 `aria-live` 写在 `data-testid` 前面 → 护栏自己先红。改为「先抓含该 testid 的整标签、再对它的属性顺序无关地逐项断言」——这是更稳的接线护栏写法，不是测试防腐。
- 新增行为测试 `tests/chat-run-live-region.test.tsx`（5 条）：①无 run 静默；②运行中恒定且不随步骤详情变（防长程吵）；③等待权限 vs 等待修订措辞有别；④暂停/停止/失败/完成各有相位句；⑤接线护栏（agent-run-live 存在 + polite + sr-only + 文案源）。
- **非空虚性已变异验证**：把运行中相位改为返回 ''，`runLivePhaseText：运行中带恒定一句` 立刻红；恢复转绿。接线护栏经独立核对（用真实 JSX 属性顺序验证 tag 抽取命中）。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**103 files / 672 passed**（基线 667 → +5，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 未做：ChatWindow 流式逐 token 内容本身的 live 化（句子级增量播报成本高、收益低，当前相位级足够）；`context-candidates-error` 的 role=alert 未处理；Composer/工具调用权限弹窗的专有 live region 未做；真机 NVDA 实测未跑；未动 API/契约/权限/写回。

## 2026-09-17 Desktop UI/UX 全维度优化（第十波：D5 状态变化反馈 · 搜索检索 live region）

- 用户继续 D5。本波选一个具体交互缺口：搜索是异步的，结果文本会动态翻转（空 → `搜索中…` → `N 处 · M 个文件` / `没有匹配的内容。`），但此前普通 `<p>` 没有 live region，**屏幕阅读器完全感知不到结果数何时到位**；失败块也没有 `role="alert"`。
- 侦察确认范围：全仓只有 BookOverview 的 skeleton 波加了 `role="status"`（`git grep 'role="status"'` 仅此一处），主交互面板的 live region 覆盖是系统性缺失。本波只做 SearchView 这一处**自成体系**的异步流程，不铺开。
- 实现（2 文件，纯前端，`SearchView.tsx` + 新测试；**复用本仓已有 `.sr-only` 工具，零新增 util**）：
  - 新增常驻、视觉隐藏的 `<p role="status" aria-live="polite" className="sr-only" data-testid="search-live">`，文案从「搜索中／完成总数／零命中／达上限」四态派生。
  - **只在两个语义节点换文案**：搜索中恒为「正在搜索正文…」（中间批次结果数在涨也不变文案 → live region 不重复打扰），收尾才播报「搜索完成：找到 N 处，涉及 M 个文件」。
  - 失败块补 `role="alert"` + `data-testid="search-error"`（打断级），且**不重复进 polite live region**，避免失败被念两遍。
- 纠错：第一版我把 live 文案的注释写成「用 200ms 句柄做节流」——但代码里根本没有节流逻辑（文案直接派生）。抓到后改成如实描述「文案稳定即不打扰」，未让假实现注释留在代码里。
- 新增行为测试 `tests/search-view-live-region.test.tsx`（4 条）：①搜索中→收尾播报正确措辞；②零命中/达上限文案；③失败走 role=alert 且不混入 live region；④查询不足最小长度/未打开项目时不播报。
- **非空虚性已变异验证**：把 `正在搜索正文…` 改名为空串，测试立刻红并精确指到该断言；恢复后转绿。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**102 files / 667 passed**（基线 663 → +4，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 未做：ChatWindow 流式输出/上下文候选（`context-candidates-error`）等其余异步面板的 live region 留后续波次；真机 NVDA 实测未跑（静态 live-region 语义可测，实际念诵行为需真屏读者）；未动 API/契约/权限/写回。

## 2026-09-17 Desktop UI/UX 全维度优化（第九波：D2 作品总览 · 骨架屏加载）

- 用户转向 D2/D4/D5。侦察后发现 D2/D4 表面在 1-3 波已重度打磨（BookOverview 有 role=status/alert、空态、进度条、响应式），不做表面功夫。真正成体系缺失的是 D5「加载状态反馈」：**全仓 `.skeleton` 工具类自 1-3 波定义后从未被引用**（孤儿工具），每个面板的加载态仍是一行裸「正在读取…」文字。
- 单波聚焦选 BookOverview：它是 D2 主区 hero，加载时整页只有一行文字、没有形状占位。
- 实现（纯前端，4 文件 / +119−10）：
  - `BookOverview.tsx` 新增 `BookOverviewSkeleton`：镜像 hero 两卡（封面 3:4 + 简介行 / 写作进度 + 进度条 + 两格统计）的**形状骨架**，用现有 `.skeleton` 工具，加载结束布局不跳；整块 `aria-hidden`（装饰态）。
  - 加载态文字从可见 `<p>` 改为 `<p role="status" className="sr-only">`：可见观感交给骨架，屏幕阅读器语义留给 sr-only 文本（新加 `.sr-only` 工具，`index.css`）。
  - 外层 `role="region"` 补 `aria-busy={profile.loading}`。
- 新增行为测试（2 条）：`book-overview.test.tsx` 断言 loading 时骨架出现 + `aria-busy="true"` + 骨架 aria-hidden + sr-only 文本含「正在读取」+ 每个占位用 `.skeleton`，转 settled 后骨架/busy 消失；`accessibility-guards.test.ts` 加一条「`.skeleton`/`.sr-only` 既定义也被引用」的孤儿工具护栏（BookOverview 同时引用两者）。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**101 files / 663 passed**（基线 661 → +2，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过（BookOverview 骨架块已按 prettier 折行）。
- 未做：其余面板（ChatWindow/ResourceExplorer/VersionHistory/CommandPalette 等）的骨架屏留后续波次——本波把 BookOverview 当形状匹配的样板，其余面板直接套同款模式；真机观感截图未动眼；未动 API/契约/权限/写回。

## 2026-09-17 Desktop UI/UX 全维度优化（第八波：D6 可达性收尾 · 图标按钮齐平 + 对比度护栏）

- 用户要求「将 D6 做完」。本波把 D6 收口为两件可证伪的事：**图标-only 按钮 aria-label 全扫** + **对比度从注释变成测试**。
- **aria-label 补齐（8 文件 / 12 处）**：ActivityBar 设置齿轮、BookProfileView 刷新+返回、KnowledgeInboxView 刷新、ManuscriptView 重新读取+返回、ObservatoryView 重新扫描+返回、SearchView 清空、SidePanel 新建文件+文件夹、ToastHost 关闭通知。此前这些都只靠 `title`（屏读者支持不一）。
- **新增护栏测试 `tests/accessibility-guards.test.ts`（4 条）**，把 D6 从「一次性人工检查」变成「持续可证伪」：
  1. 上述 10 个壳子文件里，所有「图标-only」按钮必须有非空 `aria-label`。
  2. `isIconOnly` 判定自测（防护栏自身失效）。
  3. `SWEPT_FILES` 文件存在性（防改名后护栏空转）。
  4. **对比度**：从 `index.css` 真 token 算 WCAG 相对亮度比值——`--foreground`/`--muted` 对 `--background` ≥ 4.5:1、`--subtle` ≥ 3:1，**双主题**都验。此前这些比值只活在 CSS 注释里，无人可证伪。
- **开发过程中踩到并修掉的两个护栏自身缺陷（重要，已记入测试注释防回退）**：
  1. **JSX 开标签不能用 `[^>]*>` 啃**：按钮属性普遍含箭头函数 `onClick={() => f()}`，`=>` 的 `>` 会被当成标签结尾，属性被误当正文 → 判定失效、缺陷被静默跳过（第一版护栏就是这么把 SearchView 的缺名放过的）。改用按引号/花括号计深的 `openingTagEnd`。
  2. **「图标-only」判定必须保守**：条件渲染 `{badge && <span>3</span>}` 静态无法确定是否渲文本，激进解析产生 4 处假阳性（Titlebar/SidePanel/KnowledgeInboxView/BookProfileView 本就有文字的按钮被误报）。改为「摘掉图标节点后只要还剩任何内容就放行」——宁可漏报不误报。
  - **护栏非空虚性已用变异测试证明**：临时删掉 SearchView 的 `aria-label="清空搜索"`，护栏立刻红并精确指到该按钮；恢复后转绿。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**101 files / 661 passed**（基线 657 → +4，无回归；stderr `act` 警告为既有噪声）。
  - `eslint src/components/shell/ tests/accessibility-guards.test.ts`：**0 problems**；改动文件 `prettier --check` 全过。
- **发现但未修（超出本波范围，不顺手改无关文件）**：`src/components/shell/ContextMenu.tsx` 存在 prettier 格式漂移（`git status` 干净 ≠ 我已改）。根因是 `pnpm lint` 为 `eslint . && prettier --check`，前者被 `.trellis/.../adblock_snippet.js` 的 10 个既有错误短路，prettier 从未执行，漂移因此长期不可见。修它需先解掉 adblock 那个 lint 阻塞，留后续独立处理。
- **D6 至此收口**。累计五波：`25ed0707`（活动栏）→ `aad7eda1`（Titlebar 面板开关）→ `4141fd02`（窗控+观测面板）→ 本波（全扫 + 对比度护栏）。
- 仍未验（超出静态护栏能力）：真机 Tauri + NVDA/Narrator 实测；Tab 顺序审计（需真机逐点 Tab 才能验，静态护栏保证不了顺序体验）；非壳子层组件（chat-window/editor/app 下）的同类按钮。

## 2026-09-17 Desktop UI/UX 全维度优化（第七波：D6 可达性 · 图标按钮显式 aria-label）

- 承接第六波。本轮把「图标-only 按钮只靠 title 做可访问名」这个缺口在 Titlebar 与 ObsPanel 两个相邻面上齐平（这两个是用户最高频触点，其余面板留后续）。
- 缺口本质：`title` 属性做可访问名的支持度因屏读者/浏览器而异，NVDA 默认不读悬停 title、VoiceOver 也可能跳过；显式 `aria-label` 才是稳定身份。此前 Titlebar 窗控（最小化/最大化/关闭）与 ObsPanel 关闭/标记已处理都只有 `title`。
- 实现（纯前端，2 文件）：
  - `Titlebar.tsx` 窗控三键各补 `aria-label`（中文，与原 `title` 同文案）+ 对应 `data-testid` 供测试钉死。
  - `ObsPanel.tsx` 关闭观测面板 X 补 `aria-label="关闭观测面板"`；「标记已处理」补 `aria-label="标记已处理：${obs.title}"`——多条观测一行一个，名里带观测标题，否则屏读者听到一排同名按钮无法分辨处理的是哪条。
- 新增行为测试（2 条）：`titlebar-drag.test.tsx` 断言三窗控各带 `aria-label`；`obs-locate.test.tsx` 断言关闭按钮名 + 「标记已处理」带观测标题且逐条区分（0 锚点与 1 锚点两条同名互不相同）。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**100 files / 657 passed**（基线 655 → +2，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 累计四波 D6：`25ed0707`（活动栏）→ `aad7eda1`（Titlebar 面板开关）→ 本波（窗控 + 观测面板）。
- 未做：真机 Tauri + NVDA/Narrator 实测；其余面板（`BookProfileView`、`SearchView`、`SidePanel`、`ToastHost`、`KnowledgeInboxView`、`ObservatoryView`）的同类 icon-only 按钮留后续波次；Tab 顺序审计与对比度复测留后续。

## 2026-09-17 Desktop UI/UX 全维度优化（第六波：D6 可达性 · Titlebar 面板开关）

- 承接第五波 D6。用户说「继续」，我承接上轮自己列的 D6 待办，但**先纠正自己一句话**：上轮我说可「补 `aria-pressed`」，那是错语义——`Titlebar` 的 Agent 面板开关是「展开/收起」动作而非开/关状态，`aria-pressed` 会把「点击收起」读成「未按下按钮」，形成反直觉。
- 落地正确语义（与 `StatusBar` 字数徽标同一套既有弹层模式）：
  - `Titlebar.tsx` `titlebar-toggle-right` 补 `aria-label="Agent 面板"`（名字稳定，不随态翻转）+ `aria-expanded={!rightCollapsed}`；`title` 保留随态翻转（展开→「收起 Agent 面板」，收起→「展开 Agent 面板」），那是给鼠标用户的当前动作提示，不是屏读者身份。
  - 此前只有 `title`，屏读者只能念到一个动作，无法分辨按下是展开还是收起。
- 新增行为测试（1 条，`titlebar-drag.test.tsx`）：展开/收起两态分别断言 `aria-label` 恒为「Agent 面板」、`aria-expanded` 正确翻转、`title` 反向提示。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**100 files / 655 passed**（基线 654 → +1，无回归；stderr `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过。
- 累计三波：`bb605f65`（1-3 波基线）→ `7ead48c7`（D3 Ctrl+Tab）→ `25ed0707`（D6 活动栏）→ 本波。
- 未做：真机 Tauri + NVDA 实测；D6 其余项（Tab 顺序审计、ObsPanel/ObservatoryView 等面板 `aria-expanded` 补齐、对比度复测）留后续。

## 2026-09-17 Desktop UI/UX 全维度优化（第五波：D6 可达性 · 活动栏视图图标）

- 用户拍板方向 D6 可达性、单波聚焦。侦察后发现 D6 基线已相当扎实，**不做表面功夫**——已有：全站 `:focus-visible` 焦点环（含光晕 + `prefers-reduced-motion` 降级）、Settings/AppDialog 两对话框的焦点陷阱 + Escape + 焦点恢复、快捷键护栏、文件树 `aria-label`/`aria-expanded`、toast `role="status"` 实时播报、对比度 token 已带 WCAG 比值注释（`--muted` 4.5:1+、`--subtle` 4.2:1）。
- **真正成体系缺失且可行为化证明**：`ActivityBar` 视图图标只靠 `title`（其中混着快捷键，屏幕阅读器会把「资源管理器 · Ctrl Shift E」念成按钮名），且当前视图只画视觉指示条、无 ARIA 标记。同属 `SettingsView` 早已用 `aria-pressed`/`aria-current`，这里是缺的兄弟面。
- 实现（纯前端，2 文件 / +74−5）：
  - `ActivityBar.tsx` `ViewEntry` 新增 `label` 字段（干净名字，不含快捷键），按钮加 `aria-label={entry.label}` + `aria-current={active ? 'true' : undefined}`。`title` 保留快捷键作视觉 tooltip。
  - **用语义选型注释记录为什么不选 `aria-pressed`**：六个视图图标是互斥选择（同时只有一个是当前），`aria-pressed` 表达不了「按下这个就松开那个」，而 `aria-current` 的「集合中的当前项」才准确——与 `ContextMenu` 的 `aria-current` 用法同源。
- 新增行为测试（1 条，`shell-panel-views.test.tsx`）：断言每个视图按钮 `aria-label` 干净（≠ title、不含 "Ctrl"）、当前视图 `aria-current="true"`、其余视图 `aria-current` 为空。
- 验证：
  - `typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**100 files / 654 passed**（基线 653 → +1，无回归；stderr 的 `act` 警告为既有噪声）。
  - 改动文件 `eslint` **0 problems**；`prettier --check` 全过（`ActivityBar.tsx` 两处 `label` 行被 prettier 折行，逻辑不变）。
- 未做/未验：真机 Tauri + 真屏幕阅读器（NVDA/Narrator）实测未做，ARIA 语义靠静态断言钉死；未动 API/DB/OpenAPI/契约/权限/写回；其余 D6 项（Tab 顺序审计、更多面板 `aria-expanded`/`aria-pressed` 补齐、更细的对比度）留后续波次。

## 2026-09-17 Desktop UI/UX 全维度优化（第四波：D3 写作工作台 · 页签键盘循环）

- 前置：先把前 1-3 波 + 09-06/09-10 成果（46 文件 / +2094-488）收口为基线提交 `bb605f65`，避免新旧改动混在一起无法证伪。仅 Desktop 前端展示层，未动 API/DB/OpenAPI/契约/权限/写回。
- 用户拍板方向：D3 写作工作台、单波聚焦。侦察后确认 D3 大部分已落地——编辑器排版（`options.ts` 书稿/格子双轨、行长档位、CJK 行距）、页签拖拽重排、预览页签、脏标记、右键菜单、`…` 溢出菜单、`Ctrl W` 关闭、方向键 roving 均已存在；`closeOthers`/`closeAll` 也已有入口。**唯一成体系缺失的是「不开鼠标在页签间循环」**——标准 IDE 键盘惯例，故本波只做这一件。
- 实现（85 行 / 5 文件，纯前端）：
  - `editor-tabs-state.ts` 新增纯函数 `nextCyclicEditorFile(openFiles, currentFile, direction)`：环形推进；空集合返回 `null`（无目标可去）；当前文件不在固定页签集合（在预览槽 / 为空）时方向 1 落首个、-1 落末尾，给确定落点而非原地不动。
  - `App.tsx` 全局 keydown 新增分支：`Ctrl Tab` / `Ctrl Shift Tab` / `Ctrl PageDown` / `Ctrl PageUp` → `tabs.focusFile(next)`。**必须排在 `shiftKey` 早退之前**，否则 `Ctrl+Shift+Tab` 被上面那组 `Ctrl+Shift+<视图键>` 吞掉（此处为真实陷阱，注释已记）。无项目时不接管（`needs:project`），交还系统。
  - **关键安全性**：循环只换焦点、不关页签，因此不触发脏文件放弃确认——与 `Ctrl W` 语义分离，按一圈不会丢稿。
  - `shortcuts.ts` 登记 `Ctrl Tab` 行（`needs: 'project'`，chords 含 4 个键位），界面承诺与实现同源。
- 新增行为测试（4 条）：`editor-tabs.test.tsx` 覆盖环形首尾相接/双向/单页签回自身/空集合 null/当前不在固定集合的落点；`shortcuts.test.tsx` 覆盖无项目时不 `preventDefault`（含 `Ctrl+Shift+Tab` 不被 shift 早退吞掉）。
- 验证：
  - `npm.cmd --prefix apps/desktop/frontend run typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**100 files / 653 passed**（基线 649 → +4，无回归；stderr 的 `act` 警告为既有噪声，用例全绿）。
  - 改动文件定向 `eslint`：**0 problems**（含修掉一处 `no-dupe-else-if`——我早前修错把 `Ctrl O` 分支写重，lint 逮住，已还原）；`prettier --check` 全过。
  - `pnpm.cmd lint` 全仓：仍仅 `.trellis/.../adblock_snippet.js` 10 个既有错误（捕获的 Edge webview 资源，非源树，与 09-06/09-14/09-15 同源），前端 src 零新增。
- lint 说明：`exhaustive-deps` 对 App 的 keydown effect 报 `tabs` 缺项，故按仓库既有惯例（`useMonacoEditor.ts` / `PatchReviewPanel.tsx` 同款）加带理由的 disable —— 依赖已列 `tabs` 叶片，整体列入会让监听器每帧重挂，反而更差。
- 未做/未验：真机 Tauri 观感与截图未动眼（本波为键盘行为，无法自动截图验收）；未碰 Monaco 配置、布局模式、API/契约/权限/写回；`pnpm verify` 全量门禁与 API 侧未跑（本波零 API 改动）。

## 2026-09-17 Desktop UI/UX 全维度优化（第三波：全量测试修复收口）

- 环境解封：vitest 此前因沙盒禁子进程（spawn EPERM）无法启动，本波策略变更后可直接跑全量。
- 首轮全量 649 用例 7 失败，逐个定位修复（全部限 UI 表现层与测试断言，不动 API/契约/权限/写回）：
  1. `ToastHost.tsx` — 上一波重构（悬停暂停/退出动画/createdAt）在 happy-dom 假定时器下触发 `RangeError: Array buffer allocation failed`，回滚到 diffs 前简洁实现（无 hover-pause / 无退出动画），toast 与 undo-writeback 两个文件 7 用例立即转绿。
  2. `tests/workspace-layout.test.tsx` — 第三断言 `workspaceSidePanelLimit(1920,'balanced')` 期望 `720`，但 `side-panel-width.ts` 里 `SIDE_PANEL_WIDTH_MAX` 已在用户上次调宽时改成 `800`（1920−48−420−320=1132 被夹到 800），测试漏同步；改断言 `720→800`，与第一条测试的 800 一致。
  3. `panels.tsx` — `rounded-2xl` 不在圆角阶梯 `{xs,sm,md,lg,xl}`，违反 `radius-scale.test.ts` 档位红黑线；改 `rounded-xl`（既已进入三色递增区块的最大档）。
  4. `index.css` — 滚动条 `border-radius: var(--radius-full)` 被阶梯测试拦（只许 `xs-md-xl` 与 `50%|999px`）；改 `border-radius: 50%`，同心关系不变。
  5. `tests/chat-ux-polish.test.tsx` — 断言运行态必现「正在处理」字样，但同一档位上一轮已改成「三点动画 + 活动步骤 title」（09-06 记录）；同步为断言 `run-action-active-step` + `sf-thinking-dots` + 步骤 title，与 `AgentStepsPanel` 折叠头同一语义。
  6. `useShellState.ts` — 新增 localStorage 持久化（`storyforge:shell:{view,layoutMode,sidebarHidden}`）后，测试间状态沿存；第二个观测镜用例读到的「observatory 且可见」其实是第一个用例的残留，导致再点一次 toggle 收起失败。新增 `resetShellStateStorage()` 并在 `shell-panel-views.test.tsx` 的 `beforeEach` 调用，用例间清档。
- 验证：
  - `npm.cmd --prefix apps/desktop/frontend run typecheck`：**exit 0**。
  - `npm.cmd --prefix apps/desktop/frontend run test`：**100 文件 / 649 用例全绿**，duration 8.64s。
  - `pnpm.cmd lint`：**exit 1，仅 `.trellis/.../research/.../adblock_snippet.js` 10 个既有 ESLint 错误**（与 09-06/09-14/09-15 记录同源，不属本波引入，也不属前端 src 代码）。
- 未做：API/DB/OpenAPI/WS 契约、Monaco 配置、权限档位派生、guarded writeback；真机 Tauri 桌面观感与截图未动眼（动画渐变、弹性缓动观感应由人眼验收）。

## 2026-09-17 Desktop UI/UX 全维度优化（第一波）

用户授权 Trellis 任务 `09-17-uiux-full-optimization`，从视觉系统、作品总览、对话 Agent、交互反馈四个维度优化 Desktop UI/UX；本轮仅改 Desktop 前端展示层，不动 API/DB/契约/权限/写回链路。

- **视觉设计系统（`index.css`）**：新增弹性缓动 token `--transition-spring`（`cubic-bezier(0.34,1.56,0.64,1)`）与 `slide-in-up` keyframe；新增一组微交互工具类（`.animate-fade-in-up/.animate-fade-in-scale/.animate-slide-in-right/.animate-slide-in-left/.animate-slide-in-up/.animate-pulse-soft/.animate-shimmer/.interactive-press/.card-hover/.stagger-item/.skeleton/.focus-ring`）与统一 `[data-tooltip]`气泡；所有新动画均受 `prefers-reduced-motion` 既有全局规则压到 0.01ms。
- **BookOverview**：页头图标加 `bg-agent/10` 圆角衬底；hero 两卡（档案 / 进度）接 `.card-hover`（悬停抬升 + 描边加深 + 投影加深）；封面 `group-hover:scale-105` 缩放；「继续写作」主按钮加大至 h-11、shadow-md/lg 梯度；进度条加 `bg-gradient-to-r from-agent to-agent/70` 渐变与 500ms 过渡；统计两格改为 `bg-elevated/50` 圆角卡；待确认补丁 / Agent 状态两张横幅卡统一为 icon-tile + 卡片化（圆角 xl、阴影、hover 升档）；章节 / 大纲列表行 hover 出现 `bg-agent/10` 章节号块、章节名由 muted 提升 foreground、大纲行箭头 `translate-x` 微移；空状态改为「图标圆盘 + 居中说明」。
- **ChatWindow（`panels.tsx`）**：助手消息改为「AI 紫底方块徽标 + 边框卡片包裹的 Markdown 正文」（此前正文裸排）；用户气泡 padding 加大并加 hover 阴影；空会话页重排（渐变徽标盘、能力 chip 圆角加大、交错进入动画）。RunActionBar 整体升一档阴影与按钮尺寸（h-7→h-8、圆角 md→lg、字体加 medium、`interactive-press` 按压反馈），running 状态下活动步骤文字由 muted 提升为 foreground。
- **Composer**：focus 光环由 3px/10% alpha 加宽为 4px/15% alpha；textarea 内距加大（min-h 44→48）；发送按钮 h/w 微增、圆角 md→lg、hover/focus 阴影升档并加按压反馈。
- **EditorTabs**：活动页签顶部强调条 2px→3px；非活动页签 hover 加 `shadow-sm`；关闭按钮 hover 有 `bg-border` 衬底；脏文件圆点由 foreground 改为 agent 色（此前在深色底上几乎不可辨）。
- **未触碰**：API/DB/OpenAPI/WS 契约、权限档位派生、guarded writeback、Monaco 配置、`pnpm lint` 既有阻断（`.trellis/...adblock_snippet.js` 10 个历史 ESLint 错误，见 09-15 记录）。

验证：
- `npm.cmd --prefix apps/desktop/frontend run typecheck`（tsc --noEmit）：**exit 0 通过**（首轮报 3 个未使用 `index` 变量，已修；最终复检 exit 0）。

第二波细节打磨（同日续）：
- **WelcomeWorkspace**：启动/上手两栏分别加 `animate-fade-in-up` 50/100ms 交错进入；WGuide 卡片 hover 加 `-translate-y-0.5` 抬升、图标盘 `scale-105` 放大、`shadow-md` 升档，active 复位——与 BookOverview `.card-hover` 同一交互语言。未改任何 testid/props。
- 最终复检 `npm.cmd --prefix apps/desktop/frontend run typecheck`：**exit 0**。

未验证（环境阻塞）：
- `npm.cmd run test` 与 `pnpm.cmd lint` 均因沙箱 `child_process.spawn EPERM`（errno -4048，esbuild 起服被拒）无法在本环境启动，与 09-06/09-14/09-15 各轮记录为同一已知限制；**须由人工在非沙盒环境补跑前端 vitest 全量与 lint**。已人工核对：本轮所有改动限 className/style/结构 JSX 层级，未改任何 data-testid、props 签名、事件语义；`.stagger-item` 依赖 `nth-child` 延迟，章节/大纲行 `data-testid` 未变，现有 `book-overview*.test.tsx`、`chat-*.test.tsx`、`workspace-layout*.test.tsx` 的选择器与断言语义不受影响。
- 未做真机 Tauri / 真实 provider / 截图观感动眼；动画观感（弹性缓动、渐变进度条）未经人工目验。

## 2026-09-06 Agent 运行时视觉反馈：三点思考动画 + 当前工具步骤

- 用户确认要加「正在思考…」动画和「当前工具调用步骤更明显的展示」。本轮落地，不扩大范围。
- **三点思考动画**：`index.css` 新增 `sf-thinking-dots` 组件——三个 3px 圆点，agent 色，`thinking-dot` keyframe 让三点错峰跳动（1.2s 周期、0.15s/0.3s 延迟阶梯），对齐 Claude Code 的极简三点观感。降低动效偏好下被全局规则压到 0.01ms，不跳动。
- **AgentStepsPanel 折叠头部**：非终态（running/waiting/paused）时不再只显示「思考中 · N 步 · K 工具」，改为「三点动画 + 当前活动步骤 title + N 步 · K 工具」；终态保持「已思考 · N 步 · K 工具」不变。活动步骤取 running > waiting > pending 的第一个，fallback 「思考中」。作者收起面板也能一眼看到「正在跑哪个工具」。
- **RunActionBar 状态区**：`isRunning` 分支从硬编码「正在处理」改为「三点动画 + 活动步骤 title」（同一查找逻辑）。原有 ping 动画圆点保留，与三点动画并列——圆点表示「run 活着」，三点表示「正在想」。
- 验证：`npm --prefix apps/desktop/frontend run typecheck` -> **exit 0**。
- 未验证（环境阻塞）：vitest 仍因沙盒 `spawn EPERM` 无法启动。已人工核对：`chat-ux-polish.test.tsx` 的 AgentStepsPanel 测试断言的是 `step-metrics` / `step-metric-chip`（结构化指标渲染），与折叠头部文案无关；`run-action-status` 的现有断言（`run action bar offers resume...`）只匹配「已暂停」分支，running 分支无文本断言。新 UI 的「三点动画 + 步骤 title」不被任何现有用例钉死，**须由人工在非沙盒环境补跑前端 vitest 全量确认**。

## 2026-09-06 侧栏宽度不一致排查与同步

- 前一轮记录「`side-panel-width.ts` 的 `NARROW_DEFAULT_PX = 260` 与测试期望的 236 不一致」。排查 `git diff` 后确认：**不是代码缺陷，是用户自己未提交的改动**——`side-panel-width.ts` 的 `NARROW_DEFAULT_PX` 从 236→260、`MIN` 从 200→220、`MAX` 从 720→800，测试文件未同步。
- 用户确认 260 是正确值（选项 A），要求同步测试。改：
  - `tests/side-panel-resize.test.tsx`：`defaultSidePanelWidth('explorer'/'search')` 236→260；`clampSidePanelWidth(NaN)` 236→260；`resolveSidePanelWidth('explorer', ...)` 236→260。
  - `tests/workspace-layout.test.tsx`：`workspaceSidePanelLimit(1920, 'balanced')` 720→800（源文件 MAX 改成 800）；`workspaceSidePanelLimit(800, 'balanced')` 200→220（源文件 MIN 改成 220）。
- 明确区分了两类 236：作为「narrow 默认值」的改，作为「maxWidth 限制值」的不改（`workspaceSidePanelLimit(1024, 'balanced')` 算出 236 在 [220,800] 内仍正确，`workspace-layout-app.test.tsx` 两处 236 同理）。
- 验证：`npm --prefix apps/desktop/frontend run typecheck` -> **exit 0**。vitest 仍因沙盒限制未跑，**须由人工在非沙盒环境补跑全量确认**。

## 2026-09-06 UIUX 决策落地：观测镜快捷键收敛 + Agent 排队预写

- 用户对前一轮「待确认」的四项逐一拍板：收敛观测镜键位、Agent 运行期间允许预写但排队、侧栏最大宽度+记忆维持现状、首启配置向导不强制。本轮按此执行，不扩大范围。
- **观测镜快捷键收敛**：`Ctrl 4`（布局切换）与 `Ctrl Shift O`（左栏观测镜视图）做的是同一件事（都落到 `shell.toggleObservatory()` / `switchView('observatory')`）。保留 `Ctrl Shift O`（与其他视图键 `Ctrl Shift E/F/M/B` 同族），删掉 `Ctrl 4`：`App.tsx` 的 `keydown` 移除 `key === '4'` 分支，`shortcuts.ts` 删掉 `Ctrl 4` 行，`useShellState.ts` 注释、`SidePanel.tsx` 头注释同步。`shortcuts.test.tsx` 的「全局快捷键 ≥6 条」断言不受影响（仍 7 条）。
- **Agent 运行期间允许预写但排队**：此前 `Composer` 的 Enter 守卫在 `busy` 时直接 `return`，作者打的字被吞、另附一条「这轮还在整理」提示。现在 `useChatSubmission` 加 `queuedMessageRef`，busy 时把消息存起来并提示「已排队，结束后自动发出」；`prevBusyRef` 边沿检测 effect 在 `agentBusy` 从 true 翻 false 时自动把排队消息走 `handleComposerSubmit` 发出去。`Composer` 的 Enter 守卫改为 `busy` 时也调 `onSubmit`（由 `handleSubmit` 进排队），发送按钮在 `busy` 时仍禁用（`canSubmit = !busy`），用户不能靠点击绕过排队。
- **侧栏宽度限制 + 记忆**：确认现状已满足——`useWorkspaceSidePanelLimit` 按视口宽度算 `maxWidth`（防挤压编辑器），`sidePanelWidths` 按视图持久化到 `localStorage`，拖拽松手才落盘。`side-panel-resize.test.tsx` 已覆盖持久化 / 窗口收窄恢复 / 拖拽夹限 / 键盘调整 / 双击复位。**本轮无新改动**，仅确认。发现 `side-panel-width.ts` 的 `NARROW_DEFAULT_PX = 260` 与测试期望的 236 不一致，非本轮引入、不在你点头的四项内，**未修**。
- **首启配置向导不强制**：确认现状——欢迎页有「连接你的 AI 模型」引导卡，但不是强制弹窗。符合「不强制」，**无改动**。
- 验证：`npm --prefix apps/desktop/frontend run typecheck` -> **exit 0**。
- 未验证（环境阻塞）：vitest 仍因沙盒 `spawn EPERM` 无法启动（同前一轮）。已人工核对：`shortcuts.test.tsx` 的 `SHORTCUT_ROWS` 全局条数仍 ≥6（删 `Ctrl 4` 后剩 7 条），观测镜那行 `needs: 'project'` 本就跳过全局按键护栏；`chat-window-lifecycle.test.tsx` / `chat-ux-polish.test.tsx` 未直接断言 busy 时 Enter 行为，但 busy 排队的 UI 提示语是新文案，**须由人工在非沙盒环境补跑前端 vitest 全量确认**。

## 2026-09-06 UIUX 快速修复：快捷键提示统一 + 异步按钮禁用态 + 速查表入口

- 用户要求继续修复 desktop 前端 UI/UX，经讨论确认先做「统一 tooltip 快捷键格式」「异步按钮 loading/禁用态」「快捷键速查表入口」三项；不顺手改布局、面板宽度、Agent 运行时交互模式。
- 统一事实源：`shortcuts.ts` 的 `keys` 列用「空格分隔、无加号」格式（`Ctrl Shift E` / `Ctrl ,`）。此前组件 tooltip 里混用 `Ctrl+Shift+E`、`Ctrl+4`、`Ctrl+,`、`Ctrl+O` 四种写法，与速查表不一致。本轮把 `ActivityBar` / `panels.tsx` / `PatchReviewPanel.tsx` / `BookProfileView.tsx` / `ManuscriptView.tsx` / `ObservatoryView.tsx` / `Titlebar.tsx` / `CommandPalette.tsx` 的 tooltip 全部改为 `功能描述 · Ctrl Shift X` 单一体例。
- 观测镜工具提示改 `Ctrl Shift O`（`shortcuts.ts` 里 `Ctrl Shift O` 才是真绑定的键；此前 tooltip 写 `Ctrl+4`，而 `Ctrl 4` 是布局切观测镜的另一个键，两处混用误导）。
- 异步按钮补禁用态：`BookOverview` 刷新、`BookProfileView` 刷新、`ManuscriptView` 刷新、`ObservatoryView` 重扫、`KnowledgeInboxView` 刷新各自加 `disabled={busy|refreshing|loading}` + `disabled:cursor-not-allowed disabled:opacity-50` + `disabled:hover:*` 复位，此前 loading 期间可重复点击并重复发起读盘/扫描。`index.css` 补全局 `button:disabled` cursor 规则（`aria-busy=true` 用 `wait`）。
- 速查表入口：`CommandPalette` 新增可选 `onShowShortcuts` prop，命令列表加「帮助：快捷键速查」；`AppShell` 传入既有 `showShortcuts`。此前速查表只在齿轮菜单和欢迎页可发现，命令面板内搜不到。
- 验证：`npm --prefix apps/desktop/frontend run typecheck` -> **exit 0**（`tsc --noEmit`）。
- 未验证（环境阻塞）：`npm --prefix apps/desktop/frontend run test` 与直接 `node node_modules/vitest/vitest.mjs run` 均因沙盒禁止进程派生而失败于 `esbuild` 启动：`Error: spawn EPERM ... ensureServiceIsRunning`（`errno -4048`）。这是 harness 沙盒的 `child_process.spawn` 拦截，非本轮代码问题，故 vitest 未实跑。已逐文件人工核对相关用例不受影响：`command-palette.test.tsx`（`onShowShortcuts` 可选）、`book-overview.test.tsx:113-125`（`refreshing=false` 时按钮仍可点）、`observatory-view.test.tsx:237-253`（`busy=false`）、`book-profile-view.test.tsx`（`refreshing=false`）、`shortcuts.test.tsx`（未改 `SHORTCUT_ROWS`）。**须由人工在非沙盒环境补跑前端 vitest 全量确认。**
- 未做：面板宽度/响应式布局、Agent 运行时交互模式（排队 vs 禁用）、首启设置向导、`Ctrl 4` 与 `Ctrl Shift O` 的键位合并——均待用户确认后再动。

## 2026-09-06 B3a Monaco Worker 单变量对照

- 用户要求继续 B3 的下一步；只做候选实验，不改产品、不启动 B4、不自动提交。报告：`D:/StoryForge/docs/internal/monaco-worker-comparison-2026-09-06.md`；本地忽略证据：`D:/StoryForge/.trellis/tasks/archive/2026-09/09-05-monaco-worker-comparison/`。
- 相同99个 production 产物、共同 globalAPI/公共diff/RPC观测，两组只差是否启用本地 editorWorkerService factory；5对新origin交错A/B，每组diff后另导航input，共20个正式样本，4个校准独立排除，无正式补跑/剔除。控制10/10 fallback，候选10/10初始化成功、5/5真实compute回复成功且公共diff行范围一致。
- SSE→公共diff完成回调中位/max：control54.8/67.7、worker70.7/75.1 ms，配对worker−control中位+15.9；完成后双rAF75.2/94.2 vs77.6/82.1（配对+2.4），装饰双rAF79.1/99.3 vs80.5/87.2（配对+0.5）。每组160输入事件→nextRAF中位/max2.4/9.7 vs2.5/12.2 ms。回答双rAF配对5/5更早（中位−11.6 ms），但与diff完成延后并存，未证明整体交互提速，不将消除告警等同性能优化。
- 新origin启动两组各5/5仍有长任务；本轮diff/input窗口无≥50ms长任务，不能据此算出CPU节省。公共observer单次最高7.6/整页累计最高14.6 ms；RPC不是CPU、DOM/rAF不是paint或INP；部分Worker资源duration为负，保留但不作下载耗时统计。
- 已通过候选独立build、server14/14 tests、Desktop typecheck、`pnpm.cmd lint`、20样本/99原产物/冻结源码hash校验及独立复核。正式样本无error、hidden或资源失败；32键输入、dirty与可见文本均通过。仅editorWorkerService获验，不冒充其他语言Worker支持。
- 已关闭诊断页、reset viewport、停止服务并确认12端口关闭；原有9个WIP保留，本段前置不覆盖旧报告。无产品/API/DTO变化，未重跑产品build、`pnpm.cmd verify`、API/Vitest全量或OpenAPI；未验收Tauri/packaged、IME、真实provider/磁盘/writeback、长会话、稠密diff或文学质量。用户在两文档提交提议后要求「做下一步」，按列明范围提交，不推送。

## 2026-09-05 B3 Desktop 生产前端性能诊断

- 用户在 B2 提交后要求「做下一步」，本批只测量，不修改业务代码或推进 B4。报告：`D:/StoryForge/docs/internal/desktop-performance-baseline-2026-09-05.md`；本地原始证据：`D:/StoryForge/.trellis/tasks/archive/2026-09/09-05-desktop-performance-baseline/`（忽略目录，不随报告提交）。
- 基于 `08377dc0` 的 production bundle，在隔离 loopback origin、1440×920 浏览器、内存文件/模拟SSE下，完成4组×5次=20个正式样本。新origin欢迎DOM中位236/max283.6 ms，双rAF代理257.1/max301.2；同origin再导航DOM58.4/max80.1，双rAF123.7/max139 ms。
- 合成长文39,598 code units/99,598 bytes/7,199行、单处标点diff：结果入队→diff装饰双rAF中位82.6/max107.6 ms；160个真实ASCII insertText→下一rAF中位2.7/max9.1 ms。上述是前端代理，不是INP、实际paint、完整diff计算、真实IME或Tauri性能。
- 运行发现：冷启动5次长任务91–124 ms（LoAF指向入口模块，不能细归因）；20/20次Monaco缺worker factory并回退主线程，告警在开文件后，不是启动卡顿归因。建议后续单变量worker对照，不据告警宣称优化收益。
- 已通过：production build（23.36秒）；Desktop typecheck；最终`pnpm.cmd lint`；本地server12/12测试；20样本validity与99产物hash；独立只读重算。正式样本无请求/资源错误、hidden或阶段顺序问题。4个校准样本因fixture/资源路由问题保留排除；首次lint扫描临时build失败，产物移至既有标准dist并补诊断脚本环境声明后通过，无门禁规则变更。
- 原有9个未提交文件保留，本段只追加、不覆盖旧报告。无产品/API/契约变化，未重跑本轮`pnpm.cmd verify`、API/Vitest全量或OpenAPI；未验收Tauri/packaged、真实provider、真实磁盘写回、长会话、中文IME或人工文学质量。用户已确认仅单独提交本报告和 B3 验证段，不推送。

## 2026-09-05 B2 Agent 最终回答取消一致性

- 任务：`.trellis/tasks/09-05-agent-terminal-cancellation/`；用户明确批准 B2 及单独提交。基线为 `acf97697` 加原有 9 个文件的未提交改动；仅改领域最终投递边界及新增行为测试，本段与 B2 代码单独提交，原有清理内容保留，不推送。
- 复现：`uv run pytest tests/test_agent_terminal_cancellation.py -q`（`apps/api`）在旧生产代码上 **2 failed**：stop/pause 均由 provider stub 内独立 Session 经公开控制 service 落库，但仍返回 `late answer` 且没有 `runtime_interruption`。修复后首轮 **2 passed**，不将既有 DB 终态守卫误报为状态覆盖漏洞。
- 修复：`apps/api/app/domains/agent_runs/loop/conversation_runtime.py` 在 loop 返回、计划记录后重新读取控制状态；复用中断返回，阻止迟到会话消息、正常完成证据和成功 system jobs。保留旧 before-round 边界，但最新 stopped 优先于旧 paused。
- 证据：已发生模型调用保留 `assistant.chat_loop` 的累计 token/source/cost 及先前工具审计；暂停用既有 paused、停止用 failed，附 interruption，不保存迟到正文。首轮未调用模型不伪造消耗证据。SDK checkpoint、无 pending chat 恢复和 API/WS/DTO 词表不变。
- 新增矩阵 **11 passed**：末次 stop/pause、正常成功、工具后末次中断与累计用量、首轮前零调用、第二轮前已发生用量、pause→resume 不重放、计划记录期间 paused→stopped。使用临时项目、隔离 SQLite 测试库与独立 Session，无真实网络、sleep 或私有 runtime 打桩。
- 验证：相关 8 个 loop/lifecycle/tools/adapter/resume/permission/SDK recovery/source-standard 测试文件 **74 passed**；新矩阵 + SDK recovery + source-standard 合并 **34 passed**；定向 Ruff、`git diff --check` 通过。独立只读审查无阻断，规范已补最终投递与恢复边界；生产文件未改动行的原始行尾已保留。
- 总门禁：`pnpm.cmd verify` -> **exit 0，全部本地核心门禁通过**：根 lint/格式、Desktop/Shared 类型检查、project-core **7 passed**、Desktop **91 files / 606 passed**、API **1592 passed / 7 skipped / 6 warnings**（229.18 秒）、API Ruff、daily sidecar（零 LLM/零外网）及 OpenAPI/Agent 帧刷新无漂移。原始日志保存在本地子任务 `verify.log`。该门禁针对包含既有清理的混合工作树，不等于隔离 B2 提交的全量复测；既有跳过/warning 未掩盖。
- 未验证/范围：未执行真机 Tauri GUI、真实 provider、冻结安装包或文学质量验收；不宣称解决投递检查之后的所有事务竞争、单轮 fallback 取消、同轮工具强制取消，未修改 record_plan 的既有 current_step 规则；B3/B4 未启动。

## 2026-09-05 B1 拆书命令项目隔离

- 任务：`.trellis/tasks/09-05-breakdown-command-project-isolation/`。用户已批准实施及单独提交；只处理父任务 B1，B2/B3/B4 未启动。本段与 B1 代码单独提交，保留原有 API 清理等 9 个文件的其他未提交改动，不推送。
- 修复：拆书报告加载、生成、取消内聚到 `apps/desktop/frontend/src/components/app/useBookBreakdown.ts`；按已提交项目生命周期、请求身份和报告 revision 隔离迟到回调。保留 `useProjectCommands` 公共返回接口及 `BookBreakdownPreview` 类型 re-export，不改 API/WS/DTO、报告格式或 guarded writeback。
- 覆盖：切换/关闭/卸载、A→B→A、保存等待、完成提示等待、取消迟到清理、读/status 成功失败覆盖、StrictMode 重放、同 tick 重复点击和正常重跑。仍维持 single in-flight，切项目不自动取消原后台任务。
- 首轮红测：`npm.cmd --prefix apps/desktop/frontend run test -- tests/project-breakdown-state.test.tsx` -> **3 failed / 3 passed**；新失败分别证明旧生成覆盖 B 报告、旧读取成功/失败覆盖新生成。修复后该首轮集合 6 passed。
- 合并定向：`npm.cmd --prefix apps/desktop/frontend run test -- tests/project-breakdown-state.test.tsx tests/project-breakdown-lifecycle.test.tsx` -> **27 passed**。相对既有三项新增 24 项，不以旧三项或源码字符串断言代替新行为验证。
- 独立 frontend typecheck、定向 ESLint 通过；`uv run pytest tests/test_source_code_standards.py -q` -> **16 passed**；`npm.cmd --prefix apps/desktop/frontend run build` -> passed（27.26 秒），既有 Monaco 大 chunk 和 Tauri event 混合导入 warning 保留，未提高阈值掩盖。
- `pnpm.cmd verify` -> **exit 0，全部本地核心门禁通过**：根 lint/格式、Desktop/Shared 类型检查、project-core **7 passed**、Desktop **91 files / 606 passed**、API **1581 passed / 7 skipped / 6 warnings**、API Ruff、daily sidecar 冒烟（零 LLM/零外网）及 OpenAPI/Agent 帧刷新无漂移。该结果来自包含原有未提交清理的工作树，不等同于仅 B1 提交的隔离全量复测。API 跳过仍为本机符号链接/既有可选环境测试，不改写为全平台验收。
- 独立只读代码审查无阻断，额外补齐 StrictMode 与 status 等待窗口测试；`git diff --check` 通过。更新项目异步状态规范及子任务复盘，避免仅修 effect 而漏掉命令回调。
- 未验证：本轮未执行真机 Tauri GUI、冻结安装包、真实 provider 或文学质量验收，也未推进 Agent 末次回答取消修复。不能将单元测试或本地核心门禁外推成上述验收通过。

## 2026-09-05 项目多角度优化：只读审查与规划

- 任务：`.trellis/tasks/09-05-project-multidimensional-optimization/`，状态 `planning`。用户明确要求先规划、再确认第一批实现；已生成 PRD、design、implement 及 research/review，未激活实现。
- 两名只读审查 agent 分别核对 Desktop 拆书命令生命周期与 Agent 末次回答取消窗口。发现均为源码候选，尚未新增失败回归，不宣称已经复现或修复。首批建议仅处理拆书跨项目迟到回调，后续取消一致性、性能和发布/写作验收各自确认。
- `npm.cmd --prefix apps/desktop/frontend run typecheck` -> exit 0。
- `npm.cmd --prefix apps/desktop/frontend run test` -> 90 files / 582 passed，18.48 秒。
- `npm.cmd --prefix apps/desktop/frontend run build` -> exit 0，22.39 秒；Monaco chunk 3,337.88 kB / gzip 859.55 kB，主业务 chunk 576.33 kB / gzip 176.30 kB。有大 chunk 与 Tauri event 动静态混合导入警告；不是构建失败，也不直接证明实际启动或输入延迟。
- `git diff --check` -> passed。没有修改生产/测试源码；9 个原有未提交文件保留，报告仅新增本段，构建输出仍是忽略资产。Trellis 规划保留本地，不强制纳入 Git。
- 未验证：两项新候选的行为复现、API/Rust 全量、根总门禁、性能 trace、真机 Tauri 写回、真实 provider、文学质量和远端 CI。本轮没有访问真实小说或调用 provider；不外推历史 GUI/LLM 证据。

## 2026-09-05 提交收尾与 Linux 符号链接补验

- 用户确认后完成三批本地提交：`fd7a7fa6` 文件工具边界与预算、`7e00aae0` API/lint 与拆书报告状态、`5eea3765` 状态文档与验证证据。仅提交本轮内容，其他清理代码及报告段落仍留在工作区，未推送。
- 门禁任务已归档；文件工具 R1-R6 验收完成。Trellis 被仓库忽略，任务、规范及会话日志保留本地，不强制纳入版本库。
- Windows 本机及沙箱外均运行 `uv run pytest tests/test_agent_fs_boundaries.py -q -rs`：18 passed / 3 skipped，普通符号链接均为 WinError 1314；Windows junction 实测通过。
- 从提交 `5eea37650812dfabf4acfdfb2806adf66f5beaa7` 导出 API 源码、测试、pyproject.toml、uv.lock 及前端 semantics.ts，使用 Python 3.11.14 与 `uv sync --frozen --no-install-project` 构建 Linux 镜像。基础镜像摘要：`sha256:4f5d923c9dcea037f57bda425dd209f3ec643da2f0b74227f68d09dab0b3bb36`；最终镜像：`storyforge-fs-symlink-check:20260905`（manifest `sha256:4df0c5764b6ae9e872614acf568089fc12eac97fe9e39cc93de84e6b69d7ceb8`）。
- 测试容器使用 `--rm --network none`，仅挂载证据输出目录，未挂载本地配置、密钥或私有小说。容器内执行 `uv run --no-sync pytest tests/test_agent_fs_boundaries.py tests/test_agent_fs_tools.py tests/test_agent_fs_budget_feedback.py tests/test_agent_project_knowledge.py tests/test_author_memory_reach.py tests/test_manuscript_chapter_ordinals.py -q -rs --junitxml=/evidence/linux-fs-tests.xml`：**56 passed / 1 skipped**，唯一跳过为 Windows junction。
- 已解析 JUnit XML，确认三个边界链接用例及 `test_project_knowledge_rejects_oversize_and_symlink_escape` 均没有 skipped/failure/error。初次镜像遗漏前端 semantics.ts，目录约定测试失败；补入同提交源码后上述全组通过，未修改或放宽测试。
- 本地复现资产：文件工具任务 `verification/` 下的 Dockerfile、source.tar、linux-fs-tests.xml；任务收尾后位于 `.trellis/tasks/archive/2026-09/09-05-fs-tool-boundaries/verification/`。用该目录执行 `docker build -t storyforge-fs-symlink-check:20260905 <verification目录>`，再 `docker run --rm --network none --mount type=bind,source=<verification绝对目录>,target=/evidence storyforge-fs-symlink-check:20260905`。
- 本次未修改生产代码；此前总门禁结果保留为 API 1581 passed / 7 skipped、前端 582 passed。Linux 定向通过不改写 Windows 全量跳过数，不代表 Windows 原生符号链接、真机 GUI、真实 LLM 质量或远端 CI 已验收。

## 2026-09-05 已登记 API 与 lint 门禁修复

- 任务：`.trellis/tasks/09-05-verification-gate-fixes/`；实现及验收完成，未自动提交，保留已有未提交工作。
- intent 测试补齐 `chapter.polish` 的精确集合期望；Windows PowerShell 5.1 将无 BOM 的中文脚本按旧编码解析，已给证据验证脚本补 UTF-8 BOM，未更改质量判定门槛。对照中 ParseFile 失败而显式 UTF-8 ParseInput 无错误。
- 拆书报告状态记录所属项目；切换时按当前项目派生展示，effect 清理阻止旧加载响应写入。新增 3 项 hook 行为测试覆盖切换、旧响应覆盖和关闭项目，均先失败后通过；后台生成取消流程未重设计。
- `uv run pytest tests/test_ide_agent_orchestrator.py tests/test_real_llm_long_evidence_validator.py -q` -> 30 passed，原 13 项失败均关闭。
- `pnpm.cmd verify` -> exit 0，所有本地核心门禁通过：根 ESLint/Prettier、Desktop 与 Shared 类型检查、project-core 7 passed、前端 90 files / 582 passed、API 1581 passed / 7 skipped / 6 warnings、API 全量 Ruff、daily sidecar 冒烟、OpenAPI 刷新及无漂移。
- 当前状态文档同步后：`uv run pytest tests/test_phase9_fact_sources.py -q` -> 18 passed；`uv run ruff check tests/test_ide_agent_orchestrator.py tests/test_phase9_fact_sources.py` -> passed；`git diff --check` -> passed。
- 项目规范记录异步报告项目归属和 Windows PowerShell 中文脚本编码约束。current-phase、TODO、PROJECT_SUMMARY 已移除已解决阻断；下方旧结果为历史实跑，不能作为当前失败状态。
- 未验证：普通符号链接三项文件边界测试仍受本机权限限制，未重做真机 GUI、真实 LLM 长程质量或远端 CI；本地总门禁通过不等于发布验收。冻结 sidecar 证据沿用同日文件工具任务，本次总门禁运行的是 daily 源码档。

## 2026-09-05 项目状态校准

- 任务：`.trellis/tasks/09-05-project-state-calibration/`；用户已授权继续，文档与测试同步完成，未自动提交。
- 更新 current-phase、TODO、PROJECT_SUMMARY；旧文本完整保留在同目录三份 history 文件，仅加归档标记。当前文档区分代码已实现、未提交修复、最近一次验证和历史 GUI/LLM 证据。
- 修正全文搜索/现场恢复的过时缺失描述，记录 BookRun Agent 工具退役及文件工具修复；保留上一项全仓失败与符号链接缺口。
- `uv run pytest tests/test_phase9_fact_sources.py -q` -> 18 passed（含当前文档相对链接校验）。历史断言指向归档，不再强迫当前文档保留旧结论。
- `uv run ruff check tests/test_phase9_fact_sources.py` -> passed；`git diff --check` -> passed。
- 未重新跑 API 全量、GUI、真实 LLM 或远端 CI；文档中的全量数字明确来自前一项实跑。未修复无关 lint/测试错误，既有工作区改动保留。

## 2026-09-05 文件工具边界与资源修复：实现验证

- 任务：`.trellis/tasks/09-05-fs-tool-boundaries/`，已获实施授权，保留 in_progress（全仓门禁与符号链接验证缺口未关闭）。
- 实现：逐文件目标及隐藏路径校验、目录链接/junction 不递归；20,000 目录项/64 深度；2 MiB 完整读取；16 MiB 搜索累计读取；UTF-8 前缀解码；regex 单次 50 ms/累计 2 秒。Project Knowledge 同步保护且不返回截断凭据片段；跨章审校不吞章序枚举错误。
- 初始红测：`uv run pytest tests/test_agent_fs_boundaries.py -q` -> 8 failed / 3 skipped，确认无界读、乱码、漏报 truncated 与非法参数问题。
- 定向：`uv run pytest tests/test_agent_fs_tools.py tests/test_agent_fs_boundaries.py tests/test_author_memory_reach.py tests/test_manuscript_chapter_ordinals.py tests/test_source_code_standards.py -q` -> 63 passed / 3 skipped。
- 共享调用方：`uv run pytest -q -k 'project_knowledge or consistency or canon or entity_budget or prose_scan or collapse or cross_chapter or book_breakdown'` -> 244 passed / 1 skipped。
- 失败反馈与跨章：`uv run pytest tests/test_agent_fs_budget_feedback.py tests/test_agent_cross_chapter.py -q` -> 16 passed。
- `uv run ruff check app/domains/agent_runs app/domains/ide tests` -> passed；`pnpm.cmd check:drift` -> OpenAPI 零漂移；`git diff --check` -> passed。
- `pnpm.cmd smoke:sidecar:packaged` -> 重建 exe 后通过，ready 7818 ms；PyInstaller 自动收集 hook-regex，无需更改构建配置。
- `uv run python ../../.codex/fs-boundary-packaged-probe.py`（apps/api）-> PACKAGED SEARCH PASS。本地模拟 provider、临时库和隔离项目驱动真实冻结 exe 的 Agent SSE；普通正则返回 needle，高回溯正则返回超时错误。无真实 LLM 调用，探针服务已关闭。
- 全量 `uv run pytest -q` -> 1564 passed / 13 failed / 7 skipped。失败：旧 `test_supported_intents_are_registered` 期望遗漏 chapter.polish；12 个 `test_real_llm_long_evidence_validator.py` 用例因既有 PowerShell 验证脚本 UnexpectedToken 无法执行。相关文件未由本任务修改。
- `pnpm.cmd verify` -> 被既有 `apps/desktop/frontend/src/components/app/useProjectCommands.ts:81` 的 react-hooks/set-state-in-effect 阻断，未扩展范围修改前端。
- 未验证：3 项普通符号链接用例因本机创建权限跳过；Windows junction 真链接测试通过。未宣称抵抗恶意本地进程并发路径替换或完成真机 GUI 验收。
- uv lock、packaged smoke、OpenAPI 首次受缓存权限阻断，授权重试后通过。已有工作区改动保留，无自动提交。

## 2026-09-05 文件工具安全修复：规划记录

- 任务：`.trellis/tasks/09-05-fs-tool-boundaries/`，状态 planning。
- 已完成：读取实现、测试和公共调用方；产出 prd.md、design.md、implement.md，并回读 PRD 检查需求收敛。
- `git diff --check`：通过；任务目录文档已通过 Get-Content 回读确认存在。
- 未验证：行为测试、Ruff、契约与冻结 sidecar。当前仅规划，生产代码尚未修改，不能宣称漏洞已修复。
- 原有工作区改动保留，以下既有报告内容不变。

# 验证报告 · 清理孤立符号与收窄缓存异常

时间：2026-09-05

## 范围

删除 API 内无仓内消费者的 `envelope_from_items`、`S3UploadError`、`DisabledRerankerClient` 和两个 LLM 配置公共别名；将 Artifact 缓存 DTO 解析从裸 `Exception` 收窄为 `pydantic.ValidationError`。保留 `record_workflow_model_run_payload`、BookRun dispatch aliases、workflow-dispatch 路由/DTO 和全部安全护栏。

## 验证

```text
cd apps/api && uv run pytest tests/test_source_pruning.py tests/test_redis_cache_strategy.py tests/test_retrieval_real_providers.py tests/test_model_runs.py tests/test_book_run_workflow_dispatch.py -q
-> 67 passed

cd apps/api && uv run pytest tests/test_pagination.py tests/test_s3_integration.py tests/test_llm_config_file_override.py -q
-> 16 passed, 2 skipped

cd apps/api && uv run ruff check app tests
-> All checks passed

UV_CACHE_DIR=D:\StoryForge\.codex\tmp\uv-cache pnpm.cmd check:drift
-> OpenAPI 契约无漂移

git diff --check
-> passed
```

全仓检索确认已删除符号只出现在 source-pruning 的反向断言中；未发现生产、测试或动态导入引用。

## 全量回归

`cd apps/api && uv run pytest -q` 返回 `1545 passed, 4 skipped, 13 failed`。失败项均不涉及本轮修改：1 项是既有 `chapter.polish` intent 基线差异，12 项是 `.codex/validate-real-llm-long-evidence.ps1` 的 PowerShell ParserError。

## 未验证项

- 真实 MinIO 集成测试按默认配置跳过。
- 未运行 Desktop/Rust 全量套件；本批次未修改 OpenAPI DTO、Desktop 或 Rust。

---

# 验证报告 · 移除无项目态的功能阻挡

时间：2026-08-05

## 问题

作者反馈：「程序第一次打开 关闭欢迎页后 必须开一个项目才能点其他功能 我觉得这样有问题」

## 根因

**ActivityBar.tsx 第 70/82 行：** 无项目时 `projectOnly` 视图（作品/手稿/搜索/观测镜）会变灰且点击被 `if (dimmed) return;` 阻挡。

**App.tsx 第 175/178 行：** 快捷键 Ctrl+1/2/3/4 有 `if (!workspace.activeProject) return;` 守卫。

**实际影响：** 关闭欢迎页后如果不开项目，左侧图标栏的多数功能无法点击、快捷键失效，给人「卡住」的感觉。

## 修复

1. **ActivityBar.tsx**：移除 `dimmed` 判断与点击阻挡，去掉变灰样式 — 视图始终可点击，具体内容由各视图自己决定是否显示占位提示。
2. **App.tsx**：移除 Ctrl+1/2/3/4 的 `activeProject` 守卫 — 快捷键始终响应。
3. **移除 `noProject` 参数**：ActivityBar 不再需要这个 prop，从函数签名和调用处一并删除。

## 验证

```bash
npm run typecheck  # 通过
npm run test       # 88 passed (88), 569 passed (569)
pnpm lint         # 通过
```

## 行为变化

- **之前：** 关掉欢迎页后无项目时，左侧多数图标变灰不可点、Ctrl+1/2/3/4 失效。
- **之后：** 左侧图标始终可点击，快捷键始终响应；无项目时各视图显示占位提示（"打开项目后可查看…"），符合作者期望的「能点左边的功能」。

---

# 验证报告 · 借苹果的设计立场，落成六条可证伪的约束

时间：2026-07-30

> **提名口径说明**：作者原话——「苹果的设计审美很不错 有什么我可以借鉴的吗」，随后
> `/goal 做1到6`。属作者显式指定的六项，不是主动打磨波，也覆盖了 2026-07-26「编辑器停
> 主动打磨波、每周至多一刀」那条自定规矩——该规矩已在答复里显式提示过，作者选择全做。

## 先说不该做的：已经很苹果的部分不重做

摸查现有 token 系统后的第一个结论是**克制**：单色语义梯度、只留一个「金子色」（iris 给
agent）、发丝描边而非重投影、滚动条平时收起、`prefers-reduced-motion` 全局降级、
`:focus-visible` 焦点环——这些正是苹果克制感的来源，本波一条没动。

真正缺的是**尺子**：圆角与字号都不是阶梯，而是按需微调出来的连续谱。

## 六刀与对应 PR

| # | 刀 | PR | 性质 |
| --- | --- | --- | --- |
| ② | 圆角收成同心阶梯 | #241 | 机械收敛 + 护栏 |
| ① | 字号收成八档阶梯、字距挂档位、修 UI 字体两条栈打架 | #241 | 含一个真 bug |
| ③ | 壳子在作者写字时退场 | #242 | 新行为 |
| ④ | 接受建议改为落位而非硬切换 | #242 | 新行为 |
| — | 补上接受的重入闸 | #244 | **#242 自带回归，我引入的** |
| ⑤ | 写回后一键撤销 | #243 | 新行为（红线不动） |
| ⑥ | Win11 Mica 窗口材质 | #245 | 观感最抓眼、验证最不足 |

## 顺手逮到的三个真缺陷

1. **`body` 与 `--font-ui` 两条栈打架**（#241）。`body` 硬编码了一条与 `--font-ui` 不同的
   字体栈（多 Roboto/Arial、少 Microsoft YaHei UI/PingFang SC），全站 UI 实际继承的是
   `body` 那条，`--font-ui` 只在两个内联浮层生效——token 形同虚设。
2. **补丁面板的只读 diff 只同步了字号与字体**（#241）。行高吃 Monaco 默认 ≈1.35×、字距为
   0，而主编辑器是 1.9× + 书稿字距：同一段稿子逐字核对时两种呼吸节奏。
3. **接受建议的双写窗口**（#244，自己引入自己逮）。#242 把落位动效插在 `teardown()` 之前，
   `teardown()` 从「同步先跑」变成「`await` 之后才跑」，那 170ms 里接受键与 Alt+Enter 都
   还能再次触发 `applyAccepted`——两次触发各走一遍守卫写回，同一补丁写两次盘。

## 两处不照搬、改打法

- **⑤ 不动「未确认不写盘」红线。** 苹果的做法是避开 modal、先做再给 Undo；但该红线写在
  `CLAUDE.md` / `README.md` / `ide-first-product-direction.md` / `TODO.md` 四处，并由
  `src-tauri/src/main.rs:1104-1111` 的 smoke 断言守着。改成直接写回会一次性打爆四处文档承诺
  和那条 smoke。所以本刀降的是**接受之后**反悔的成本：从「翻版本历史 → 恢复进缓冲 → 再手动
  保存一次」变成一次点击。撤销本身也走 `performGuardedWriteback`，不从后门绕开 F27。
- **⑥ 不走 `tauri.conf.json` 的 `windowEffects`。** 那条路在 tauri 内部把每个 `apply_*` 的
  `Result` 都 `let _ =` 吃掉，成败无从得知；而 `transparent: true` 会把 WebView2 背景强制
  清零，材质没挂上又让出画布就等于给 Win10 用户一个透明的应用。改成 Rust 直调
  `window_vibrancy::apply_mica` 拿真 `Result`，前端据此决定要不要启用透明。

## 命令与输出

```
npm --prefix apps/desktop/frontend run test        -> 76 files / 479 passed
npm --prefix apps/desktop/frontend run typecheck   -> 绿
pnpm.cmd lint                                      -> 绿（eslint + prettier）
node scripts/run-e2e.mjs                           -> 契约门禁 20 pass / 0 fail
cd apps/api && uv run pytest -q                    -> 1257 passed, 3 skipped (261s)
cd apps/api && uv run pytest tests/test_source_code_standards.py -q -> 16 passed
cd apps/desktop/src-tauri && cargo check           -> 绿
OpenAPI 漂移                                        -> 无漂移（后端零改动）
```

新增护栏 23 条，分布：`radius-scale`(4) `type-scale`(5) `shell-deference`(5)
`window-material`(4) `undo-writeback`(4) + `inline-chat` 落位时长/重入闸(2)。

## 变异验证（测试是否打在接线上）

七个变异逐个植入并重跑，**全部被逮红**：

| 变异 | 打掉的行为 | 结果 |
| --- | --- | --- |
| 圆角 | 一处 `text-3xs` 改回 `text-[10.5px]` | RED |
| 圆角（**非人为**） | 护栏首次运行即红，逮出此前 grep 漏掉的 40 处裸 `rounded` | RED |
| 字号 | 同上（越界任意值） | RED |
| 退场 | 往退场规则塞 `display: none` | RED |
| 落位 | CSS 过渡改 300ms、与 `INLINE_SETTLE_MS` 脱钩 | RED |
| 撤销 | 陈旧闸换成 `false`（撤销会吃掉作者新输入） | RED |
| 材质 | 一条规则的闸从 `[data-window-effect='mica']` 降成 `[data-window-effect]` | RED |
| 重入 | 把重入闸挪到 `playAcceptSettle` 之后（真实的重入窗口位置） | RED |

其中圆角那条特别值一提：**它是在写出来的那一刻先红的**，抓出我自己前一次 grep（模式要求
`rounded-` 后必须跟字符）漏掉的 40 处裸 `rounded`——是真找到东西，不是事后补的绿灯。

## 自身失误留痕

两次 `;` 串联的 `git checkout <file>` 把同一批未提交改动一起回退：第一次冲掉 `index.css`
的字号 token（重做），第二次冲掉重入闸（重做）。变异验证的还原一律改用带
`assert count == 1` 的 python 定点替换，不再用 `git checkout` 还原工作区。

## 未联通能力（不得宣称）

- **⑥ Mica 真机观感完全没看过。** 透明度档（活动栏 0.4 / 面板 0.62）是纸面选值。
- **⑥ 的 `visualTone` 断言在本机根本没跑到。** `node apps/desktop/scripts/verify-tauri-smoke.mjs`
  挂在「初始欢迎工作区不可见」——本机持久化会话打开着 `D:\连载\末世吞噬`，欢迎页不渲染，
  `visualTone` 返回 `null`。**已在 master 上复跑确认是既有环境问题、与本波无关**，但也意味着
  我对该断言的规避只有 CSS 护栏作证、没有 smoke 作证。
- **⑥ tauri 官方警告未验**：`decorations: false` + `shadow`（默认 true）+ 窗口效果这个组合
  官方标注可能出 1px 白边 / 阴影异常，本仓库正落在里面。
- **③ 退场节奏未调手感**：1.6s 空闲、0.42 不透明度、420ms 淡出全是纸面值。
- **④ 落位路径无单测覆盖**：Monaco stub 没实现 `changeViewZones` / `createDecorationsCollection`，
  整个 diff 渲染路径在测试里不执行；落位与重入闸都只有结构不变量作证，要真机点穿。
- **① 48 处站点的行高变化需眼看**：从任意值迁到 `text-xs`/`text-sm` 的站点会拿到档位自带的
  行高（此前继承父级），13/15px 并入 14px。
## 收尾：⑥ 真机验收不通过并回退，改做作者当场提名的两条

⑥ Mica 在真机 dev 窗口里肉眼验收：Rust 侧起服自检打出 `window_material applied=mica`
（`apply_mica` 返回 Ok、DWM 属性已设上），但**作者报「没有透出桌面的模糊感」，观感与改前完全
一致**。卡在后半段——要么前端 invoke 没拿到状态，要么 `transparent: true` 让 tao 额外做的那次
`DwmEnableBlurBehindWindow` 与 `apply_mica` 的 `DWMWA_SYSTEMBACKDROP_TYPE` 打架（调研时就标为
「必须真机验证」那一条）。**已完整回退（PR #247）**：它是六刀里唯一零收益又带 `transparent: true`
风险的一条，装机包马上要重建，不留一个验不动的图形栈问题进去。

同一次真机验收里作者提名两条（其实是一条）：「作品栏占的位置太少了」+「点了左边图标后展开的
区域应可以拉伸」。**PR #248**：侧面板右缘可拖（5px 命中区、双击复位），宽度按视图各记一份，
宽档默认 300→340，夹在 200-720，拖拽中不写盘、松手才落。变异验证：删掉 `pointermove` 的
`removeEventListener` 即红。

## 出包：0.1.10 已送达

```
版本五处全部 bump（app/common/version.py / pyproject.toml / uv.lock /
  src-tauri/Cargo.toml / tauri.conf.json）+ pnpm openapi 刷新快照 info.version
pnpm desktop:build            -> NSIS + MSI 双 bundle（不能用 tauri build，后者静默打旧 sidecar）
pnpm smoke:sidecar:packaged   -> 冻结 exe 冒烟全绿（就绪 6.8s / assistant 往返 / SSE 2 帧 /
                                 control REST / alembic 纳管 / 分层 prompt 已打包）
```

**定向断言（不只核 app_version）**：本轮六刀改动全在前端，后端零业务变更，所以「现造小书调新
命令」不适用；改为断言装机 exe 里嵌的前端产物确实是这一轮的——`side-panel-resize`、
`sf-inline-diff-zone--settling`、`data-shell-deferred`、`toast-action`、`radius-lg` 五个标记
逐一在 `dist/assets` 的 js/css 里命中。三件产物（desktop exe / NSIS / sidecar exe）时间戳同批、
FileVersion=0.1.10。

产物：`apps/desktop/src-tauri/target/release/bundle/nsis/StoryForge IDE_0.1.10_x64-setup.exe`（49.8 MB）

## 2026-07-30 Agent 架构诊断与规划更新

范围：只读核查真实写章链路，并更新
`.trellis/tasks/07-30-project-optimization-review/` 下的 PRD、design、implement 与
`diagnosis-agent-architecture.md`；未修改生产代码。

验证：

```text
python ./.trellis/scripts/get_context.py                  -> 当前任务 planning；仅既有 Cargo.lock 未提交
python ./.trellis/scripts/get_context.py --mode phase     -> 回到 Phase 1.1 需求探索
uv run python -c "...list_loop_tool_specs..."             -> live loop 共 18 个工具
Select-String / Get-Content 精确追踪                       -> context_bundle 在 live-loop 写作工具处断链
git status --short（写报告前）                            -> 仍只有 apps/desktop/src-tauri/Cargo.lock
git status --short（写报告后）                            -> 本报告 + 既有 Cargo.lock
```

三路只读审查分别核对 skill 执行、上下文传递、role/ToolSpec deletion test，结论一致：
`skill_catalog` 是 plan telemetry，普通写章仍走通用工具循环；role catalog 多数是展示/审计语义；
ToolSpec 派生、领域检查和 proposed patch 写回保护是应保留的真实执行能力。

未验证：未改生产行为，因此未运行 pytest、前端测试、OpenAPI 或构建；双轨与 brief 权限策略
均已确认，首刀子任务已完成 PRD convergence pass，仍需作者 review 后才能启动实施。

### 规划决策补充

作者已确认采用双轨：开放问答保留通用 Conversation Module，写章/重写章进入可执行
Chapter Writing Module。该决策已同步到 parent PRD、design 与 implement；任务仍为 `planning`，
尚未运行 `task.py start`，生产代码未变。

### 权限设置事实核对

作者决定章节 brief 按既有权限设置推进。代码与历史核对确认：API 仍接受 `permission_profile`，
但 Desktop `AppSettings`、`AgentUserMessageRequest` 和 SSE body 均未携带该字段，因此当前 live run
恒为 `risk_confirm`；界面的批准/拒绝只是逐次 event 控制。2026-07-07 的“权限四轨收敛”提交也明确
记录旧三档因前端从不发送而删除。规划已改为恢复端到端 Permission Policy，且任何档位都不得绕过
最终 proposed patch 的 diff confirmation。

### 首刀子任务规划

已创建 parent child `.trellis/tasks/07-31-trusted-writing-context`，状态 `planning`。PRD、design、
implement 将范围限制为 live-loop create/revise 的可信 context 注入、安全 provenance 与
author-loop 投影；`.资料` 发现、Permission Policy 和 Chapter Writing Module 均明确排除。
placeholder 检查为空，parent-child 链接正确，Phase 1.4 已加载；尚未执行 `task.py start`。

## 2026-07-31 可信写作上下文传递

范围：`.trellis/tasks/07-31-trusted-writing-context`。只修复自由文本 live loop 中
`file.create` / `file.revise` 到内层 `assistant.draft` / `assistant.revise` 的可信 context 断链，
以及对应安全 provenance 和 Desktop author-loop 投影；未实现 `.资料` 自动发现、Permission Policy、
章节 brief/质量门或完整 Chapter Writing Module。

实现结果：

- provider 生成的 `project_root`、`file_path`、`content`、三类 context 内部字段与 provenance 字段
  在 loop 边界统一剥离；目标路径/正文继续由项目边界解析。
- `ToolExecutionContext.args.context_bundle` 经既有 `build_llm_context_snapshot` 净化、预算与去重后，
  转为 inner prompt bundle；create/revise 的 `ToolResult` trace 留下 snapshot id、实际相对路径、count、
  source 与 warning count，不落 excerpt、正文或绝对项目根。
- Desktop 正常结算与 F10 恢复都通过同一个 decoder 优先读取 backend provenance；新后端明确返回空列表时
  不伪造本地路径，只有旧响应缺 provenance 才回退本轮本地 bundle。该数组继续同时进入版本 snapshot
  与 author-loop 记录。

红绿与回归：

```text
uv run pytest tests/test_agent_loop_writing_context.py -q
  -> RED: create 内层 prompt 无 GOLDEN_SPEC_SENTINEL；revise 采用 MODEL_FAKE_CONTEXT_SENTINEL
  -> GREEN: 2 passed
npm --prefix apps/desktop/frontend run test -- --run tests/agent-result-context.test.ts
  -> RED: contextFilesFromAgentResult 不存在（3 failed）
  -> GREEN: 3 passed
API 定向组合（含 context/live-loop/source/BookRun CLI 回归） -> 57 passed
API SSE/golden/save-point 扩展组合                         -> 79 passed
Desktop 全量 Vitest                                      -> 77 files / 484 passed
npm --prefix apps/desktop/frontend run typecheck          -> passed
uv run ruff check app/domains/agent_runs ...              -> passed
git diff --check                                          -> passed
```

仓库总门禁：第一次 `pnpm verify` 的 1263 项 API 中有 1 项红，定位为
`tools/__init__.py` 聚合导出 runtime helper 引入 BookRun CLI 循环依赖；改为从公开子模块
`tools.runtime_arguments` 直接导入后，独立回归转绿。第二次完整 `pnpm verify` 通过：

```text
root ESLint + Prettier                 -> passed
Desktop typecheck                     -> passed
shared type contract                  -> passed
project-core                          -> 7 passed
Desktop Vitest                        -> 484 passed
API pytest                            -> 1260 passed, 3 skipped
API Ruff                              -> passed
sidecar daily smoke                   -> passed（SSE 2 帧、control、alembic、prompt bundled）
OpenAPI + Agent frame drift gate      -> no drift
```

Wire 判断：只在既有 `AgentToolTrace.input_summary` generic object 内增加安全字段，没有新增/修改路由、
DTO、SSE 顶层字段或 generated schema；总门禁仍执行了 OpenAPI/Agent frame 刷新并确认无漂移。

真实 provider 首次复核未通过：隔离临时项目显式选择黄金三章 spec 后尝试真实 live loop，源码环境旧配置
返回 HTTP 401。作者随后要求改用装机版配置；隔离进程直接读取装机版 `llm-provider.json`，provider health
于 292ms 返回 `ok`，可见 `deepseek-v4-flash` / `deepseek-v4-pro`，全程没有复制、输出或持久化 key。

使用该装机配置重跑真实 live loop：outer Agent 读项目文件后调用 `file.create`，inner
`assistant.draft` 收到 2 个显式选择文件；writing trace provenance 为
`.资料/黄金三章-spec.md`、`.资料/写作-playbook.md`，source=`request_bundle`、warning=0，snapshot id
与 sibling summary 一致。trace/event 不含 context excerpt 或绝对项目根，durable evidence 不含 API key。
最终 `proposed_patch` 指向 `正文/第04章.md`，before=0、after=1614 字、`requires_confirmation=true`，
且确认前临时项目中目标文件不存在。证据见当前 Trellis 任务的 `real-provider-summary.json` 与
`real-provider-draft.md`；内存 SQLite 和系统临时小说目录已清理，未触碰 `D:\连载`。

人工通读不判章节质量通过：6 条硬任务中，开场冲突、天枢架位、观澜身份红线、长度 4 项命中；
“为救知情人而失去物证”的主动取舍没有成立，“阿梧”没有落在章末，结尾“天枢，从来不是架位”还
削弱了本章刚兑现的线索；库房仍在延烧时人物停下验钉和问话，也有现场逻辑问题。真实 provider 已证明
可信上下文和补丁红线接通，但不能据此宣称写章质量稳定或真机 Desktop author-loop / diff 点击确认通过。

## 2026-07-31 Agent Permission Policy

范围：`.trellis/tasks/07-31-agent-permission-policy`。Desktop 的四档权限选择现已成为下一次
AgentRun 的持久设置，并以顶层 SSE `permission_profile` 进入 API；run 创建时快照，恢复没有新值时
保留已持久化的 canonical profile。

实现与复核：

- API `permission` public face 集中 canonical 值、legacy alias、严格请求校验、历史 evidence 安全投影、
  stage policy 与 ToolSpec 风险 gate。未知显式值为 422；`read` 在 handler 前阻断写类和长任务。
- `risk_confirm` / `autonomous` 仅可生成待确认 patch，始终不能绕过 Desktop diff confirmation、
  snapshot-before-write 或 guarded writeback。`step_confirm` 已提供阶段决策，但通用 live loop 尚无 durable
  brief replay，因此当前写类工具诚实地在 handler 前阻断。
- `agent_run_started` frame、permission、terminal、pending recovery 与 BookRun snapshot 都投影 canonical
  profile。由 Agent 启动的 managed BookRun 镜像仅在首次创建时继承来源 run 的 profile；独立后台 run 保持
  `risk_confirm`，后续来源设置变化不改写镜像快照。
- 已新增 `.trellis/spec/storyforge-api/backend/agent-permission-policy.md`，把跨 Desktop/API/ToolSpec/evidence
  的可执行契约和错误矩阵固化下来。

验证：

```text
uv run pytest tests/test_agent_permission_policy.py -q  -> 18 passed
uv run ruff check <permission policy affected paths>    -> passed
git diff --check                                        -> passed
pnpm.cmd verify                                         -> passed
  root ESLint + Prettier                                -> passed
  Desktop typecheck                                     -> passed
  project-core                                          -> 7 passed
  Desktop Vitest                                        -> 77 files / 486 passed
  API pytest                                            -> 1279 passed, 3 skipped
  API Ruff                                              -> passed
  sidecar daily smoke                                   -> passed
  OpenAPI + Agent frame drift gate                      -> no drift
```

未验证：尚未在真机 Tauri 中完整点穿“Settings/Composer 改档 -> 新对话 -> evidence -> 重启持久化 -> diff
确认写回”链路；`step_confirm` 的真实 brief checkpoint 要等 Chapter Writing Module 提供 durable stage
replay 后再启用。本任务未触碰 `D:\连载`，也未纳入既有 `apps/desktop/src-tauri/Cargo.lock` 改动。

## 2026-07-31 按项目的 Agent 权限（Codex Desktop 式四档 + 自动落盘）

作者拍板：做成「Codex Desktop 对项目的权限」。四个方向性取舍先问后做，均由作者选定——
①「自动」档真自动落盘（越界才问）②档位表 read / ask / auto / full ③按项目存本机
④ Ctrl+K / Ctrl+Shift+K 只被只读档管住。本波同时收口上一刀 review 出的三条。

### 改了什么

- **档位词表**收敛为 `read` / `ask` / `auto` / `full`，DEFAULT=`ask`。**所有历史档位
  （risk_confirm / step_confirm / autonomous / full_allow / autonomous_approval）一律迁到 `ask`**：
  迁移绝不把任何既有 run 或既有作者设置升级成免点击落盘，`auto` / `full` 只能按项目显式选一次。
  这条是本波唯一不可回退的安全性质，已用参数化测试钉死。
- 上一刀的四档里，`autonomous` 与 `risk_confirm` 逐格决策完全相同（实测矩阵）、`step_confirm`
  对 5 个 write_pending 工具全阻断且循环内无审批出口——两者都已消失：`autonomous` 并入 `ask`，
  新的 `auto` 才有真实差异，`full` 的差异是长任务免二次确认。
- **写回红线改写**（作者显式授权）。没变的部分：后端在任何档位都不写项目文件，只出
  proposed patch；落盘一律经 `performGuardedWriteback`（写前快照 → 原子写 → 版本记录）。
  变的部分：「作者必须逐次点接受」不再是全局不变量，而由
  `PermissionPolicy.decide_stage(profile, "writeback")` 单点派生到
  `proposed_patch.requires_confirmation`（read/ask=True，auto/full=False）。Desktop 只读这一位，
  不按档位字符串自推（业务结论留在 API 侧）。5 处补丁构造点与 `judge.repair` 的 artifact 全部改为派生。
- 自动档不放宽的守卫：漂移拒写、`.storyforge/canon/derived/` 只读、项目边界、写前快照、撤销 toast。
  任一守卫拦下即退回 PatchReviewPanel 手动确认，绝不静默丢弃。顺带补上
  `writeAcceptedSuggestion` 此前**缺失**的派生目录闸（`saveCurrentFile` 一直有，AI 写回这条漏了；
  自动档下补丁不再经人眼，漏了会静默写坏派生缓存）。
- **按项目存本机**：`storyforge:agent-permission:<projectPath>`（照 daily-progress 模式）。刻意
  不写进 `.storyforge/`——把「自动落盘」授权随 git 传播给克隆的人是安全倒退。SettingsView 的全局
  Agent 分区已撤除（per-project 设置放全局设置页是范畴错误），入口收在 Composer 下拉。换项目在
  渲染期同步换档而非 useEffect，避免「切项目后第一帧按上一个项目的授权发出去」。
- Ctrl+K / Ctrl+Shift+K 走 `/api/assistant/*`、不经 AgentRun gate，只在只读档挡住发起；判定读
  localStorage 现值而非缓存 prop（授权判定要用作者此刻的选择）。
- 上一刀 review 的三条：`confirmed` / `user_confirmed` 进 `PROTECTED_LOOP_TOOL_ARGUMENT_KEYS`
  （唯一能把模型参数变成权限授予的键）；`create_or_resume_agent_run` 续接改吃
  `canonical_permission_profile` 容脏历史（此前严格校验会把整次续跑打成 500）；file.revise 的 loop
  `output_summary` 补回 `file_path` / `patch_id`（覆盖 `_tool_output_summary` 时丢了）。

### 验证

```text
pnpm.cmd verify                                   -> 全绿
  root ESLint + Prettier                          -> passed
  Desktop typecheck                               -> passed
  Desktop Vitest                                  -> 79 files / 494 passed
  API pytest                                      -> 1296 passed, 3 skipped (272s)
  API Ruff                                        -> All checks passed
  sidecar daily smoke                             -> 全绿
  OpenAPI + Agent frame drift gate                -> no drift
```

护栏打在接线上，且经变异验证：

- API `test_agent_loop_permission_writeback.py`：真跑 chat 工具循环，`ask` vs `auto` 下
  `proposed_patch.requires_confirmation` 与 `agent_result.requires_user_confirmation` 同步翻转，
  **两档下磁盘都不动**（后端红线未放宽的实证）。
- Desktop `tests/behavior/auto-writeback.test.tsx`：挂载真 `useSuggestionWriteback`，钉死四条——
  自动档无点击即落盘且顺序仍是先快照后写盘、询问档不落盘、确认位缺失失败关闭、快照失败阻断写盘
  且不记闭环。**变异验证**：把自动接受接线短路后，只有第一条断言变红，其余三条仍绿（说明它们各测各的）。
- Desktop `tests/agent-permission.test.tsx`：两项目各记一份互不串档、存档里的旧值读出来是 `ask`
  不是 `auto`、只读档挡住发起、自动落盘判定表、补丁确认位失败关闭。

### 未联通 / 不能宣称

- **真机未验**：「改档 → agent 直接落盘 → 撤销 → 重启后档位仍在」没有在装机版点穿，归 E2E-1。
  自动档也尚未在真实写作里连用过。
- **撤销网仍薄，自动档会放大**：版本快照每文件上限 20 份（连发自动落盘更容易挤掉中间态）、撤销
  toast 只在内存里且要求内容未再变、**新建文件自动落盘没有回滚点**（快照 previous 为空，撤销只会
  写回空串而不是删除文件）。作者选 `auto` 前应知道这一条；本波没有加深安全网。
- `full` 档只在长任务上与 `auto` 有差异；BookRun 是后台工具，该差异未在真实长任务上跑过。
- 本任务未触碰 `D:\连载`。`.trellis/spec/.../agent-permission-policy.md`（gitignored 本地规格）已随之
  重写，否则下一轮会照着上一版错的契约写。

## 2026-08-01 加深自动档的撤销安全网

上一波交付时如实记了自动档的三条薄弱面，作者要求「加深安全网」，并在两个深度里选了
「三洞各补一刀 + 本轮检查点」。

### 先纠正一条事实

`snapshotBeforeWrite` 的注释写着「若文件尚不存在（首次创建）则跳过」，**代码里从来没有这个判断**。
新建文件实际会存一份内容为空串的快照——所以不是「没有回滚点」，是**有一个假的回滚点**：恢复它
等于把文件清空，而不是让它回到不存在。撤销同理（写回空串）。

### 改了什么

- **检查点独立配额**：`source=Agent` 的写前快照改落 `.storyforge/versions/<file>/checkpoints/`，
  与普通快照**各算各的 20 份**。此前 autosave（900ms 防抖）与 agent 写回挤同一个池子，
  写一会儿最该留的那份先被冲掉。快照 meta 增记 `runId`，版本历史里两个目录合成一条倒序时间线，
  检查点条目带「检查点」标记。因为「一次对话最多一个待确认补丁」，一次 run 至多写一个文件，
  所以每次 agent 写回就是一个轮次锚点。
- **新建文件的真回滚点**：`snapshotBeforeWrite` 写前探测目标是否存在（探测失败一律按「已存在」，
  宁可写回空内容也绝不误删），meta 记 `created` 并回传给调用方。撤销一次新建改为**删除文件 +
  摘掉页签**——页签不摘的话，开着 autosave 下一次防抖就把刚删的文件原样写回来了。版本历史里
  这类条目标「新建前」，说清楚恢复它只会清空内容。
- **撤销失效不再是死路**：文件在写回后又被改过时，一键撤销确实不能用（会吃掉新输入），但检查点
  还在盘上。toast 从 error 改为带「打开版本历史」动作，直接把作者送过去。

刻意没做：跨文件回滚。当前后端一次 run 至多产出一个补丁，跨文件回滚没有真实触发场景，
先不引入这套数据结构。

### 验证

```text
pnpm.cmd lint                                     -> passed
Desktop typecheck                                 -> passed
Desktop Vitest                                    -> 80 files / 503 passed
API pytest                                        -> 1296 passed, 3 skipped
```

`pnpm.cmd verify` 首跑时 `test_real_llm_connectivity_probe_script.py` 红一次，单独复跑 10 passed、
整轮复跑全绿；该探针用例满载并跑时 flaky 是既有已知问题，本波改动全在前端，未触碰 Python。

护栏（新增 9 条，全部经变异验证）：

- `tests/versions-checkpoint.test.ts`：检查点落 checkpoints/、**40 次 autosave 之后 agent 那份检查点
  仍在**、检查点自己也有上限、「新建」与「内容为空」可区分、探测失败按已存在处理、版本历史合并两目录。
- `tests/behavior/auto-writeback.test.tsx`（挂载真 hook）：撤销新建 = 删文件 + 摘页签且不再写空内容、
  撤销普通修订仍写回原文不碰删除、内容已变时不覆盖新输入且给出版本历史入口。
- **变异验证**：把 ①检查点写回主目录 ②撤销新建走写回分支 ③撤销失效的 toast 去掉动作 三处同时打断，
  恰好红了对应的 6 条断言，其余 7 条仍绿。

### 仍未联通

- 真机未点穿：「自动档连写几轮 → 翻版本历史找到检查点 → 恢复」这条路没有在装机版走过；
  撤销新建的删文件行为也只在挂载测试里验过，未在真机确认页签摘除与 autosave 不复活。
- 检查点上限是 20，同一文件连续 20 轮以上 agent 写回后，最早那轮的锚点仍会被淘汰。
- 版本历史里恢复一条「新建前」快照仍然只是把内容清空，不会删文件（已在 UI 上如实标注）；
  真正的删除入口仍在文件树。

---

# 验证报告 · prompt 对比实验台 + 三波实验 + 删例合入

时间：2026-08-01

## 建了什么

`apps/api/scripts/prompt_lab/`：固定输入 × 变体配置 × 真 LLM 输出 → 并排报告的 A/B 实验跑道。

- 变体注册表：baseline 恒等引用生产 builder；变体从 baseline 渲染结果做 section 级删除/替换（零文案双源漂移）。
- runner CLI：`--dry-run` 零成本预验、`--jobs` 线程池并发调 LLM（渲染串行防 patch 钩子互踩）、
  `--repeat N` 统计性重复（结果进 repeats 数组）、`--merge` 格子级补跑合并、`--seed` 盲评重排、
  **实时落盘**（每格完成立即写 outputs 文件，key 中断不丢已完成格）。
- report：指标表 + 分节正文 + difflib 差异块 + 结论占位（人工判定）；blind.md 盲评版 seed 可复现。
- fixtures：雾港种子手写 NarrativeContext×3（开篇/过渡章/高潮对峙）+ 埋雷 MANUAL_DRAFT + 6 任务。

## 三波实验

| 波次 | 内容 | 结果 |
| --- | --- | --- |
| wave1 | 5 任务 × 变体全量（22 格，含 agent 组装链/评稿/修订） | 零 adopt，baseline 全线保留；no-examples → retest |
| wave2 | 2 任务 × 4 变体 × 3 重复（21/24 有效） | **no-examples → adopt**；half-examples → 不采用；task-rewrite → retest |
| wave3 | 高潮对峙新任务 × 4 变体单次（实时落盘） | 进行中（task-rewrite 已落盘） |

判定方式：workflow 三轮（任务级评审 → 对抗验证 → 综合定论），对抗验证全部 refuted=false，
引文逐字核验。证据目录 `.codex/prompt-lab/wave1/2/3/`（gitignored 不入库）。

## wave2 关键裁决

- **no-examples（删创作准则段的正反例锚点）→ adopt**：wave1 触发 retest 的「完整章丢必含事实
  （密钥/守塔人 0 命中）」在 wave2 未复现——两任务 6 次重复零丢失，且删例方向锚定观测更强
  （baseline 12 采样密钥点名 1/3 vs no-examples 12/12）。「必含事实与正反例行无耦合」成立。
- half-examples → 不采用（样本不足 + 无独立优势）；task-rewrite → retest（预览 3/3 better 出现反例，
  完整章样本不足，待无例生产基线上重测）。
- 附带合入：critique 评稿 prompt 显式写死评分方向（高分=好，含 narrative_collapse/ai_artifact_penalty）。

## 合入生产（删例）

`app/domains/book_runs/prompts/_sections.py::_craft_section` 删除好坏对照锚点渲染（保留 6 条准则）；
连带清理 `_sections.py`/`builder.py` 的 `CRAFT_EXAMPLE_*` re-export、registry 的 no-examples/half-examples
变体与对应测试。`app/common/craft.py` 常量与 `craft_prompt_clause(with_examples=True)` 保留
（assistant/service.py 的 file.create 路径仍用，不在实验覆盖内）。

### 验证

```text
uv run pytest tests/test_prompt_lab.py tests/test_prompt_assembly.py  -> 28 passed
uv run ruff check app/domains/book_runs/prompts/ scripts/prompt_lab/ tests/test_prompt_lab.py -> passed
```

### 仍未联通

- task-rewrite 在无例生产基线上的完整章稳定性未测（key 额度所限，留 retest）。
- wave3 高潮场景 4 变体输出已落盘但未评审。
- 真机桌面端未参与本波（纯 API/脚本层实验）。

# 2026-08-01 file.create 对齐删例 + 实验台指路

## 背景：吸收面复核

复核上波「删例」的吸收面，追调用链发现结论只落在一条链上：`_craft_section()` 仅被
`book_runs/prompts/builder.py` 的 4 个构建器消费 → `build_draft_prompt_from_state` →
`book_generation_draft.py`，即 **BookRun 后台工具**路径。桌面 live 的四条产字路径走的是
另一份形态 `app/common/craft.py::craft_prompt_clause()`，两者共用 `CRAFT_GUIDELINES` 文本、
锚点各存各的。live 四条里三条默认无例（结论对其空转），唯一带例的是 `file.create`
（`assistant/service.py::_DRAFT_SYSTEM_PROMPT`，`with_examples=True`）——上波已记为
「不在实验覆盖内」，本波按作者决定对齐。

## 改动

- `assistant/service.py::_DRAFT_SYSTEM_PROMPT`：`craft_prompt_clause(with_examples=True)`
  → `craft_prompt_clause()`。至此生产两条链均无锚点。
- `app/common/craft.py`：`CRAFT_EXAMPLE_BAD/GOOD` 与 `with_examples` 形参**刻意保留**（生产零调用方）。
  理由：prompt_lab 的变体纪律是「从生产常量做同源增删、不手抄文案」，留着才能在 live 链上重跑
  with/without 对比；删掉则未来只能从 git 历史抄回文案，正是该纪律要防的双源漂移。
- 新护栏 `tests/test_craft_guidelines_reach.py::test_no_prose_path_carries_example_anchors`：
  四条 live 产字 prompt 逐条断言不含锚点原文——常量既然留着，「生产没挂回来」必须由断言守住。
- `CLAUDE.md` §4 新增「prompt 对比实验台」小节：CLI 用法、变体纪律、**两条 prompt 链分开**的提醒、
  已裁定结论。此前仓内零指路（`docs/` + `CLAUDE.md` grep `prompt_lab` 无命中），下轮会话发现不了。

## 验证

```text
uv run pytest -q                                          -> 1314 passed, 3 skipped (263.77s)   # 上波删例合入零回归（作者曾叫停，本波补跑）
uv run pytest tests/test_craft_guidelines_reach.py tests/test_prompt_lab.py \
              tests/test_prompt_assembly.py tests/test_scene_discipline_reach.py -q -> 53 passed
uv run ruff check app/common/craft.py app/domains/assistant/service.py \
              tests/test_craft_guidelines_reach.py        -> All checks passed
```

变异验证（护栏可证伪）：把 `_DRAFT_SYSTEM_PROMPT` 定点改回 `with_examples=True` →
`test_no_prose_path_carries_example_anchors[file.create（assistant.service）]` FAILED（1 failed, 14 passed），
还原后 15 passed，`git diff --numstat` 确认 1 增 1 删无空白噪音。

## 仍未联通

- **file.create 的对齐是外推，不是实测**：三波实验只覆盖 `book_runs` 的多行 section 形态，
  扁平子句形态（live 四条）一次都没进过实验矩阵。若要实测需在 live 链上跑 with/without 对比。
- live 链的实验形态尚未跑通：`agent_registry.py` 的 `agent-baseline` 在 wave1 只出 26 字符
  （模型答「先读项目文件」即停——实验未挂 tools），agent 侧对比数据为空。
- task-rewrite 在无例基线上的重测未做（key 额度所限，沿用上波记档）。
- 真机桌面端未参与（纯 API 层改动）。

# 2026-08-01 出网自报 User-Agent（Cloudflare 1010 真 bug）

## 触发

接入作者新给的 OpenAI 兼容中转站时，`llm_client` 全线 403。抓原始响应为
`error code: 1010`（Cloudflare「banned based on browser signature」）——根因是
`openai_compatible_headers` 不设 UA，urllib 缺省自报 `Python-urllib/3.x`，被默认 WAF 规则拦。

UA 逐项实测（同 key 同端点 `/v1/models`）：

```text
缺省 Python-urllib                       -> 403 error code 1010
StoryForge/0.1.10                        -> 200
StoryForge/0.1.10 (+github 链接)          -> 200
curl/8.4.0                               -> 200
Mozilla/5.0 ... Chrome/126.0             -> 200
```

只有缺省 UA 被拦，任何显式 UA 均通——故取自报身份 `StoryForge/{APP_VERSION}`，不伪装浏览器。

## 影响面

BYO-key 是产品形态（作者自带 key 接任意中转站），Cloudflare 前置的中转站相当常见。
命中时表现为「key 明明有效却全线 403、报错不说原因」，作者无从自查。

## 改动

- `app/common/llm_http.py`：新增 `USER_AGENT = f"StoryForge/{APP_VERSION}"`，
  `openai_compatible_headers` 两条鉴权分支（bearer / api-key）共用同一 headers 起点故同时覆盖。
  `version.py` 是纯叶子，不破 llm_http 的无依赖约束。
- `tests/test_llm_http_env_parsing.py::test_headers_carry_self_identifying_user_agent`：
  两条鉴权分支逐条断言 UA 以 `StoryForge/` 开头、不含 urllib、且跟随 `APP_VERSION` 单点。

## 验证

```text
uv run pytest tests/test_llm_http_env_parsing.py tests/test_llm_client_channel.py \
              tests/test_assistant_continue.py -q      -> 53 passed
uv run ruff check app/common/llm_http.py tests/test_llm_http_env_parsing.py -> All checks passed
真跑：resolved_llm_env + call_llm_messages 打新端点 -> 200，content/token_usage 正常回填
```

变异验证：摘掉 headers 里的 `"User-Agent": USER_AGENT` →
`test_headers_carry_self_identifying_user_agent` FAILED（1 failed, 2 passed），还原后 3 passed。

## 仍未联通

- 只在一个 Cloudflare 前置端点上实证；其他 WAF 形态（JS challenge、mTLS）不在覆盖内。
- 冻结 exe / 真机桌面未复验（纯 header 改动，sidecar 走同一函数）。

# 2026-08-01 wave4：live 链删例实测（补上一刀的外推缺口）

## 换端点

作者换 key 两次。第一个（自称 grok-4.5）**判定为不可用作实验基底**：在我们的消息前注入约
4544 token 的编码 agent 系统提示词（1 字符输入 → prompt_tokens 4545；100 字符 → 4625，
增量 80 ≈ 我们那 100 字），发 `"1"` 回「Workspace exploration starting now」、自报
「Codex，基于 GPT-5」。变体差异会被这段隐藏前缀淹没，任何结论都不成立。
第二个 key 干净（1 字符 → 5 tokens），模型册为 Claude 系 6 个，作者选 `claude-sonnet-5`。

网关可靠性实测：短请求（~100 token 输出）6.4s；400 字格 64s；800–1200 字格 **280s 未完成**，
另有两次 `ConnectionReset`。故 wave4 缩到只跑 400 字的短格。
**顺带风险**：`file.create` / `file.revise` 是非流式，作者在桌面起草整章大概率撞上此超时；
`prose.continue` 走流式不受影响。

## 新增 live 链变体（补 2026-08-01 记档的「外推未实测」）

`registry.py` 新增 kind `live-draft`：`live-baseline`（`_DRAFT_SYSTEM_PROMPT` 恒等引用，
现生产=无例）vs `live-with-examples`（同源替换把锚点挂回）。两版实证**只差那 91 字符锚点**
（740 → 831，`w.replace(BAD+GOOD,"") == b` 成立）。system prompt 经生产唯一组装点
`build_generation_system_prompt(..., None)` 出；user 消息经生产 `_build_draft_prompt` 渲染，
不手写。`runner` 的 `_SYSTEM_PROMPT_KINDS` 收口「变体出 system prompt」这类 kind。

## wave4 结果（live-opening，2 变体 × 3 重复 = 6 格，全绿）

确定性指标：

```text
                     字数均值        密钥  左臂  无雾失真  老周   陈词
live-baseline(无例)   523 (+31%)     3/3   3/3   3/3     3/3   无
live-with-examples    505 (+26%)     3/3   3/3   3/3     3/3   无
```

（「密钥」按任意形态计；显式说出「密钥」一词的：无例 0/3、挂例 1/3。）

**判读：keep-baseline —— 未发现挂回锚点带来收益。** 两组必含事实全命中、零陈词、篇幅同样
超目标 26–31%（差异在噪声内）。文笔亮点反而集中在无例组：「那根烟是直的，没被捏扁」
（用物证反推老周不紧张）、「春天。她左臂受伤之前。」（把必含事实转成时间线线索）、
用「你那臂膀好些了没有」岔开话题（比直说「我只知道一点」高级）。挂例组亮点较少，
A1 结尾「知道一点……但不是我干的」偏直白交代。

结论方向与上一刀的外推一致、无反证，故 `file.create` 保持无例，**不做任何生产改动**。

## 本波修的三个工具缺陷（均变异验证）

1. **docstring 写了不存在的 `--blind`**，照抄即 argparse 报错，且该假用法已被抄进 CLAUDE.md。
   修两处 + 护栏 `test_runner_docstring_examples_use_real_flags`（正则抓 docstring 全部
   `--flag` 反查 parser）。
2. **`--out` 跟 cwd 跑偏**：从 `apps/api` 跑 `--out .codex/...` 落进 `apps/api/.codex/`，
   而 `.gitignore` 的 `.codex/*` 锚在仓根覆盖不到，证据目录变未跟踪文件。改为相对路径锚仓根
   （绝对路径原样）+ 护栏。
3. **盲评版根本不盲**：`blind.md` 保留 `prompt字符` 列，831/740 直接点名两个变体——本波判读
   因此不是真盲评。盲评版删该列（输出侧指标保留）+ 护栏。

## 验证

```text
uv run pytest tests/test_prompt_lab.py -q                    -> 21 passed
uv run ruff check scripts/prompt_lab/ tests/test_prompt_lab.py -> All checks passed
wave4 真跑 6/6 成功，证据 .codex/prompt-lab/wave4/（gitignored）
```

## 仍未联通

- **样本极弱**：n=3/组、单模型（sonnet-5）、单任务形态（400 字开篇）。长格（完整章）因网关
  跑不动未测——而删例的原始争议点恰恰出在长格（wave1 的丢事实）。
- 本波判读由单人完成，无对抗验证（前两波用的三轮 workflow 本会话未获授权）。
- 判读时盲评已被 prompt 字符数泄露；修复后的盲评版未用于本波。
- `critique` / `revision` / 长格 live 变体均未跑。

# 2026-08-01 产字路径改流式传输（修中转站掐断长文）

## 起因

wave4/5 实测：同一 climax prompt（800–1200 字），非流式 **280s 未返回 + ConnectionReset**，
流式 **72.4s 出 1347 字**。产字路径全是非流式，作者在桌面起草整章会撞上同一堵墙。

## 做法：服务端聚合的流式，HTTP 契约零改动

`llm_client` 新增 `call_llm_streamed()`——与 `call_llm()` 同签名、同返回 dict，差别只在
传输走流式后由服务端聚合（流式终帧与非流式返回本就逐键同构，都由 `_token_usage` +
`_cost_breakdown` 组，故只需摘掉 `type`）。切换三条长文路径：

- `draft_file_content`（file.create）
- `revise_file_content`（file.revise）
- `draft_continuation`（非 SSE 续写）

`chat_reply` 刻意不改：短问答没有被掐断的体量。前端零改动、OpenAPI 零漂移。
**注意这不是端到端 SSE**（作者看不到逐字冒出），那是另一刀。

两个刻意的边界：
- **终帧缺失必须抛错**——上游提前关流时静默返回空正文会把缺文当成功写进补丁。
- **空 system 段不落进 messages**——实验台的单条 user prompt 形态若被硬塞空 system，
  与 wave1-3 就不是同一个输入，破坏波次可比性。

## wave5：长格首次跑通（此前 0/1，现 5/6）

`live-climax`（800–1200 字）× 2 变体 × 3 重复，按 metadata 真实成功数统计：

```text
                     n   字数            越界(800-1200)  必含事实  不可逆后果  陈词
live-baseline(无例)   2   1350,1208       2/2            4/4      2/2       无
live-with-examples   3   1077,1412,1174  1/3            4/4      3/3       无
```

**wave1 判 retest 的理由是「删例后完整章丢必含事实（密钥/守塔人 0 命中）」——本波在长格上
未复现**：无例组两次全部命中密钥 / 左臂 / 无雾失真 / 守塔人 + 摔碎密钥的不可逆后果。
篇幅两组都偏长，挂例组略好但 n=2 vs 3，不构成判据。生产零改动。

## 顺带修的真 bug：重复写盘虚增样本

实时落盘按「已成功数」编号、`_write_artifacts` 按「repeats 位次」编号，两套口径不一致 →
wave5 的 2 次成功落出 3 个文件、r1 与 r2 逐字节相同。**按 `outputs/*.txt` 数样本（评审 agent
与人工判读都这么读）会把 n=2 当 n=3**，第一版 baseline 统计表即被此污染。统一为位次口径
（失败留编号空档），护栏断言「文件编号 ↔ repeats 位次」一一对应。

## 测试桩失配（27 红，非产品回归）

既有用例 patch 的是 `assistant_service._call_llm`，调用点换成 `_call_llm_streamed` 后 patch
失效、真去联网（`LLMConfigError: 缺少 STORYFORGE_LLM_BASE_URL`）。涉及 11 个文件。
修法：这些用例的本意是拦住出网、不是断言用哪种传输，故一律两个符号一起打桩
（单行形态 16 处改双 seam 循环，多行形态 9 处补 `_call_llm_streamed = _call_llm` 别名）。

## 验证

```text
uv run pytest -q                     -> 1330 passed, 3 skipped（基线 1314 + 本刀 16 新测试，零失败）
uv run ruff check tests/ scripts/ app/common/llm_client.py -> All checks passed
真跑：climax prompt 非流式 280s 超时 vs 流式 72.4s/1347 字
```

变异验证（三条，均先红后绿）：
- 把 `draft_file_content` 退回 `_call_llm(` → `test_prose_paths_use_streamed_transport[draft_file_content]` FAILED
- 实时落盘退回「已成功数」口径 → `test_realtime_and_final_output_files_agree` FAILED
- 盲评版塞回 `prompt字符` 列 → `test_blind_report_hides_prompt_chars_fingerprint` FAILED

## 仍未联通

- **不是端到端流式**：作者看不到逐字冒出；要做需改 router + 前端 + 契约。
- 只在一个 Cloudflare 前置中转站上实证掐断与修复；其他网关未验。
- 真机桌面未验（纯 API 层传输改动，归 E2E-1）。
- wave5 样本仍弱（n=2/3、单模型、单任务）；baseline 有 1 格「流式返回内容为空」未复跑。

# 2026-08-01 BookRun 摘除桌面入口（退役，代码留着）

## 背景更正

作者问「bookrun 不是退役了吗」。查证：**退役的是 `apps/workflow`（LangGraph 批量整书编排器，
2026-07-26 整包删除），`app/domains/book_runs` 没有** —— 它在 DOMAINS.md 是 backing 档，
且有明文红线「质量轨资产一行不删，直到真实长程重跑验收完成」。作者据此拍板：**摘入口、留代码**。

顺带修正 DOMAINS.md 的一句错话：原文写 `book_runs`（managed BookRun + **agent-loop prompt 装配**），
但实测 `agent_runs` 从本域只导入 `BookRun` 模型与 2 个异常类，**根本不用它的 prompt 构建器**
（循环产字走 `app/common/craft.py::craft_prompt_clause`）。这句话正是「改 book_runs prompts
= 改 agent 循环」这个误解的来源。

## 先做的解耦（无论退不退役都该做）

`assistant/service.py` 原先 7 个 import 块从 `book_runs.book_generation` 取 LLM 传输 / 配置，
但 `call_llm` / `env_value` / `llm_request_headers` / `optional_float` / `required_env` 的真身在
`app/common/llm_client.py`、`resolved_llm_env` 在 `app/common/llm_env.py`，book_generation 只是
facade 转发。改为直连真身后，**live 的 assistant 对 backing 的 book_runs 依赖从 7 降到 1**
（只剩 2 个异常类 + `missing_book_generation_env`，加 models 里的外键类型）。

## 摘掉的三个入口（只摘登记，实现全留，逐条可回滚）

| 入口 | 摘除点 | 回滚 |
|---|---|---|
| IDE 命令面板 | `command_registry._BUILTIN_COMMANDS` 的 5 条 `bookrun.*` | 加回 5 行 `IdeCommandDefinition` |
| agent 循环工具 | `catalog` 的 `*BOOKRUN_TOOL_SPECS` + `runtime_tools` 的 `handlers.update` | 恢复 import 与这两行 |
| 显式 intent 固定管线 | `intent.SUPPORTED_INTENTS`、`book_id+blueprint_id` 参数抢跑、固定管线分派表 | 加回三处 |

`_execute_bookrun_command` / `managed_bookrun_handlers` / `run_bookrun_generation_pipeline` /
`specs/bookrun_specs.py` / book_runs service + models + REST 全部保留。
**至此桌面完全没有起 BookRun 的入口**（不是变隐蔽，是没有）。

## 刻意没做的两件

- **没卸 REST router**：实测卸载会让 **37 个 BookRun REST 测试**红（`test_book_runs` /
  `book_run_start` / `budget` / `controls` / `resume` / `workflow_dispatch` / 两个导出），
  那批正是「质量轨资产」，删它与作者选的「代码留着」和红线都相反。前端**零调用**
  `/api/book-runs`，卸它对产品体验零改变。已回退，契约仍 86 条、零漂移。
- **没删前端 `agent-step-mapping.ts` 的 `'bookrun.start': '启动写作任务'`**：那是流程树标签，
  作者本机 sqlite 里的历史 run 仍存着该步骤，删了旧记录会渲染成裸 id。

## 测试改动（3 个端到端用例 → 4 个可证伪守卫）

删除的是**命令层 / 入口层**覆盖，不是 BookRun 行为覆盖——「控制必须真更新状态」仍由
`test_book_run_controls.py::test_book_run_control_endpoints_pause_stop_and_retry`（REST 层）保证。

- `test_ide_commands.py`：3 个 bookrun 命令用例 → `test_bookrun_commands_stay_unregistered`
- `test_agent_adapters.py`：覆盖测试 → `test_bookrun_tools_stay_unregistered`；路由测试改为断言
  `bookrun.start` 现在被固定管线**拒绝**
- `test_ide_agent_intents.py`：2 个端到端用例 → intent 未注册 + 结构化参数不再抢跑 两个守卫

## 验证

```text
uv run pytest -q            -> 1328 passed, 3 skipped（零失败）
uv run ruff check tests/ app/ -> All checks passed
node scripts/check-openapi-drift.mjs -> OpenAPI 契约无漂移
```

变异验证：把 `bookrun.start` 的 `IdeCommandDefinition` 加回命令表 →
`test_bookrun_commands_stay_unregistered` FAILED，移除后复绿。

## 仍未联通

- BookRun REST 面（12 条契约路径）仍挂着，只是无人调用；真要收窄需另行决定如何处置那 37 个测试。
- 真机未验：装机版里「命令面板搜不到写作任务」「agent 不再提议 bookrun.start」归 E2E-1。
- `writing_runs` seam 与前端 `writing-run.ts` 的 `book_run_id` 解析仍在（防御性读取，现无来源）。

# 2026-08-01 prompt_lab 实验证据清理（结论已全部落码）

## 盘点：五波实验的精华已在 master

作者问「实验精华合进项目了吗」。逐条核对，全部已合并、工作区干净：

| 结论 | 落点 |
|---|---|
| 删创作准则的正反例锚点（wave1-3 裁定 no-examples → adopt） | 批量链 `book_runs/prompts/` 已删；live 链 `file.create` 随 #252 对齐。`craft_prompt_clause(with_examples=False)` 为默认，**生产零调用方传 True**（全仓 grep 只剩实验台与护栏），`test_craft_guidelines_reach.py` 钉死 |
| wave4/5 补外推缺口 | live-opening（400 字）与 live-climax（800–1200 字）实测均未复现「删例丢必含事实」，判定在 live 链成立，**生产零改动** |
| 实验副产品：中转站掐断长文 | #255 产字三条路径改流式（非流式 280s 超时 → 流式 72.4s/1347 字） |
| 实验台三处缺陷 + 重复写盘虚增样本真 bug | #254 / #255 |

`CRAFT_EXAMPLE_BAD` / `CRAFT_EXAMPLE_GOOD` 常量仍在 `app/common/craft.py` 是**刻意保留**（变体
纪律要求同源增删、不手抄文案），不是漏删；生产不许挂回由护栏钉死。

## 清理

删除 `.codex/prompt-lab/`（9 个目录、115 份输出样本、11 份报告，1.5MB，gitignored 未入库）。
作者拍板「只删证据目录，留实验台」——`apps/api/scripts/prompt_lab/` 跑道与
`tests/test_prompt_lab.py` 全部保留，因为 `task-rewrite` 还欠一次重测，且以后改 prompt 仍要用。

同步改 `CLAUDE.md` §4 的裁定段：原文写「三波实验……证据 `.codex/prompt-lab/wave1-3/`」，
删目录后该指路即失效，改为指向本报告，并补上 wave4/5 把跨链外推转为实测这一事实。

## 仍未联通

- **`task-rewrite` 在无例基线上的重测仍未做**（key 额度所限），变体仍挂在 `registry.py`。
- 原始输出已不可恢复：此后复核只能读本报告的逐字核验引文，或重跑烧 key。
- wave5 baseline 有 1 格「流式返回内容为空」未复跑（样本 n=2 vs 3）。

# 2026-08-01 task-rewrite 无例基线重测（wave6）+ 修跑出来的两个传输洞

## 起因

作者点名跑 wave2 记档、wave4/5 因 key 额度未做的那次 retest：`task-rewrite`（「每句三检
（推进/加深/氛围）」式任务行）在**无例**生产基线上的完整章稳定性。

## 首跑即撞真 bug（两个，均已修 + 变异验证）

### 1. 生产回归：流式建连的重置逃逸（#255 引入）

首跑以裸 `ConnectionResetError` 打崩，traceback 落在 `urllib do_open → getresponse()`。
urllib 只把 `request()` 的 OSError 包成 `URLError`，`getresponse()` 阶段裸抛。而
`_stream_chat_completions` 的 urlopen 只挡 `HTTPError` 与 `(URLError, TimeoutError)`——
非流式 `call_llm` 一直有第三条 `_RESPONSE_READ_ERRORS`（含 `ConnectionError`）分支，
**#255 把三条产字路径搬上流式时没带过来**。后果：中转站一重置就不重试、不包 `LLMError`，
上层只 catch `LLMError` 于是整轮判失败。已补齐同形态分支（此时尚未消费任何流帧，重发
不会重复正文）。

### 2. 生产 bug：静默截断被当成稿

重跑落出一篇 804 字、断在「从柜台下面摸出一」的样本。查证机制：读帧循环在流 EOF 时自然
结束，`content` 非空即照常产出 `done` 帧；`call_llm_streamed` 的「终帧缺失必须抛错」闸只在
`final is None` 时触发，而内容非空就一定有终帧 —— **它挡得住全空，挡不住半截**。这条路径
正是 file.create / file.revise / prose.continue，自动档下半截章节不经点击直接落盘。

修法：读帧时记 `saw_terminal`，`[DONE]` 与 `finish_reason` **两种标记都认**（先拿真中转站
探过：实测同时发 `finish_reason:"stop"` 与 `data: [DONE]`，闸不会误杀），收尾无标记即抛
`LLMError` 并带上已输出字数。两个消费方都已稳妥承接：`call_llm_streamed` 直接抛，SSE 续写
`except LLMError` 标记工具调用失败并发 `error` 帧。

### 3. 实验台：单格失败隔离漏传输层裸异常

`runner.py` 只捕 `(LLMError, LLMConfigError)`，裸传输异常从 `as_completed` 逃逸打崩整跑，
**把已完成格连同实时落盘一起丢掉**——正是实时落盘要防的故障。改为按格捕获 `Exception`。

## wave6 结果（transition-full 完整章格 × 2 变体 × 3 重复 = 6 格，全绿）

长格首次一次跑满（此前 0/1、5/6）。

```text
                    字数              必含事实  情节要素  陈词  均句长  对白处数
baseline(现任务行)   865,853,965      3/3 ×3    全中      0     11.6    16,13,18
task-rewrite        965,804*,894     3/3 ×3    全中      0     13.2    15,7*,12
                    * 该篇被上游截断（即上文第 2 条 bug 的样本）
```

**判读：两组未拉开差距，不构成 adopt 依据。** 唯一名义差别是均句长（fixture 目标 13.0，
task-rewrite 更贴），但属弱代理指标；对白密度反而略低。变体保留在 `registry.py` 供后续
更大样本复测，`CLAUDE.md` 的裁定段已同步。

**方法教训：机械打分脚本给出过假阴性**——它报 task-rewrite「丢了结尾钩子 / 伪造揭示」，
而原文写的是「取出一部手机…按了一个号码」「压痕浅了将近一半，像是换了一只笔」，只是没用
关键词表里的字面。逐篇读过才纠正。仓里「工具不下结论、判定靠人工读」这条纪律有实证价值。

## 验证

```text
uv run pytest -q  -> 1333 passed, 3 skipped（#256 基线 1328 + 本刀 5 条新测试，零失败）
uv run ruff check app/common/llm_client.py scripts/prompt_lab/ tests/ -> All checks passed
真跑：wave6 6/6 成功；真中转站探针确认同时发 finish_reason 与 [DONE]
```

变异验证（四条，均先红后绿）：
- 摘掉流式建连的 `_RESPONSE_READ_ERRORS` 分支 → 两条重置用例以生产同款 `RemoteDisconnected` FAILED
- 截断闸改 `if False and not saw_terminal` → `..._rejects_stream_cut_before_terminal_marker` DID NOT RAISE
- 闸收紧成只认 `[DONE]` → `..._accepts_finish_reason_without_done_sentinel` 被误杀 FAILED
- 实验台单格捕获退回 `except ValueError` → `..._does_not_discard_completed_cells` 崩在 stdout 已印出
  `[1/3] 完成` 之后，实证「已完成格被连坐丢弃」

## 仍未联通

- **截断成因未定**：wave6 那篇是上游关流还是模型自停，产物证明不了——实验台不记 `finish_reason`。
  闸落地后这类格子会直接判失败，等于把成因暴露到下一次，但本次样本无法回溯。
- wave6 样本仍弱：n=3、单模型（sonnet-5）、单任务形态；判读由单人完成，无对抗验证。
- 盲评版 `blind.md` 已生成（零变体名泄露）但**作者尚未读**——上述判读是我的读法，不是终裁。
- 真机未验：截断闸与重置重试都是 API 层传输改动，装机版行为归 E2E-1。
- 只在一个 Cloudflare 前置中转站上实证；其他网关的收尾标记行为未测。

---

# 连载计划：把编排权从 BookRun 移进 agent（2026-08-01）

## 背景与取舍

作者提「bookrun 融到 agent 里更好吧，让 agent 来编排」。查证后**同意方向、否掉做法**：

- 支持编排权归 agent 的真实理由：BookRun 的编排从没通过质量验收（30 章人工退回重跑至今未重跑），
  而 agent 侧那套闸（`prose_check` / `collapse_check` / `entity_budget_check` / `promise_check` / `canon`）
  是后来才建的，BookRun 一条吃不到。留 BookRun 当编排器 = 留一个失败过的编排器 + 一套旧闸。
- 但**整体「融」会把三堵墙一起搬进来**（`loop_runtime.py`）：`LOOP_MAX_ROUNDS = 8`、
  `LOOP_TOOL_OUTPUT_BUDGET_CHARS = 60_000`、「一补丁即撤下全部补丁工具」（`_offered_schemas`，
  硬执行不是 prompt 劝导）。BookRun 绕开它们靠自带的 DB run 实体 + checkpoint 状态机；
  把壳搬进循环 = 拿 BookRun 换掉 agent 循环。

采用形状（作者拍板）：**编排跨轮、不在轮内**。计划落项目文件而非 DB run，三堵墙不再是墙——
它们本来就是「一轮一章」的尺寸。作者说「继续」即调度器。

## 本刀做了什么

- 新增 `app/domains/agent_runs/serial_plan.py`：`.storyforge/serial-plan.json` 的读 / 原子写 /
  确定性投影（下一章派生、prompt 块渲染、桌面端 payload）。原子写复用 `canon_store`（新增公共
  `atomic_write_json`），不各写各的 mkstemp+fsync+replace。
- 计划块注入 chat 循环 system prompt（紧跟作品底座、在 scene 硬约束之前）。
- 新增循环工具 `project.plan_update`：按 ordinal upsert 章节计划、推进状态、建计划骨架。
- `project_specs.py` 572 行撑破 500 行标准闸 → 按语义拆三份（一致性 / canon / 质量+计划），
  **拼接顺序即 catalog 顺序即 golden 顺序**，golden 因此逐字节只增不改。

**真值源纪律（本刀最要紧的设计）**：手稿正文是真值源，计划里的 `status` 只是声明。正文已存在的章
不当「下一章待写」，哪怕计划仍标 pending——否则作者忘了让 agent 标 done 时，agent 会重写已写完的章。
两者不一致时如实报「计划与正文对不上」并要求以正文为准。

**写回红线不变**：`plan_update` 只写 `.storyforge/serial-plan.json`，正文仍须走 `file.create` /
`file.revise` 的待确认补丁。`risk_level="read"`（同 `project.canon` 写派生缓存那档）——
每推进一章都要作者点确认会把「一轮一章」的流打断成两步。

## 验证

```text
cd apps/api && uv run pytest -q            -> 1350 passed, 3 skipped（#258 基线 1333 + 本刀 17 条新测试）
cd apps/api && uv run ruff check .         -> All checks passed
node scripts/run-e2e.mjs                   -> 20/20 PASSED（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat  -> 逐文件相等，行尾噪音归零
```

变异验证（两条，均先红后绿，还原用带 `assert count==1` 的定点替换）：
- `next_chapter` 改成按 `status` 挑而非按正文挑 → `test_written_chapter_is_never_the_next_chapter_even_when_plan_says_pending`
  FAILED（返回第 1 章，written=True），其余 14 条不受影响 = 用例有针对性不是笼统断言
- 摘掉 `project.plan_update` 的 handler 注册（spec 仍在）→ 两条 e2e 全红
  （`execution_runtime._register_tools` 起服自检抛「工具缺少 handler」）

行尾坑复现并已处理：`test_agent_loop_runtime_tools.py` 在 HEAD 是**纯 LF**，Python `write_text`
把它整成 CRLF → 122 行的删除报成 790/790。按 HEAD 逐行还原未改动行的原始行尾后归零。
判据是 HEAD 主流 EOL，不是「文件是否混合行尾」。

## 仍未联通

- **真机未验**：计划块渲染、`plan_update` 在装机版的实际观感、以及「作者说继续 → agent 写下一章 →
  标 done → 下一章前移」这条完整流，都只在 headless 假 LLM 下验过。归 E2E-1。
- **真 LLM 未跑**：模型会不会**主动**在写完一章后调 `plan_update`，只有 prompt 引导句作保证，
  没有实测。若实跑发现它忘记调，正文真值源那条纪律是兜底（下一章仍会正确前移），但计划里的
  status 会长期漂移、每轮 prompt 都带一段「计划与正文对不上」。
- **未做且刻意不做**：自动连续推进（无 outer driver，作者说「继续」才走下一章）、前端计划面板
  （`to_payload` 已备好投影但无消费方）、从 BookRun 打捞 10 维评稿 rubric（`book_runs/prompts/builder.py`，
  仍未打捞）。
- 计划文件与 canon `promises` 有概念重叠（弧线 vs 伏笔账），本刀未统一，两者各管各的。

---

# 连载计划真 LLM 实跑：逮到「补丁未确认就标 done」（2026-08-01）

## 探针

作者提供真 key（deepseek-v4-flash，`https://api.deepseek.com`）跑 headless。探针建临时项目
（第 1 章正文 + 三章计划 + 人物设定），走 `stream_agent_message` 真 SSE 路径，只说「继续写下一章」。
key 与探针脚本只落 session scratchpad，不入库；项目建在 tmp、跑完删除。

## 三条验证通过

1. **模型主动调 `plan_update`**，无需作者提醒（两个场景都调了）。
2. **真值源纪律真的到达模型行为**（决定性）。场景 B 让第 2 章正文已存在、计划却仍标 pending：
   模型读完第 02 章后**先** `plan_update` 把第 2 章修正为 done、**再**写第 3 章，没有照计划重写。
   回话原文：「第 2 章《回声》计划状态已修正为 done（正文为准，不再照计划重写）」。
   工具序列：`fs.list → fs.read×3 → project.plan_update{ordinal:2,status:done} → file.create(第03章)`。
3. **计划的 goal 与 arc 被转述进产字指令**，印证「不动产字组装点、让模型转述」的设计判断。
   实测 instruction 含：「本章目标：潮汐表被人改过，林岚找到被撕掉的一页；作为「灯塔真相」弧的推进点」。

## 逮到的行为 bug 与修复

**场景 A（第 2 章未写）**：模型起草完第 2 章的**待确认补丁**后，同一轮就把该章标 done——
可补丁要作者点接受才落盘，此刻正文并不存在。跑完计划是 `第2章: done`、正文目录只有 `第01章.md`，
且模型据此对作者说「连载计划已把第 2 章标 done」。

真值源纪律兜住了后果（`next_chapter` 只看正文，下一章仍是第 2 章，作者拒绝补丁也不跳章），
但计划在作者决定之前就开始说谎。**同一次实测里模型在场景 B 又说「确认后我把第 3 章标 done」——
它知道规矩、只是记不牢，这种不一致不能只靠 prompt 多写一句兜。**

修法（两层）：
- **确定性闸**：`serial_plan_update.reject_premature_done` + `apply_plan_update` 前置校验，
  正文不存在的章标 done 一律 `FsToolError`，整调用不落盘。**刻意报错而非默默降级**——
  降级会留下模型已经对作者说出口的那句「已标记完成」。
- prompt 与 ToolSpec 描述同步改口径：「作者接受补丁、正文真的落盘之后」才标 done。

## 复跑验证（同一真 key）

场景 A 重跑：工具序列 `fs.list → fs.read×3 → file.create`，**没再调 `plan_update`**，
计划保持 `第2章: pending`。模型回话改口为「补丁确认落盘后，我再把计划里第 2 章标成 done」。

**诚实区分：这次是 prompt 引导句改变了行为，硬闸并未被触发**（模型压根没尝试）。
闸的报错路径只有单测覆盖，没在真模型上打中过。

## 验证

```text
cd apps/api && uv run pytest -q     -> 1353 passed, 3 skipped（+3 条闸测试）
cd apps/api && uv run ruff check .  -> All checks passed
node scripts/run-e2e.mjs            -> 20/20 PASSED（含 OpenAPI 零漂移）
真跑：deepseek-v4-flash 三轮（场景 A 修前 / 场景 B / 场景 A 修后），均拿到 agent_result
git diff --numstat == --ignore-all-space --numstat  -> 逐文件相等
```

`serial_plan.py` 加闸后 512 行撑破 500 行标准闸 → 按**读侧（载体+投影+渲染，对齐 `book_context`
的「一份投影两种渲染」）/ 写侧（合并与推进闸）**拆成 `serial_plan.py` 367 行 +
`serial_plan_update.py` 176 行；`clean_text` / `positive_int` / `written_ordinals` 随之转公共名。

## 仍未联通

- **闸的真模型触发未验**：修完模型就不再尝试premature done，所以 `FsToolError` 那条路径没被真模型打中。
- **单 provider 单模型 n=3**：只在 deepseek-v4-flash 上跑过，且每场景各一次，非稳定性证据。
- **真机未验**：装机版观感、以及「接受补丁 → 下一轮说继续 → 标 done → 前移」的完整闭环，
  仍只有 headless 证据。归 E2E-1。
- 作者接受补丁后**由谁**触发标 done 仍未定：现在靠作者下一轮开口，无自动回调。

---

# 接受补丁后回调标 done：闭环合上（2026-08-01）

## 背景

#260 的收尾里留了一条：「作者接受补丁后**由谁**触发标 done 仍未定，现在靠作者下一轮开口，
无自动回调」。作者拍板做掉。

## 改了什么

**后端**：`serial_plan_update.mark_chapter_written(project_root, file_path)` + IDE 命令
`plan.mark_written`（`writes=False`：只写 `.storyforge/serial-plan.json`，不落 DB、不碰手稿）。
章序由后端按正文阅读序算（`canon_rebuild.chapter_ordinals`，与作品底座 / canon 闸同一把尺），
**前端不猜章序**。

**刻意保守的三条**（回调在每次接受补丁时都会响，不能替作者无中生有）：
- 计划文件不存在 → **不建计划**。没在用连载计划的项目不该因为接受了一个补丁就被塞一份。
- 该章不在计划里 → **不追加条目**。写了计划外的一章是作者要知道的事，悄悄补进去等于抹平它。
- 正文实际不存在 → **不标**。与 `reject_premature_done` 同一条真值源纪律。

一律不抛异常：这是写盘**成功之后**的收尾动作，失败不该回头污染已经成功的写回。

**前端**：`lib/serial-plan.ts::markChapterWrittenInPlan`，挂在
`useSuggestionWriteback.handleAcceptSuggestion` 里 `writeAcceptedSuggestion` 返回之后。
**刻意只挂这一层**——手动点接受与自动档走的是同一个函数（自动档只是程序化调它），
而分块接受与行间对话 Ctrl+K 是段落级微调，接受一次不等于这章写完了；撤销走反向写回，
届时正文没了，后端自会拒绝。

## 验证

```text
cd apps/api && uv run pytest -q            -> 1363 passed, 3 skipped（+10 条 mark_written 测试）
cd apps/api && uv run ruff check .         -> All checks passed
npm --prefix apps/desktop/frontend run test -> 507 passed（80 文件，+4 条回调行为测试）
pnpm.cmd lint / frontend typecheck          -> 全绿
node scripts/run-e2e.mjs                    -> 20/20 PASSED（含 OpenAPI 零漂移）
```

**真 LLM 闭环实跑**（deepseek-v4-flash，三轮，四条判定全 True）：

| 轮 | 期望 | 实测 |
|---|---|---|
| 1「继续写下一章」 | 起草第 2 章、**不**标 done | 补丁=第02章.md，工具序列无 `plan.mark_written` ✓ |
| 2 模拟作者接受 | 写盘 + 回调 → 第 2 章 done | `{"updated":true,"ordinal":2,"next_ordinal":3}` ✓ |
| 3「继续写下一章」 | 这次写**第 3 章** | 补丁=第03章.md ✓ |

轮 3 的回话还回收了第 2 章里埋的伏笔（桌腿裂缝），旁证新接受的那章真的进了上下文。

变异验证（前端，先红后绿）：摘掉 `await markChapterWrittenInPlan(...)` 这一行 →
`接受补丁后回调连载计划标 done，且发生在版本记录之后` 转红，**其余 10 条不受影响**
（说明用例打在接线上、有针对性）。既有的 `calls` 断言是 `indexOf`/`includes` 式的松断言，
加不加回调都绿——所以必须另写这条显式用例，否则是假绿。

## 顺带修掉一个我自己种的缺陷

`serial_plan_update.py` 在 #260 里被拆出来时，脚本对**已含 `\r\n`** 的内容又做了一次
`replace('\n', '\r\n')`，产生 **139 处 `\r\r\n`**。Python 通用换行模式两者都当断行，所以
测试全绿、没人发现，但文件是坏的（每条语句间多一个幽灵空行，且此后每次 diff 都会一团糟）。
本刀已归一为干净 CRLF；`git grep -lIP '\r\r\n' HEAD` 确认全仓仅此一例。

**教训**：按字节读（`read_bytes().decode()`）不做通用换行翻译，此时再 `replace('\n', EOL)`
必然翻倍。要么先归一到 `\n` 再转，要么用 `read_text()`（它会翻译）。

## 仍未联通

- **前端那一步在真跑里是模拟的**：headless 无 UI，轮 2 用「写盘 + 直调 `plan.mark_written`」
  等价替代作者点接受。前端接线本身由 vitest 行为测试 + 变异验证覆盖，但**真机点一次接受**没验，归 E2E-1。
- **撤销之后不会反向取消 done**：撤销一次已标 done 的章，正文没了、计划仍写 done →
  会被 drift 如实报出来，且 `next_chapter` 只看正文所以行为仍正确，但声明是陈旧的。
  没做反向回调，属已知缺口而非疏漏。
- 单 provider 单模型、闭环各环节各跑 1 次，非稳定性证据。

---

# 撤销后反向取消 done + 修掉「章序前移认错章」（2026-08-01）

## 顺手挖到的真问题（比反向回调本身更要紧）

动手前查了一件事：撤销一次「新建」要**删文件**，而章序是
`canon_rebuild._chapter_ordinals` 按**路径序第几个**编的、**不是从文件名解析**的。
删掉 `第02章.md` 会让 `第03章.md` 的章序从 3 变成 2——反向回调正好落在这个雷上。

进一步查证发现这不止影响撤销：**正文一旦出现空缺，`build_plan` 就会判错**。
只有 `第01章.md` 与 `第03章.md` 存在时，`第03章.md` 的章序是 2，于是计划第 2 章被当成已落盘、
第 3 章被当成还没写——两处都反了。这是 #259 就带进来的隐患，happy path（顺序写、无空缺）
碰不到，所以此前三轮真跑都没暴露。

## 修法：按路径认章

- `PlannedChapter.declared_path`：标 done 时后端把正文相对路径记进计划条目（`path` 字段）。
  **后端算，不接受模型传**——模型猜错一个路径，后面按路径认章就全认到别处去了。
  两条标 done 的路径都记：`apply_plan_update`（`_with_stamped_paths`）与 `mark_chapter_written`。
- `build_plan`：记过路径的按路径判在不在；没记过的（还没落盘 / 作者手写）才回退章序，
  **且不认已被别的条目按路径认领的文件**——否则计划第 2 章会拿第 3 章的文件当自己的在场证据。
- `unmark_chapter_written` + IDE 命令 `plan.unmark_written`：**只按记下的路径认章**。
  认不出（计划里没记过这个路径，比如 done 是本次改动之前标的）就如实返回
  `chapter_not_identifiable`，**不按章序猜**。

## 前端

`unmarkChapterWrittenInPlan` 只挂在**新建撤销**那一支（`TauriFileSystem.deletePath` 之后）。
修订的撤销走反向写回、文件还在，那章依然是写完的，退回 pending 就错了——后端另有一道
以正文为准的闸（`manuscript_still_exists`），前端这层克制是不让它白跑。

## 验证

```text
cd apps/api && uv run pytest -q            -> 1370 passed, 3 skipped（+7 条）
cd apps/api && uv run ruff check .         -> All checks passed
npm --prefix apps/desktop/frontend run test -> 509 passed（+2 条）
pnpm.cmd lint / frontend typecheck          -> 全绿
node scripts/run-e2e.mjs                    -> 20/20（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat -> 逐文件相等
```

**真 LLM 反向闭环实跑**（deepseek-v4-flash，四条判定全 True）：

| 步 | 实测 |
|---|---|
| 轮 1「继续写下一章」 | 补丁=`第02章.md` ✓ |
| 轮 2 接受 | `{"updated":true,"ordinal":2,"path":"正文/第02章.md","next_ordinal":3}`，计划记下路径 ✓ |
| 轮 2b 撤销（删文件+unmark） | `{"updated":true,"ordinal":2,"next_ordinal":2}`，状态退回 pending、path 抹掉 ✓ |
| 轮 3「继续写下一章」 | 补丁=`第02章.md`——**又回到被撤销的那一章** ✓ |

变异验证（两处，均先红后绿）：
- 后端把反向回调改成「按顺序取第一条」而非按路径认章 →
  `..._identifies_chapter_by_path_not_by_shifted_ordinal` 与 `..._does_not_guess_when_path_was_never_recorded`
  转红，其余 8 条不受影响
- 前端摘掉 `await unmarkChapterWrittenInPlan(...)` → `撤销一次新建后回调把该章退回 pending` 转红，
  其余 12 条不动

## 仍未联通

- **真机没点过**：headless 无 UI，接受 / 撤销都用后端等价动作模拟。前端接线有 vitest + 变异验证兜底，
  真机点穿归 E2E-1。
- **没记过路径的旧计划退不了标记**：`chapter_not_identifiable` 如实返回、不猜。属设计选择。
- **章序回退仍是启发式**：没记路径的条目仍按「路径序第几个」判，排除已认领文件后更准，
  但正文有空缺且相关章都没记过路径时仍会判错。彻底解法是给每章都记路径（要么作者手填、
  要么解析文件名），两者都与仓库现有「章序=路径序、别解析文件名」口径冲突，未做。
- 单 provider 单模型、各环节各跑 1 次，非稳定性证据。

---

# 标点漂移闸：模型顺手美化的标点不再写进正文 / 不再污染越界警告（2026-08-01）

起因是通读 opencode（`D:\opencode`，MIT）的 `apply_patch` 定位链，看到它在第四级
comparator 里把智能引号 / em-dash / 省略号 / 不换行空格归一后再比对。原打算照抄它的
「模糊匹配熔断 + 匹配前归一化」两条闸，**复核后发现原形不适用**，记在这里免得重开：

- StoryForge 的补丁是整文件 `before`/`after`（`patches/types.py:15-16`），diff 走 LCS
  （`patch-hunks.ts:233`），**没有「模型给 oldString 去文件里模糊定位」这一步**。
- 逐 hunk 接受时的定位（`patch-hunks.ts:456-478`）只做精确子串 `indexOf` + prefix/suffix
  context 打分消歧，多处命中直接抛错。匹配到的 span 长度恒等于 `beforeText.length`，
  **物理上不存在「糊到更大一段」**，`isDisproportionateMatch` 那道熔断没有对应漏洞。
- `beforeText` 切自 `before` 本身而非模型抄写，所以「模型美化标点导致找不到」也不成立。

但根因确实在，只是换了张脸：三处 prompt（`revise_scope.py:22`、`inline-chat.ts:19`、
`assistant/service.py:223`）都写了「不得调整标点」——**这是被咬过才会写的句子**——而全仓
零确定性兜底。实测（golden `novel_baseline/book.md` 前 20000 字）：

```
[纯标点漂移·零真实改动] _revise_drift_ratio 判 737/758 行 = 97.2%   ← 触发 scope_warning
[真·只改一行·标点不动]                        1/758 行 =  0.1%   ← 不触发
```

即：模型一个字没改、只把引号换成 ASCII，作者会收到「改动了约 97% 的原文，请逐块核对」，
噪音把真正的越界重写淹掉；接受后全篇标点被改写进正文。

## 落了两处（新增 `app/common/punctuation.py`，59 行纯函数）

| 处 | 改动 | 管什么 |
|---|---|---|
| `assistant/service.py` after 落地那一行 | 过 `restore_incidental_punctuation(before, after)` | 顺手漂移不写进正文 |
| `revise_scope.py::_revise_drift_ratio` | 比较前先 `canonical_punctuation` | 漂移不污染越界警告 |

两条修订链（agent loop `file.revise` / Ctrl+K 的 `/api/assistant/revise`）在 LLM 层汇合于
`assistant.service.revise_file_content`，故单点接线即全覆盖，且天然早于 `scope_warning`。

设计要点：
- 折叠**只收同一标点的不同 Unicode 形态**，刻意不收中英文标点互换（，↔, 。↔.）——那在
  中文正文里是该被作者看见的质量问题。
- 逐字符折叠不够：`……`/`——` 成对出现而模型常写成长度不同的 ASCII（`...` / `—` / `--`），
  故折叠后再把连续重复的 `.` `-` 空格 归并成一个。
- 对齐在**折叠后的行序列**上求 `SequenceMatcher` opcodes：`equal` 块取 before（还原），
  其余取 after（真实改动连同其标点原样保留）。`autojunk=False`——中文正文空行极多。
- 全文除标点外无改动时**不干预**（作者可能就是要统一引号形态）；此时 drift ratio 已折叠，
  不会误报，作者在 diff 面板自行判断。
- **粒度是行**：同一行既有真实改动又有漂移时整行取 after（漂移随改动一起可见）。闸保护的是
  未点名的行——「改一段却全篇标点被换」正是问题主体。

## 验证

```
cd apps/api && uv run pytest                -> 1384 passed, 3 skipped（零回归）
cd apps/api && uv run ruff check .          -> All checks passed
pnpm.cmd e2e                                -> 20/20（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat -> 逐文件相等（纯 LF，无行尾噪音）
```

变异验证五点（★ 是关键的接线变异）：

| 变异 | 纯函数测试 | 接线测试 |
|---|---|---|
| M1 `equal` 块取 after 而非 before | 1 failed | 1 failed |
| M2 drift ratio 不折叠 | 2 failed | 9 passed（不涉及） |
| M3 折叠表清空 | 5 failed | 1 failed |
| M4 去掉重复归并 | 6 failed | 1 failed |
| **M5 拆掉 service.py 接线** ★ | **13 passed** | **1 failed** |

M5 正是「只测纯函数两次假绿」那个坑：拆掉接线后 13 条纯函数测试**全绿**，只有
`test_revise_reverts_incidental_punctuation_drift` 逮住。接线测试因此是必需的，别删。

## 仍未联通

- **真机没点过**：headless 用 monkeypatch 桩模拟模型输出，真机 Ctrl+K / file.revise 观感归 E2E-1。
- **没有真 LLM 实跑**：漂移形态取自对模型行为的推断 + golden 语料构造，不是抓到的真实输出样本。
  若真实漂移有表外形态（如中英标点互换、全角逗号），当前闸放行——这是刻意的保守边界。
- **同一行内混合漂移不还原**：见上「粒度是行」，属设计选择。
- opencode 那边真正值得抄的大件（System Context baseline 冻结 + mid-conversation delta、
  影子 git 仓快照、拒绝带意图通道、skill 渐进披露）本刀都没做，另记。

## 2026-08-01 前缀缓存两刀（opencode 大件清单 #1 System Context / Context Epoch）

借的是 opencode V2 `core/src/system-context/index.ts` 的两条立场：①每个上下文片段按
「变动频率」独立分层，稳定的逐字冻结在前；②片段状态是三态，`unavailable`（读不到）
与「读到空」不是一回事。落到本仓是两个可证伪的真缺陷。

### 先否掉一个诊断

此前记的「`system prompt` 每轮重拼，canon 一变就击穿 prompt cache」在 live 代码里
**不成立**。`loop_runtime.py:166-193` 的全部片段构建都在 `for` 循环（`:199`）之前，
循环体内对 `messages` 只有 5 次尾部 append（`:214/:261/:280/:339/:393`），零重写、
零截断、零重排；`_SYSTEM_PROMPT` 是模块级常量（`loop/prompt_context.py:19-66`），
无时间戳、无轮数、无 token 计数。**一次 run 内第 N 轮请求是第 N+1 轮的 100% 逐字节前缀。**
真正的漏在别处，即下面两条。

### 缺陷 1：provider 报的缓存命中从来没进过账

- `_token_usage`（`llm_client.py`）只读 `total/prompt/completion_tokens`，不读
  `prompt_cache_hit_tokens`（DeepSeek 一类）或 `prompt_tokens_details.cached_tokens`
  （OpenAI 一类）。
- `_cost_breakdown` 读了 `STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS` 并原样回显，
  **却从不拿它算钱**——`input_cny` 只用 `input_rate`。
- 后果：命中部分按全价入账（多数 provider 命中价是全价的 1/10），且**没有任何观测手段
  能看出缓存是否命中**——「击穿」这个诊断在改动前根本没有度量支撑。

修法：新增 `_provider_cache_hit_tokens`（三态：`None`=这家没报 / `0`=报了且全未命中 /
`>0`=命中数），`_token_usage` 带出 `cache_hit_tokens`，`_cost_breakdown` 分段计
`input_cny = miss×input_rate + hit×cache_hit_rate`。两处刻意的保守取值：命中价未配置
（或配成非正数）时回退 `input_rate`；provider 没报时 `billed_hit=0`，算出的账与改动前
**逐位相同**。`_token_usage`/`_cost_breakdown` 是单点（三处调用全在 `llm_client.py` 内，
BookRun 侧 `book_generation_llm.py` 是 re-export 同一对象），改这两个函数即全覆盖。

### 缺陷 2：稳定大块排在对话历史之后，跨消息前缀缓存一次都覆盖不到

改动前 `messages` 顺序为 `[_SYSTEM_PROMPT, 作者指令, *history, book, plan, scene, pinned, view, user]`。
`history` 每条作者消息必增长（`loop/support.py:74-81` 滑窗末 12 条），于是作品底座 /
连载计划 / 场景约束这三个大块**每条消息都被整体推位**；两条消息的公共前缀止于
`history` 之前，只剩 `_SYSTEM_PROMPT`（实测 6056 UTF-8 字节）+ 作者指令块。

修法：把 book/plan/scene 提到 `*history` 之前。`pinned_block`/`view_block` 仍留在最靠近
提问处——那条近因理由（原 docstring）成立，未动。

### 门禁

```
uv run pytest        -> 1397 passed, 3 skipped（基线 1384，+13 为本刀新增，零回归）
uv run ruff check .  -> All checks passed
pnpm.cmd e2e         -> 20/20（含 OpenAPI 零漂移）
git diff --numstat == --ignore-all-space --numstat -> 逐文件相等（无行尾噪音）
```

`llm_client.py` 纯 LF、`loop_runtime.py` 纯 CRLF，两文件行尾各自保持不变（改动经脚本
按文件行尾施加，未用会归一行尾的编辑路径）。

### 变异验证（4 点，全部逮住）

| 变异 | 还原的行为 | 结果 |
|---|---|---|
| M1 | `*history` 排回 `book_block` 之前 | 转红 |
| M2 | `input_cny` 改回只用 `input_rate` | 转红 |
| M3 | `_provider_cache_hit_tokens` 读不到时返回 `0` 而非 `None`（三态塌陷） | 转红 |
| M4 | `_token_usage` 不再带出 `cache_hit_tokens`（拆接线） | 转红 |

M1 证明 `test_second_message_keeps_book_context_cacheable` 打在接线上：它比对两次真实
请求的 `messages` 公共前缀，顺序一错即失效。M3 单独列出是因为「读不到当成 0」正是
opencode 那条三态立场要防的塌陷，纯计价断言逮不住它。

### 仍未联通

- **没有真 LLM 实跑**：缓存命中字段的 wire 形态取自两家 provider 的公开文档形状，
  未在真 key 下抓过实际响应。若某家用了第三种字段名，当前按「没报」处理（降级安全，
  账与改动前一致），但会静默看不见命中。
- **省了多少钱未测量**：本刀能证明的是「公共前缀里含作品底座」这个确定性事实，
  不能宣称任何具体的成本下降幅度——那要真跑对比才算数。
- **`tools` 数组在 run 内变形仍会从最开头击穿缓存**：产出补丁后
  `_offered_schemas`（`loop_runtime.py:115-118`）剔除 4 个补丁工具（实测 tools JSON
  20560 → 17423 字节），末轮 / 预算耗尽时 `tools=None` 整段消失。这属于 opencode 清单
  第 7 条（一套 ruleset 同时驱动可见性与授权、阈值不对称：保留工具、调用时才拒）的范畴，
  本刀未做。
- **`book_block` 内部仍含跨消息易变内容**（当前打开第几章、上一章结尾 600 字），
  作者切文件即整块失效。按 opencode 的 Source 分片思想该再拆一层稳定 / 易变，未做。
- BookRun 侧 `book_generation_serial_metrics.py:20` 的 `context_cache_hit_rate` 是
  `(n-1)/n` 算出来的**自造指标**，与 provider 前缀缓存无关，本刀未动也未采信。

## 2026-08-01 拒绝 = 带意图的通道（opencode 大件清单 #2）

借的立场：拒绝框问的是「该怎么改」而不是「为什么拒绝」——前者朝向下一版，后者只是归档；
以及「人不该手动挑 hunk，人该说清楚哪儿不对」。

### 改动前的实际状态（三条，都可证伪）

1. `rejectPendingSuggestion`（`useSuggestionWriteback.ts`）只做两件事：清面板、弹 toast。
   **不发请求、不广播事件、不写任何记录。**
2. 后端对「作者拒绝」**零感知**。全仓 `apps/api/app/domains/{agent_runs,assistant,ide}` 下
   唯一含 reject 的符号是 `serial_plan_update.py` 的 `reject_premature_done`（与作者拒绝
   无关）。接受有回调（`plan.mark_written`，PR#261/#262），拒绝没有对应物。
3. 后果：run 的 approval 步**永远停在 waiting**——既不 completed 也不 failed，流程树上一直
   转着；作者「哪儿不对」的判断一个字都没留下，下一轮 prompt 里也没有任何痕迹。
4. 它还是全仓**唯一没有行为测试**的分支：`tests/patch-review-panel.test.tsx` 旧断言只有
   `assert.match(html, /拒绝/)`，改动前后都绿。

### 改后

- 点「拒绝」不再立即否掉，而是展开一个输入框问「说说该怎么改（回车发出，留空则只否掉这版）」。
- 方向非空 → 经 `PATCH_REJECTED_EVENT` 广播 → `useChatSubmission` 接住，用
  `buildRejectionPrompt` 拼成一句作者会说的话（**只给文件锚点 + 作者原话，不塞 before/after**——
  正文动辄数千字，塞进去会挤爆 12 条 × 4000 字符的历史窗口，而模型上一轮刚生成过它），
  走既有的 `handleComposerSubmit`。
- 复用而非新建：`handleComposerSubmit` 既进 UI 消息列表，也由后端
  `conversation_runtime.py:99-103` 落进 `assistant_messages`，于是自动进下一轮
  `_history_messages`（`loop/support.py:74-81`）。**后端一行代码都没改。**
- 方向留空 → 只广播、不发起新一轮：拒绝不该变得昂贵，也不该每次都烧一轮 BYO-key 去读
  一句「我没要」。
- `useAgentRunControls` 收尾那个永远挂 waiting 的 approval 步。**标 completed 而不是 failed**：
  这一步叫「等待作者确认」，作者给了答复它就完成了，哪怕答复是「不要」；agent 没出错。
- 拒绝这条路径仍然**一个字节都不写盘**（不快照、不写文件、不回调标 done），有专门断言钉死。

### 顺带修的两个真问题

- **`submitRejection` 抽出**：原实现发出后不清 `rejectDraft`，同一面板实例换下一个补丁时
  会留着上一条草稿。改为发出即收起。
- **monaco stub 缺 `updateOptions`**（`tests/stubs/monaco-editor.ts`）：`createDiffEditor()`
  返回的对象没有这个方法，而 `PatchReviewPanel` 挂载后会调它追平字号/字体。此前没有任何
  测试真正挂载过这个面板（都走 `renderToStaticMarkup`），所以一直没暴露。表现是 React root
  被打坏、整组交互用例报 `Should not already be working`。

### 门禁

```
npm run typecheck    -> 通过
npm run test         -> 522 passed（基线 509，+13 为本刀新增，零回归）
pnpm.cmd lint        -> eslint + prettier 全绿
pnpm.cmd e2e         -> 20/20（后端未改，OpenAPI 零漂移）
git diff --numstat ≈ --ignore-all-space --numstat（仅 useSuggestionWriteback 差 1 行，
  来自 useCallback 由单行改多行的真实缩进变化，非行尾噪音）
九个改动文件 CR 计数全为 0（源文件均为纯 LF，改动经脚本施加）
```

### 变异验证（6 点，全部逮住）

| 变异 | 还原的行为 | 结果 |
|---|---|---|
| M1 | 拒绝不再广播事件（拆接线） | 转红 |
| M2 | 空方向也发起新一轮 | 转红 |
| M3 | 点拒绝立即否掉，不问怎么改 | 转红 |
| M4 | 拆掉 approval 收尾监听 | 转红 |
| M5 | 拆掉会话守卫 | 转红 |
| M6 | 发出后不收起草稿 | 转红 |

M5 单列是因为 [[F26]] 那条教训：run 起跑会话 ≠ 当前活动会话时纯 `runId` 守卫不足，
切会话不改 runId。新监听器照抄了 `isRunResultForActiveSession` 守卫，M5 证明它是承重的。

### 仍未联通

- **真机未点穿**：整刀是前端交互 + 事件桥，没有在装机版里点过。「否掉 → 输入框 → 回车 →
  agent 真的按新说法重来」归 E2E-1。
- **拒绝仍不留后端审计痕迹**：`patch_id` 已经广播出去了，但没有 `patch.rejected` 命令把它
  写进事件表。后端持有同一 id（`events/contracts.py:9-27`），将来要对账是现成的。刻意不做：
  这一刀的价值在「意图进下一轮」，审计是另一件事。
- **per-hunk 仍只有接受、没有拒绝**：这是刻意保留的——上游的立场正是「人不该手动挑 hunk，
  人该说清楚哪儿不对」，作者可以在方向里直接说「第二处那段对话太生硬」。
- **作者的方向不带被否正文**：见上，是刻意的取舍。若实际使用中发现模型认不出「刚才那版」
  指的是什么，再考虑带上 hunk 级摘要。

## 2026-08-02 影子 Git 内容寻址作品版本（自带 MinGit）

### 落地边界

- Windows x64 包固定捆绑 `MinGit-2.55.0.3-64-bit.zip`，SHA-256 为
  `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`；构建脚本校验
  manifest、摘要、版本、架构、可执行文件和许可证，不搜索系统 `PATH`。
- Tauri 在 app-local data 中按 canonical project path SHA-256 建独立 `--git-dir`，作者项目仅作
  `--work-tree`；只执行 stage / `write-tree` / refs / read / gc，不执行 commit、checkout、reset。
- 新版本写入顺序固定为 `tree -> schema-v2 meta -> refs/storyforge/versions/<recordId>`；新记录不再
  复制正文，也不再截断 20 条。legacy `.snapshot.md` 与 tree-backed meta 双读。
- tree 捕获正文、作品档案、canon 真值、版本 meta、`branches.json` 和 author-loop 证据；排除
  `.git`、依赖、原子临时文件、`canon/derived` 与超过 2 MiB 的新增非作品文件。
- “文件不存在”是 `{ exists:false }`，恢复时二次确认并按
  `保存脏缓冲 -> shadow snapshot -> branch head -> deletePath -> plan.unmark -> drop tab` 执行，
  不再写空字符串冒充删除。
- 失效 tree/ref 的元数据仍留在时间线并禁用恢复。影子仓整体不可读时 legacy 版本仍可读；失效
  节点仍展示，但不能继续充当分支 parent/head，空支线回退到仍存活的分叉点。

### 本轮最终复验

```text
npm --prefix apps/desktop run test:git-bundle
  -> 5 passed
npm --prefix apps/desktop run verify:git-bundle
  -> git version 2.55.0.windows.3，摘要/许可证/runtime 校验通过
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  -> 28 passed
npm --prefix apps/desktop/frontend run test
  -> 82 files, 533 passed
npm --prefix apps/desktop/frontend run typecheck
  -> passed
pnpm.cmd lint
  -> ESLint + Prettier passed
```

最终增加的 3 条回归分别钉住：影子仓整体不可读仍保留时间线、失效版本不能成为 parent/head、
支线无可恢复节点时回退到存活分叉点。相关定向测试为 2 files / 21 passed。

### 实现阶段全仓与安装资源证据

```text
pnpm.cmd verify
  -> passed；API 1397 passed / 3 skipped，Ruff、daily sidecar、OpenAPI drift 均通过
pnpm.cmd e2e
  -> 20/20 passed
pnpm.cmd openapi
  -> passed，无 shared contract drift
pnpm.cmd smoke:sidecar:packaged
  -> passed
npm --prefix apps/desktop run verify:tauri-smoke
  -> passed；应用进程清空 PATH 后使用 resource Git 创建/保活/读取写前 tree
npm --prefix apps/desktop run verify:tauri-smoke:packaged
  -> passed；直接运行 release exe，应用进程 PATH 为空
npm --prefix apps/desktop run build
  -> Windows x64 MSI + NSIS 构建成功
```

- release runtime：366 个文件，93,882,909 bytes，`git version 2.55.0.windows.3`。
- NSIS：`StoryForge IDE_0.1.10_x64-setup.exe`，77,912,148 bytes。
- MSI：`StoryForge IDE_0.1.10_x64_en-US.msi`，94,470,599 bytes。
- 生成的 `installer.nsi` 明确安装并卸载
  `resources/mingit/manifest.json`、`runtime/LICENSE.txt`、`runtime/cmd/git.exe`。
- Rust 集成测试对作者 `.git` 做递归 byte digest，影子快照前后摘要一致；同时覆盖非 Git/已有
  Git、alternates/index seed、seed 失败回退、中文路径、CRLF、并发锁、排除、refs 与 gc。
- `rustfmt --check` 对 `shadow_git.rs`、`shadow_git/core.rs`、`shadow_git/tests.rs` 通过；全 crate
  `cargo fmt --check` 仍报告未触碰的 `fs.rs` / `llm_config.rs` 既有格式基线，本任务未扩散改写。

### 未验证与不能宣称

- **未实际静默安装/卸载 NSIS**。当前安装证据是 release resource-layout 冒烟、安装包成功生成，
  以及生成的 NSIS `File` / `Delete` 指令；不能写成真实安装目录和卸载残留已手工验收。
- **未对真实 StoryForge 仓执行 shadow snapshot dogfood**。作者 `.git` 不变由隔离 Rust fixture
  的 byte digest 测试证明；没有把测试 fixture 夸大为真实工程手工验收。
- **没有交付整项目一键恢复 UI**。tree 已包含作品版本记录、分支选择和作品状态，可作为后续整
  项目 diff/确认恢复的数据底座；本任务只接通现有按文件版本历史/分支画布。
- **没有宣称真机 GUI 多轮补丁确认完全验收**。本次是 deterministic Tauri smoke 与 release exe
  冒烟，不等同于人工点击装机版全链路。

## 2026-08-02 影子 Git 完成态审计：真安装、真实仓与 smoke 全身份隔离

本节是对上一节两个未验证项的后续完成证据。上一节的「未实际安装/卸载 NSIS」和「未对真实
StoryForge 仓 dogfood」在本节均已关闭；项目级一键恢复整个作品的 UI 仍保持原定 out of scope。

### 审计中发现并修复的真实问题

1. Tauri release 资源路径可能是 `\\?\D:\...`。MinGit 不接受
   `GIT_TEMPLATE_DIR=\\?\...`，导致已安装 exe 的 `git init` exit 128。修复仅在 bundled Git
   环境边界去除 verbatim 前缀，项目 canonical path 与分桶身份保持不变。
2. 既有 Tauri smoke 与当前欢迎页、活动栏、补丁二次拒绝、toast 状态契约已经漂移。Rust smoke
   和浏览器 smoke 已同步到当前 UI，并继续断言确认前不写盘、确认后 tree/ref/read 成立。
3. 初版安装 harness 只按目录存在判断卸载保留数据，且 shortcut cleanup 可递归删除未预检的同名
   目录。现改为完整 shadow tree digest 前后相等、Known Folder 桌面、配置目录预检、精确快捷方式
   删除和仅空目录删除。
4. 初版 smoke 继承 8000 端口和生产 identifier 数据面，可能终止既有 sidecar、写生产 SQLite/config、
   shadow Git 与 WebView localStorage，或被 single-instance 正常退出 0 假绿。现使用临时 API 端口、
   强制 local/config/WebView 隔离目录、smoke 禁止替换既有 API、smoke 禁用 single-instance，并要求
   `storyforge-smoke-isolation-v1` 和真实 result marker。
5. packaged smoke 过去可直接运行陈旧 release exe，安装态 `--executable` 也曾绕过协议预检。标准
   packaged 命令现先执行 current release no-bundle build；release 与显式 installed executable 统一在
   启动前扫描隔离协议，不具备能力的旧 exe 不会被执行。
6. 已有 Git 的 alternates 有断言，但兼容 index 成功复制没有直接行为证据。新增测试 seam 在 staging
   前比较 source/shadow index bytes，并再次比较作者 `.git` 完整摘要。
7. 初版 existing-Git 快照把作者 objects 永久留在 `alternates`，作者删除/移动 `.git` 后记录版本会
   丢 blob。现把 alternates 限定为初始化加速：tree 写出后以临时内部 ref + `repack -a -d` 物化全部
   可达对象，移除 alternates 并做 connectivity 校验；回归会移走作者 `.git`、执行 prune=now 后再读。
8. `.storyforge` 的 force-add 曾把内部 `.*.tmp-*`、嵌套 `node_modules` / `.pnpm-store` 重新带进
   tree。现只覆盖作者 `.gitignore`，force-add 后重新应用 StoryForge 托管排除，并有内部路径红绿回归。
9. release smoke 压力复跑曾出现一次接受事件丢失，失败出口又先 `process::exit`，遗留 sidecar 并锁住
   SQLite。接受动作现点击真实 UI 按钮；所有 probe 失败统一恢复 PATH、停服务、删 exact owned 临时项目，Node 在
   Windows 同步等待 taskkill。强制失败探针证明无 EBUSY/AggregateError/残留进程或目录，随后 10 次
   current release 写回连续通过。
10. 仅从 `ls-files --ignored` 删除托管垃圾仍会被作者 `.gitignore` 的 `!` negation 绕过，因为
    `info/exclude` 优先级更低。现从完整 cached index 硬过滤依赖、atomic temp、derived 和本轮大文件；
    行为回归显式反忽略全部路径，仍逐项证明不进入 tree。
11. probe 内失败清理收口后，sidecar 已启动但 main window/setup 失败，以及临时项目创建一半失败，
    仍在 cleanup 所有权之外。setup 现统一 shutdown；临时项目先以 `create_dir(root)` 独占所有权，
    预存 root 不复用/不删除、无宽前缀清理，取得所有权后的半建失败自行回滚；Node 对
    仍存活的进程树同步 `taskkill /T`、跳过可能已复用的退出 PID，并等待隔离 API 不可达。
12. 对象物化增加了写回耗时，原 release smoke 的 6 秒终态等待可在真实 `plan.mark_written` 已发出时
    抢先超时。现仅把真实接受后的终态预算扩至 20 秒，仍要求成功 toast 和写后正文；当前 release 与
    installed smoke 均通过。
13. `.storyforge` 被作者 ignore 时，普通 untracked 稳定性检查看不到 staging 后并发新增文件；Windows
    托管排除又曾大小写敏感。现额外无 ignore 枚举 `.storyforge`，Windows 路径 ASCII case-fold，且
    `node_modules` / `.pnpm-store` 只按目录组件排除；三条回归分别钉住并发新增、case variant 与普通同名文件。
14. PyInstaller `--onefile` sidecar 是 bootloader + API 子进程树，`CommandChild::kill()` 只杀根进程；
    随机端口实证中 API 子进程仍返回 200。Windows shutdown 现于根存活时先 `taskkill /T /F`，失败才
    fallback 到句柄 kill；最新 setup/probe 强制失败均在 API 已就绪后收敛到 process/data/project=0。
15. API stop 单次 fetch timeout 曾被误判为 unreachable，response body cancel 失败也会推翻已收到响应，
    signal exit 则被 `code ?? 0` 当成功。现 timeout/abort 保守视为未知、body cancel 为 best-effort、signal
    明确失败，只有总 stop wait 成功才删除 data root；Node 行为回归全部直接覆盖。
16. 最终证据复审发现 canonical bucket、v2 meta 关联字段和 alternates/index 各阶段 fallback 的断言过宽。
    新增精确 64-hex SHA-256 + alias 稳定性、全部 meta 关联字段 + 无正文副本、alternates 写入/index 复制
    两处 fault injection；报告矩阵不再用间接 containment 或单一坏 index 代替这些要求。

### 原任务 R1-R16 直接证据矩阵

| Requirement | 直接证据 | 结果 |
| --- | --- | --- |
| R1 独立 git-dir 与 canonical SHA-256 分桶 | Rust `repository_path_uses_stable_canonical_sha256_bucket` 精确断言 canonical key 的 64 位 lowercase SHA-256 路径与 `.` alias 同桶；真实仓 dogfood/三档 marker 断言 repo 位于隔离 data root 且不在工作树 | 通过 |
| R2 不修改作者 `.git` | `existing_git_repository_is_read_only_and_materializes_borrowed_objects`、`existing_git_repository_copies_source_index_seed_without_mutation`、seed/fallback fault tests；真实仓 dogfood 前后 digest | 通过，真实仓 digest `ec932093657b015f3909121d7b95635d8284f2545d94bc5bff3c2cdd22c01982` |
| R3 完整工作树与排除矩阵 | `snapshots_non_git_worktree_and_preserves_story_state` 逐项读取作品状态并逐项拒绝 `.git`、内外 atomic temp、derived、内外 dependency、large file；`force_includes_storyforge_even_when_author_gitignore_excludes_it`；`managed_excludes_override_author_gitignore_negations` | 通过，作者 negation 不能覆盖托管硬排除 |
| R4 existing Git alternates/index 与 fallback | `existing_git_repository_copies_source_index_seed_without_mutation` 直接比较 alternates/index；`alternates_or_index_seed_failures_fall_back_to_complete_snapshot` 分别注入 alternates write/index copy 失败；坏 seed 自动 fallback；对象物化测试移走作者 `.git` 后 GC/read | 通过 |
| R5 快照失败阻断正文写回 | frontend `tree, metadata, or retain failures reject...`、`快照失败阻断写盘`、`自动档下快照失败仍然阻断写盘` | 通过 |
| R6 tree hash 与版本元数据关联 | `new snapshots write only v2 metadata and retain the tree before returning` 逐项断言 tree/record/source/summary/file/patch/session/issues/context/parent/branch/run/created、写入/retain 顺序和无正文副本 | 通过 |
| R7 存在/不存在/删除三态 | Rust snapshot/read；frontend `created metadata still distinguishes...`、`legacy created snapshots restore as missing...` | 通过 |
| R8 恢复仍受确认、原子写与页签保护 | mounted writeback/restore tests，含「撤销新建是删文件并摘页签，不是写空文件」及失败保持页签/plan | 通过 |
| R9 legacy 与 v2 双读 | `legacy and v2 entries share one timeline and one structured reader`；repository failure 仍保留 legacy | 通过 |
| R10 refs 保活与 GC | Rust `retains_tree_through_gc_and_filters_only_live_refs` 对 retained tree 和 orphan tree 执行 `gc --prune=now`；source-Git 自包含回归移走作者对象库后再 GC/read | 通过 |
| R11 Windows/中文/长路径/CRLF/空项目/两类 Git 项目 | Rust `snapshots_empty_worktree_and_reads_windows_long_paths`、中文路径和 CRLF read、non-Git/source-Git tests | 通过 |
| R12 dev/installed 均只用受控 Git | dev/release/installed Tauri smoke 清空应用 PATH，marker 中 Git 均位于各自 resource 目录，版本固定 2.55.0 | 通过 |
| R13 供应链与明确失败 | MinGit Node tests 覆盖 SHA/cache/exe/version/license/arch；Rust 覆盖 missing runtime、坏输入和 verbatim resource 回归 | 通过 |
| R14 仅承诺 Windows x64 NSIS | manifest、host guard、overlay 和真安装探针都固定 win32/x64；未扩大其他平台声明 | 通过，范围限制保留 |
| R15 作品级 `.storyforge` 状态 | Rust 直接读取 book/cover/instructions/canon/versions/branches/plan/notes/author-loop，拒绝 canon/derived 与 `.storyforge` 内 atomic temp/dependency cache | 通过 |
| R16 meta/ref 任一步失败均阻断且无半记录 | frontend failure injection 覆盖 tree、meta disk full、update-ref；断言 release/delete meta、无 retain/writeback 成功 | 通过 |

### 原任务 16 条 Acceptance Criteria

| # | 验收项 | 直接证据与结论 |
| --- | --- | --- |
| AC1 | git-dir 在工作树外且作者 `.git` 不变 | fixture + 真实仓 dogfood 均通过 |
| AC2 | 相同 tree 稳定、正文变化 tree 改变 | Rust non-Git snapshot test 通过 |
| AC3 | existing Git 复用 alternates/index，失败 fallback | alternates/index bytes、alternates write fault、index copy fault、损坏 index staging fallback、借用对象物化并脱离作者 `.git` 均通过 |
| AC4 | non-Git 项目可快照 | Rust non-Git/empty worktree 通过 |
| AC5 | 快照失败阻断 write_file/F27 | frontend guarded writeback tests 通过 |
| AC6 | 从 tree 读取指定文件并预览 | Rust read + frontend structured reader + Tauri retained pre-write read 通过 |
| AC7 | 新建前恢复为删除，普通恢复为正文 | mounted auto-writeback/restore tests 通过 |
| AC8 | legacy/v2 同时列出与恢复 | versions checkpoint dual-read test 通过 |
| AC9 | tree 含 branches/meta/canon/book/author-loop，排除 derived | Rust 完整包含/排除矩阵通过，含 `.storyforge` 内托管 temp/dependency 排除 |
| AC10 | ref tree 经 prune=now 存活，orphan 被清理 | Rust GC 回归通过 |
| AC11 | 清 PATH 的安装态仍能创建/读取/恢复 | 真安装 exe 完成 proposed patch、tree/meta/ref/read；恢复语义由同一 frontend reader/writeback 测试覆盖 |
| AC12 | Git 版本与 executable path 均为 bundled | 三档 Tauri marker 与安装 resource 校验通过 |
| AC13 | 版本/arch/SHA/license 缺失失败 | `prepare-bundled-git.test.mjs` 7 项相关回归通过 |
| AC14 | meta/ref 失败不写盘、不返回成功记录 | frontend failure matrix 通过 |
| AC15 | 行为覆盖 create/modify/delete/中文/non-Git/existing Git/missing Git/seed failure/legacy | Rust + frontend 组合覆盖通过 |
| AC16 | frontend、Rust、typecheck、lint、verify、e2e | 全部通过，命令汇总见下 |

### 当前完成态任务验收

| 当前任务要求 | 完成证据 |
| --- | --- |
| R1 逐条证据矩阵 | 上述 R1-R16 与 AC1-AC16 均指向行为测试或 runtime probe，无“脚本存在即通过”替代 |
| R2 真实 StoryForge dogfood | tree `632e075387693c8e7a06b6c777c157fb08c81b43` 可读/保活/gc 后可读且对象已本地物化；`.git` digest `ec932093657b015f3909121d7b95635d8284f2545d94bc5bff3c2cdd22c01982` 前后相同；temp data 删除 |
| R3 隔离 NSIS 真安装 | 独立 product/identifier 真安装，installed exe smoke，真卸载，local shadow 数据卸载前后 digest 相同，最终测试 identity 全清 |
| R4 缺失边界回归 | 空项目、长路径、canonical bucket、完整状态、内部托管排除/case/并发新增、作者 negation、orphan GC、alternates/index fault、坏 seed、对象物化、完整 meta、半建/预存 smoke root、license/arch/verbatim resource 均有回归 |
| R5 审计缺陷保持红线 | 修复只改 bundled Git/smoke/installer 边界；无系统 Git fallback，无作者 `.git` 写入或持久依赖，无确认前正文写盘；PyInstaller tree-kill、timeout/abort/body-cancel/signal 分支均 fail-closed，强制 smoke 失败无残留 |
| R6 规范与报告 | `.trellis/spec/desktop/frontend/quality-guidelines.md` 与本报告已同步；整项目恢复 UI 继续 out of scope |

### 最终命令与结果

```text
npm --prefix apps/desktop run test:nsis-install
  -> 17 passed（含 runProcess signal-exit 与 settleSmokeCleanup stop-wait 失败编排回归）
npm --prefix apps/desktop run test:git-bundle
  -> 7 passed（含 license/arch）
npm --prefix apps/desktop/frontend run test
  -> 82 files / 533 passed
npm --prefix apps/desktop/frontend run typecheck
  -> passed
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --nocapture
  -> 39 passed / 1 ignored（真实仓 probe 单独运行）
cargo test ... dogfoods_real_storyforge... -- --ignored --nocapture
  -> 1 passed
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
  -> passed
pnpm.cmd verify
  -> passed；API 1397 passed / 3 skipped；Desktop 533；project-core 7；Ruff/daily sidecar/OpenAPI drift passed
pnpm.cmd e2e
  -> 20/20 passed，OpenAPI 无漂移
npm --prefix apps/desktop run verify:tauri-smoke
  -> development smoke passed；临时 API/data/config/WebView；生产四份摘要前后相同
npm --prefix apps/desktop run verify:tauri-smoke:packaged
  -> current release no-bundle build + capability preflight + release smoke passed
STORYFORGE_DESKTOP_SMOKE_FORCE_FAILURE=1 + current release verifier
  -> expected exit 1；API 曾返回 200；新增 data/project root=0；新增 repo sidecar PID=0
STORYFORGE_DESKTOP_SMOKE_FORCE_SETUP_FAILURE=1 + current release verifier
  -> sidecar ready 后 expected exit 1；Windows tree-kill；API/process/temp root=0
pnpm.cmd smoke:sidecar:packaged
  -> passed；ready 7342ms，assistant/SSE/control/alembic/prompt bundled 全绿
npm --prefix apps/desktop run verify:nsis-install
  -> explicit executable capability preflight + isolated NSIS install/run/uninstall passed
git diff --check
  -> passed
```

### 真安装、生产保护与真实仓摘要

- Installer：`apps/desktop/.tauri-target-install-smoke/release/bundle/nsis/StoryForge Shadow Git Install Smoke_0.1.10_x64-setup.exe`。
- Installed Git：`git version 2.55.0.windows.3`；实际 executable 为安装资源目录下的 verbatim
  Windows path，已成功完成 `git init`、snapshot、retain 和 read。
- 卸载前后 shadow data digest：
  `ecfc0dc068c56a81c7a416ad29d02b029e2a0174e0a0e3882cf2412321217c60`，逐字节 tree 摘要相同。
- 卸载后：测试 install/local-data/config/registry/shortcut/process 全部为 0。
- 生产安装 tree digest 前后均为
  `a148760e043f37c9153d05f3f66a3e81c7bf4474cd20207fdb234f7ac4415fd2`。
- 生产 installed exe 仍为 15,629,312 bytes，SHA-256
  `2713983407B327457A7DD9697D480F8612D2E71D74D119260B1F28AA379FBFCE`，卸载键仍存在。
- dev/release smoke 前后生产 SQLite SHA-256 均为
  `CE5C274D797F1511293F03ADE7F4058AA0B5CC46E25358233E31AD1DE94FF12D`；生产 LLM config SHA-256
  均为 `F2BF579D2796AF310B8BDCDE5C6CBE11C196D215B3FF07AFDC11B7E463C0B4E0`；生产 shadow Git
  目录仍不存在；WebView tree digest 均为
  `790d0848e1883afdf1a15abb504b783365e63d05b4bede9ae9cccf795df53841`。
- 真实 `D:\StoryForge` dogfood：tree
  `632e075387693c8e7a06b6c777c157fb08c81b43`，作者 `.git` digest 前后均为
  `ec932093657b015f3909121d7b95635d8284f2545d94bc5bff3c2cdd22c01982`，临时 data root 已删除。

### 仍然不能宣称

- 没有交付「正文 + 版本记录 + 分支选择」的一键整项目恢复 UI。当前 tree 已完整保存这些作品状态，
  现有 UI 仍是按文件版本历史和分支画布；项目级 diff/确认恢复入口属于后续任务。
- 没有验收 macOS、Linux、Windows arm64 或 32 位 Git 包。
- deterministic dev/release/installed Tauri smoke 真实运行了 WebView 和补丁确认链，但不等于作者人工
  通读或真机多轮 GUI 体验验收；不能据此宣称生产级长篇闭环。

---

## 2026-08-03 旧任务与写回权限契约收口

### 结论

- `07-24-chat-ux-polish`：PRD 验收全勾，提交 `67c6af50` 与 Chat UX 行为测试可追溯；已归档为
  `completed`，`completedAt=2026-08-03`。
- `07-24-editor-patch-ux`：PRD 验收全勾，提交 `06c57254` 与 Patch Review 行为测试可追溯；已归档为
  `completed`，`completedAt=2026-08-03`。
- `07-31-trusted-writing-context`：PRD 验收全勾，提交 `0fc26735`、API sentinel/伪造防护/provenance
  测试与 frontend 投影测试可追溯；已归档为 `completed`，`completedAt=2026-08-03`。
- 父任务 `07-30-project-optimization-review` 保持 `planning`，`children` 仍为
  `07-31-trusted-writing-context` / `07-31-agent-permission-policy`，Trellis 显示 `2/2 done`；父任务自身
  未完成的作者通读、Chapter Writing Module 等范围未被误归档。

### 写回权限契约

用户独立决定保留项目级四档权限：`read` 禁止写类补丁，`ask` 必须停在最终 diff 确认，`auto` /
`full` 仅在作者对当前项目显式选择后可免逐次点击，且只有 `full` 额外免除长任务二次确认。任何档位下
后端都只产出 proposed patch；实际落盘仍必须经过 Desktop `performGuardedWriteback`、漂移拒写、项目
边界、派生目录只读、写前快照、版本与 author-loop 记录。

已同步根 `AGENTS.md`、`CONTEXT.md`、`CLAUDE.md`、`docs/architecture/ide-first-product-direction.md`、
`docs/internal/current-phase.md`、`docs/internal/TODO.md`、backend quality spec 与仍在规划中的父任务 PRD。
事实源契约测试也从旧短语断言改为验证 `ask`、`auto/full` 与 guarded writeback 三条边界。

### 验证

```text
npm.cmd --prefix apps/desktop/frontend run test -- <7 focused files>
  -> 7 files / 76 passed
npm.cmd --prefix apps/desktop/frontend run typecheck
  -> passed
uv run pytest tests/test_agent_llm_context.py tests/test_agent_loop_writing_context.py
  tests/test_agent_permission_policy.py tests/test_agent_loop_permission_writeback.py -q
  -> 46 passed
uv run ruff check <affected agent context/permission paths>
  -> All checks passed
uv run pytest tests/test_phase9_fact_sources.py -q
  -> 14 passed
uv run ruff check tests/test_phase9_fact_sources.py
  -> All checks passed
pnpm.cmd verify
  -> passed
  -> root lint/Prettier passed
  -> Desktop typecheck passed; Vitest 82 files / 533 passed
  -> project-core 7 passed; shared typecheck passed
  -> API 1397 passed / 3 skipped; Ruff passed
  -> sidecar daily smoke passed
  -> OpenAPI / Agent WS regenerated by drift gate; no drift
git diff --check
  -> passed
```

首轮 `pnpm.cmd verify` 的唯一失败是 `test_phase9_fact_sources.py` 仍断言旧短语
`确认写回防重复生成`；更新为三条权限边界断言后，定向测试与第二轮总门禁均通过。最初两条 Desktop
命令使用 `npm` 时被 PowerShell execution policy 拦截，按仓库 Windows 约定改为 `npm.cmd` 后通过，
不属于测试失败。

本轮未修改路由、DTO、Agent WS schema 或 OpenAPI 形状，无需人工刷新 contract；总门禁仍执行了生成与
drift 检查并确认零漂移。

### 归档异常与未验证项

- 可信上下文目录在归档区存在一份同名 `in_progress` 旧副本。源/副本 8 个文件的文件名与 SHA-256
  全量一致；移除冗余副本后，Trellis 的 Python `shutil.move` 仍在复制后删除源 `check.jsonl` 时遭遇
  Windows `Access denied`。文件同目录重命名往返成功，故使用等价回退：`apply_patch` 写入 completed
  状态，再用 PowerShell `Move-Item` 原子移动目录。归档后任务列表、父子引用与当前任务指针均复核正确。
- 未运行可信上下文任务遗留的真机 Desktop suggestion -> author-loop -> diff 点击链；不能宣称该 GUI
  链已验收。
- 未运行 `auto/full` 真机“改档 -> 自动落盘 -> 撤销 -> 重启后档位仍在”链路；现有证据是挂载行为测试、
  全量 Vitest、API policy/loop 测试与 guarded writeback 既有真机基线，不能替代该手工验收。

---

## 2026-08-03 受控 Project Knowledge 发现与追踪

范围：`.trellis/tasks/08-03-project-knowledge`。新增受控 `project.knowledge` 单一 action 工具、
Backend 资格策略与安全 trace；Desktop 新增 `knowledge` 语义、安全索引和按项目本机选择。未实现
Chapter Writing Module、会话压缩、新 route/DB/manifest，也未改变 proposed patch 或 guarded
writeback 边界。

行为结论：

- `.资料`、常规创作资料目录与五个作者所有 `.storyforge` 文件可发现；未知点目录、derived、
  versions、config/cache/log/db、敏感文件名、二进制和 512 KiB 以上文件失败关闭。
- 普通 `fs.list/search` 不放开隐藏目录；`fs.read` 仅保留既有 agent-instructions 豁免，其余隐藏
  knowledge 只能走 `project.knowledge`。读取与搜索内容脱敏，trace 不含正文、excerpt、绝对根或 secret。
- Book context 只给 Project Knowledge 路径/类型/体量，不再暴露 derived dossier 指针。
- knowledge 不自动进入 context；作者显式选择后才复用可信 snapshot -> inner draft/revise ->
  request-bundle provenance 链。存储路径必须先通过当前安全索引才恢复，陈旧项只显示 missing 并被清退；
  普通临时 pin 不持久化。

验证：

```text
API 定向 + source standards                    -> 99 passed, 1 skipped
Desktop 定向                                  -> 5 files / 30 passed
API 全量 pytest                               -> 1406 passed, 4 skipped
Desktop 全量 Vitest                           -> 82 files / 537 passed
Desktop typecheck                             -> passed
API Ruff                                      -> passed
pnpm.cmd openapi                              -> generated successfully; no tracked contract drift
pnpm.cmd verify                               -> passed
  root ESLint/Prettier                        -> passed
  shared typecheck / project-core             -> passed / 7 passed
  API pytest / Desktop Vitest                  -> 1406 passed, 4 skipped / 537 passed
  sidecar daily smoke                         -> passed
  OpenAPI + Agent frame drift                 -> no drift
git diff --check                              -> passed
```

契约判断：ToolSpec loop schema golden 新增 `project_knowledge` 是预期 drift；HTTP OpenAPI、Agent frame
schema 与 generated client types 均零 drift。`.trellis/spec/storyforge-api/backend/project-knowledge.md`
已记录七段跨层可执行契约，并由 API/Desktop 两个 spec index 共同引用。

未验证：未在真机 Tauri 中手动点穿“选择知识 -> 切会话/重启 -> 发起写章 -> 查看 diff”；未调用真实
provider，也未做章节质量人工通读。因此不能宣称真机 GUI 写回链或生产级长篇质量验收通过。

### 2026-08-04 渐进式 Project Knowledge 完整链路

在基础发现面之上完成结构化 Markdown v1、`knowledge.propose` durable artifact/event、项目级 Inbox、
强制确认单文件 patch、guarded writeback/reconciliation、冲突与四态生命周期、来源漂移、active retrieval
以及 entry 级安全 provenance。作者编辑只替换未决 proposal；同组 accepted/rejected 历史不会重新变成
pending。冲突 typed API 动态读取当前 Markdown 的旧 claim/source，通用 event/artifact/trace 不含 claim。

最终验证：

```text
pnpm.cmd verify
  -> passed
  -> root ESLint/Prettier passed
  -> Desktop typecheck passed; Vitest 84 files / 546 passed
  -> shared typecheck passed; project-core 7 passed
  -> API 1432 passed / 4 skipped; Ruff passed
  -> sidecar daily smoke passed
  -> OpenAPI / Agent frame regenerated; no drift
git diff --check
  -> passed
focused knowledge/provenance/lifecycle checks
  -> API 33 passed; Desktop Inbox 4 passed; provenance UI 15 passed
Playwright browser visual check
  -> 1280x800 and 390x844: Inbox tabs/badge/empty state fit
  -> conflict old/new claims + sources, decision gate, inline editor fit without overlap
```

首次浏览器检查因普通 Vite 页面没有 Tauri `invoke`，样例项目创建按预期不可用；随后只使用仓库自带
`__STORYFORGE_MOCK_FS__` 和浏览器层 typed Inbox response 做组件视觉检查。它不等同于真机 Tauri。

仍未验证：真机 Desktop 的 proposal -> edit -> materialize -> explicit confirm -> snapshot -> guarded writeback
-> restart recovery -> active retrieval 全链；严格并发 materialize 压测；真实 provider 与人工长篇质量通读。
因此不能宣称真机 GUI 写回链、稳定生产级长篇闭环或人工质量验收通过。

### 2026-08-04 Chapter Writing Module（brief → draft → check → proposed patch）

本轮新增 Desktop 对话显式 `chapter.write`：Chapter Brief 卡片确认、可信上下文快照、一次 repair/recheck
硬门禁、单一 proposed patch，以及 pending resume / F10 断流重建。后端只产补丁，未写项目正文；pending 与
permission 事件不携带绝对项目根路径。

验证：

```text
API chapter writing + resume + contract + runtime tool checks -> 41 passed
API source standards / Ruff                              -> 16 passed / passed
Desktop typecheck                                        -> passed
Desktop Vitest                                           -> 85 files / 549 passed
API full pytest                                          -> 1439 passed / 4 skipped
pnpm verify                                              -> passed
  root ESLint/Prettier                                   -> passed
  shared typecheck / project-core                        -> passed / 7 passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  API pytest / Ruff                                      -> 1439 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                          -> passed
```

根门禁首轮先发现两个局部收尾问题：Chapter Brief 文件未格式化，以及 `useRunAuthorAgent` callback
遗漏 `setChapterBrief` 依赖；修复后又触发该文件 503 行超过 500 行硬限制。删除三处纯空行后，source
standards 16 项与第二轮完整 `pnpm verify` 均通过。

未验证：未调用真实 provider，未在真机 Tauri 手动点穿 Brief -> diff -> guarded writeback；未做章节人工通读或
真实长程质量验收。会话压缩第一阶段尚未实现。上述证据不支持宣称真机 GUI 写回链或生产级长篇质量闭环。

### 2026-08-04 会话压缩第一阶段（真实运行时回注）

现有 deterministic `system_compaction` hidden artifact 已接入下一轮 live loop。artifact 记录 schema、完成状态
和被压缩前缀的最后一条 assistant message ID；读取端只接受当前 assistant session 最新且边界可验证的
artifact，注入一条历史摘要 system message 后再附未覆盖的 user/assistant 原始尾部。旧 schema、坏游标、
跨会话 artifact、查询异常或超过尾部预算时均 fail-open 回退最近 12 条原始消息。

验证：

```text
API compaction + transport + loop focused tests          -> 32 passed
API source standards                                     -> 16 passed
最终定向 compaction/transport/source 回归                 -> 20 passed
API full pytest                                           -> 1442 passed, 4 skipped
API Ruff                                                  -> passed
git diff --check                                          -> passed
pnpm.cmd verify                                           -> passed
  root ESLint/Prettier                                    -> passed
  Desktop typecheck / Vitest                              -> passed / 85 files, 549 passed
  shared typecheck / project-core                         -> passed / 7 passed
  API pytest / Ruff                                       -> 1442 passed, 4 skipped / passed
  sidecar daily smoke                                     -> passed
  OpenAPI / Agent frame drift                             -> no drift
```

未验证：未调用真实 provider，也未评估确定性摘要的事实召回质量。本轮没有引入结构化 provider 摘要、
token/cost 归因、baseline/delta/baseline_seq 或完整 Context Epoch，因此不能宣称高质量长上下文压缩或
生产级 Context Epoch 已完成。

### 2026-08-04 Provider SDK 基础

新增内部 `app/platform/ai_sdk`：provider-neutral message/request/response/tool-call/stream/usage/error/
health/capability contract、同步 `LLMProvider` protocol、deterministic provider 和 OpenAI-compatible typed
adapter。`app/common/llm_client.py` 保留全部既有 facade/monkeypatch seam，将非流式与流式结果通过 typed
adapter 往返投影；成本、latency、中文 `LLMError`、reasoning 清理和旧 dict shape 保持兼容。

定向回归首次发现旧工具 schema 未带 `description` 时 typed round-trip 自动补空字符串；修复为记录字段
是否原本存在，禁止 adapter 发明可选 wire 字段，并新增精确回归。SDK import-boundary 测试禁止生产模块
依赖 FastAPI、SQLAlchemy、`app.domains`、Desktop/Tauri 或小说领域类型。

验证：

```text
SDK contracts / OpenAI-compatible tests                 -> 10 passed
LLM channel + assistant stream + retry compatibility    -> 66 passed
BookRun/judge/usage representative callers              -> 35 passed
source code standards                                   -> 16 passed
targeted Ruff                                            -> passed
pnpm.cmd verify                                          -> passed
  root ESLint/Prettier                                   -> passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  shared typecheck / project-core                        -> passed / 7 passed
  API pytest / Ruff                                      -> 1452 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                         -> passed
```

未验证：未调用真实 provider；Anthropic、Gemini、完整 capability matrix、ToolCallingRuntime 和 live loop
内核迁移属于后续子任务。本切片不支持据此宣称多 provider 已完成或 SDK 已具备独立发布稳定性。

### 2026-08-05 多 Provider 与能力矩阵

内部 SDK 新增 Anthropic/Gemini native adapter，统一 messages/parts、tool use/function call、流式事件、usage、
finish reason 和安全错误分类。capability resolution 固定 `configured > probed > static > fallback`，未知模型能力
保持 `None`。DeterministicProvider 支持脚本化 response/stream/fault 和显式耗尽错误。

thinking 工具调用的原生签名通过不可变 `ProviderContinuation` 保存；Runtime 后续只需调用
`ChatResponse.to_assistant_message()` 原样传递，不需要 Provider 分支，且 continuation 不进入持久化证据。
真实 smoke 为独立显式 opt-in 脚本，默认不出网，输出不含正文、key、认证头或原始响应。

验证：

```text
SDK focused contracts/wire/error/smoke tests             -> 38 passed
LLM/provider/usage/source compatibility regression       -> 96 passed
targeted Ruff                                            -> passed
opt-in smoke default gate                                -> skipped as designed, zero network
pnpm.cmd verify                                          -> passed
  root ESLint/Prettier                                   -> passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  shared typecheck / project-core                        -> passed / 7 passed
  API pytest / Ruff                                      -> 1480 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                         -> passed
```

未验证：没有提供真实 Provider key，因此未执行 Anthropic/Gemini/OpenAI-compatible 的真实 complete/stream/tool
smoke；本轮也未接线默认 provider resolution、StoryForge live loop 或 ToolCallingRuntime。上述证据不支持宣称
真实多 Provider 联网已验收或 Agent Runtime 迁移已经完成。

### 2026-08-05 小说质量诊断与根因优化闭环规划

创建 Trellis 规划任务 `.trellis/tasks/08-05-novel-quality-diagnosis-loop/`，补充 `prd.md`、`design.md` 与
`implement.md`。经用户澄清，本任务定位为 StoryForge 内部 `Novel Quality Lab`，用于失败样本诊断、生成链路
根因归因、单变量 baseline/candidate 实验和项目优化决策，不是 Desktop 作者功能。方案复用 AI SDK、
AgentRun/ModelRun evidence、既有质量检查器和真实生成入口；代码盘点确认 `apps/api/scripts/prompt_lab` 已有
固定输入、生产 prompt 同源变体、repeat/merge、实时落盘与盲评地基，因此方案改为原地扩展 Prompt Lab，
不新增平行 runner。首版采用文件制品，不新增数据库 migration、OpenAPI 或第二套 runtime，也不以自动
总分替代人工通读。

验证：

```text
规划文档人工回读                                      -> passed
git diff --check -- .trellis/tasks/08-05-...           -> passed
```

未验证：本轮仅完成设计与执行计划，未修改运行时代码，未执行 pytest、真实 provider 或长篇人工盲评。
首套 benchmark 范围、默认重复次数和人工评审协议仍待用户设计评审确认。

### 2026-08-05 ToolCallingRuntime 核心

新增内部通用同步工具调用 Runtime：RuntimeTool/Registry、受限 JSON Schema 校验、ToolSelector、RuntimePolicy、
RunTracer、UsageSink、CheckpointStore、round/tool/output/token/cost 预算、多轮工具反馈、approval/interruption、
JSON checkpoint、idempotent resume 与非幂等 reconciliation。核心只接收标准消息和 opaque application context，
不依赖 StoryForge domain、FastAPI、SQLAlchemy、Desktop 或小说类型，尚未接线 live loop。

首轮完整门禁发现递归不可变 helper 被误用于既有 `ToolSpec.input_schema`，嵌套 `mappingproxy` 无法被旧
`llm_client` JSON 序列化，导致 7 个 BookRun/LLM 用例失败。修复为保持 Provider wire contract 的浅层不可变
行为，只对 RuntimeTool/Result/Artifact/ProviderContinuation 使用递归冻结，并新增嵌套 schema 序列化回归。

验证：

```text
Runtime registry/state/budget/recovery focused tests     -> 22 passed
all AI SDK tests                                        -> 60 passed
source code standards                                   -> 16 passed
first pnpm.cmd verify                                    -> failed (7 nested schema serialization regressions)
targeted original failures after fix                    -> 7 passed
final pnpm.cmd verify                                    -> passed
  root ESLint/Prettier                                   -> passed
  Desktop typecheck / Vitest                             -> passed / 85 files, 549 passed
  shared typecheck / project-core                        -> passed / 7 passed
  API pytest / Ruff                                      -> 1502 passed, 4 skipped / passed
  sidecar daily smoke                                    -> passed
  OpenAPI / Agent frame drift                            -> no drift
git diff --check                                         -> passed
```

未验证：未接线现有 StoryForge ToolSpec/PermissionGate/AgentRun trace/checkpoint，也未运行真实 provider 或真机
Desktop。当前证据只证明无 live 调用方的内部 Runtime 核心与离线状态机，不支持宣称 Agent Runtime 迁移完成、
任意指令级 exactly-once 或生产级自动写回闭环。

### 2026-08-05 StoryForge Agent Runtime 迁移

live free-text chat 已保留 `run_chat_loop` facade 与 StoryForge message/context assembly，内部切换为 typed provider +
`ToolCallingRuntime`。新增 ToolSpec/handler、PermissionGate、selector、feedback、usage/cost、trace/evidence、checkpoint
与 artifact adapters；SDK 不读取章节、canon、项目路径或 SQLAlchemy。`read/ask/auto/full`、protected arguments、
单补丁、proposed patch、pause/stop、首轮 fallback、compaction 与 AgentRun/assistant evidence wire shape保持不变。

第一次 API 全量门禁暴露了 SDK 不可变状态泄漏：嵌套参数在 checkpoint 内递归冻结后，以 tuple/`mappingproxy`
进入 StoryForge handler 或 `json.dumps`，造成 13 个 nested-tool 用例失败。修复为 handler 调用与 feedback 构造前
递归 thaw，并新增 nested array/object 回归；SDK checkpoint 内部仍保持不可变。

验证：

```text
live lifecycle/permission/compaction/resume/transport       -> 55 passed
SDK runtime/schema/source/WS focused regressions             -> 74 passed
first full API pytest                                        -> 1496 passed, 13 failed, 4 skipped
affected nested-tool regression after recursive thaw         -> 81 passed
final API pytest                                             -> 1510 passed, 4 skipped
API Ruff                                                     -> passed
headless OpenAI-compatible local tool boundary/transcript    -> passed
pnpm.cmd openapi                                             -> passed, no OpenAPI/Agent frame drift
pnpm.cmd verify                                              -> passed
  root ESLint/Prettier                                       -> passed
  Desktop typecheck / Vitest                                 -> passed / 85 files, 549 passed
  shared typecheck / project-core                            -> passed / 7 passed
  API pytest / Ruff                                          -> 1510 passed, 4 skipped / passed
  sidecar daily smoke                                        -> passed
  OpenAPI / Agent frame drift                                -> no drift
git diff --check                                             -> passed
```

未验证：本轮没有使用真实 Provider key，因此未执行外网 OpenAI-compatible/Anthropic/Gemini complete/stream/tool
smoke；也未宣称真机 Tauri 的自动写回与撤销链已完成验收。现有证据覆盖后端只产 proposed patch、确认位派生与
Desktop guarded writeback 自动化测试，不等同于真实 GUI 人工验收。

### 2026-08-05 最近 Desktop Agent UI 提交审查修复

范围：修复最近 5 个 Desktop 提交中发现的四类回归。对话区补丁接受/拒绝现在携带稳定
`patchId`，由编辑器校验匹配后复用既有 guarded writeback 或清理补丁；待确认 run 重新阻止新消息
静默覆盖；`stopped` 不再渲染空操作条；Composer 不再裁切向上展开的权限菜单。恢复 run 同样把补丁
目标投影到 approval step。DOM 事件契约已同步到 `docs/architecture/agent-shell-contracts.md`。

验证：

```text
失败回归（修复前）                                      -> 5 failed / 15 passed
目标回归（修复后）                                      -> 6 files / 67 passed
Desktop 全量 Vitest                                     -> 88 files / 569 passed
Desktop typecheck                                       -> passed
root ESLint                                             -> passed
本次改动文件 Prettier                                   -> passed
git diff --check                                        -> passed
API source standards                                    -> 14 passed / 2 failed
  既有失败：useRunAuthorAgent.ts 502 lines > 500 hard limit
pnpm.cmd lint                                           -> ESLint passed；Prettier 扫描被既有
  apps/desktop/frontend/src/.pytest_cache 的 EPERM 阻断
```

未修改 API route、DTO、OpenAPI 或 Agent frame schema，不需要刷新 generated contract。未运行真机
Tauri 点击链；补丁接受由跨组件行为测试证明走 `snapshot -> branch -> write -> record`，不能替代真机 GUI
验收。源码上限和 `.pytest_cache` 权限问题均不在本次 diff，按任务边界未顺手修改或删除。

### 2026-08-05 Desktop 布局与视觉交互审查修复

范围：修复最近 2 个 Desktop 提交审查发现的四项回归。无项目时 `Ctrl+3` 现在夹回均衡布局，避免隐藏
欢迎中栏后只剩空窗口；右键菜单改用 Tailwind 可生成的 92% 任意透明度类；行间补丁落位动画拆出纯缓动
token，避免复合 transition token 被解析成额外 120ms delay、导致 170ms teardown 截断动画；作品简介失焦
恢复静息内凹阴影并继续提交草稿。四项均先补失败回归，再修复至通过。

验证：

```text
目标回归（修复前）                                      -> 4 files / 4 failed, 35 passed
目标回归（修复后）                                      -> 4 files / 39 passed
Desktop 全量 Vitest                                     -> 89 files / 572 passed
Desktop typecheck                                       -> passed
Desktop production build                                -> passed（仅既有 chunk/dynamic-import 警告）
目标文件 ESLint / Prettier                              -> passed / passed
git diff --check                                        -> passed
pnpm.cmd verify                                         -> 1508 API passed, 4 skipped, 2 failed
  根 lint、Desktop、shared、project-core                 -> passed
  既有失败：useRunAuthorAgent.ts 502 lines > 500 hard limit（两条断言）
```

未修改 API route、DTO、OpenAPI 或 Agent frame schema，不需要刷新 generated contract。未执行真机 Tauri
人工点击验收；本轮证据覆盖组件行为、样式契约与生产 CSS 构建，不等同于真机 GUI 验收。源码行数门禁失败位于
未改动文件，且在本轮开始前已存在，按任务边界未顺手拆分。

### 2026-08-05 结构化拆书报告（本轮恢复与模型阶段）

范围：重新加入本地参考文本解析、中文章序识别、确定性代表章选择、有限上下文、版本化结构化分析、主模型严格 JSON 重试、`.storyforge/analysis/` 报告文件、AgentArtifact 运行记录和 Desktop 作品栏触发按钮；未接入网页抓取、下游创意生成和专用报告导出页。

验证：

```text
cd apps/api && uv run pytest tests/test_ide_book_breakdown.py tests/test_ide_commands.py -q -> 8 passed
cd apps/api && uv run ruff check app/domains/ide/book_breakdown.py app/domains/ide/command_registry.py tests/test_ide_book_breakdown.py -> passed
npm --prefix apps/desktop/frontend run test -- --run tests/book-profile-view.test.tsx -> 15 passed
npm --prefix apps/desktop/frontend run typecheck -> passed
```

未验证：真实 provider、模型联网质量、取消/漂移恢复、报告专用预览/导出、网页来源和真机 Tauri 点击链。全量 source standards 仍受未改动的 `useRunAuthorAgent.ts` 502 行既有问题阻断。

### 2026-08-05 结构化拆书报告（闭环补全）

本轮补充报告 Markdown 投影、Desktop 侧栏字段预览与 JSON/Markdown 打开入口，以及
`book.breakdown.status` 来源指纹检查。源文件变化时状态显示为 stale；模型 malformed JSON
仍保留确定性底稿并记录错误。

验证：

```text
npm.cmd --prefix apps/desktop/frontend run test -- --run -> 89 files / 574 passed
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
python -m py_compile <touched API modules/tests> -> passed
uv run python -c <breakdown drift smoke> -> completed_deterministic；fresh/stale 与 Markdown 断言通过
pnpm.cmd openapi -> passed, no contract drift
git diff --check -> passed
```

API pytest 未能启动：当前 `apps/api/.venv` 缺少 `prometheus_fastapi_instrumentator`，未擅自安装依赖。
真实 provider、网页来源和真机 Tauri 点击链仍未验证；source standards 的既有 502 行门禁问题保持不变。

### 2026-08-06 结构化拆书报告（取消协议）

补充 `analysis_id` 取消协议：后端登记进程内取消事件，新增 `book.breakdown.cancel`，
在解析/选章/模型返回边界检查取消并落盘 `cancelled` 部分报告；Desktop 运行中显示取消按钮，
取消请求不会被当作成功生成。

验证：

```text
Python py_compile -> passed
uv run cancellation smoke + IDE cancel command smoke -> passed
uv run persistence failure smoke -> passed
npm prettier -> passed
npm --prefix apps/desktop/frontend run typecheck -> passed
npm --prefix apps/desktop/frontend run test -- --run tests/book-profile-view.test.tsx -> 18 passed
```

完整 API pytest 仍受虚拟环境缺少 `prometheus_fastapi_instrumentator` 阻断。

源码标准检查结果：新增 `book_breakdown.py`（500 行）与 `book_breakdown_control.py`（29 行）均在限制内；
检查仍只剩既有 `apps/desktop/frontend/src/components/chat-window/useRunAuthorAgent.ts` 502 行超限。

### 2026-08-07 受控小说润色流水线

范围：`.trellis/tasks/08-05-controlled-novel-polishing`。新增独立润色 provider 槽位、章级
`chapter.polish` ToolSpec/固定管线、确定性本地清理、原文相对质量门禁、Desktop 主动触发与设置 UI，
并让 Ctrl+K 通过 `quality_gate="polish"` 复用同一候选门禁。后端始终只产出 proposed patch；本地降级
候选始终需要人工确认，专用槽位缺失时不会静默回退主模型。

质量审查补充了可信上下文约束投影：`context.load` 的已净化 snapshot 会把人物/设定文件名、人物备注、
设定/时间线事实及显式 Story Memory/章级目标送入实体与事实门禁。固定管线回归证明在线候选删除人物名时
被拒绝且不产生补丁。原生 provider 流式 HTTP 错误也改为固定安全摘要，不再复制上游响应正文。

验证：

```text
API 润色/provider 定向回归                         -> 30 passed
API Agent/provider/Ctrl+K/SDK/source standards     -> 150 passed
API targeted Ruff                                  -> passed
Desktop full Vitest                                 -> 89 files / 579 passed
Desktop typecheck                                   -> passed
Rust llm config tests / cargo check                 -> 2 passed / passed
rustfmt --check src/llm_config.rs                   -> passed
pnpm openapi                                        -> passed；仅 quality_gate DTO 预期 drift，Agent frame 无 drift
git diff --check                                    -> passed
```

`cargo fmt --check` 全 crate 仍会报告未改动 `apps/desktop/src-tauri/src/fs.rs` 的既有格式漂移，未顺手重写。
最终 `pnpm verify` 在根 lint 阶段被未改动
`apps/desktop/frontend/src/components/app/useProjectCommands.ts:81` 的
`react-hooks/set-state-in-effect` 阻断；该文件不在本任务 diff，后续总门禁阶段未在这次 invocation 中执行。

未验证：没有调用真实 provider；没有执行打包后 Tauri 真机的设置、整章动作、diff 确认和 guarded writeback
人工点击链；没有对真实小说样本做人工文学质量通读。因此不能宣称润色质量普遍提升、真实多 provider 联网
稳定或真机端到端写回已完全验收。
### 2026-08-31 Desktop dead-export cleanup

范围：移除未被当前源码、测试或文档引用的前端死导出/辅助函数；保留后端知识查询契约和实际图标导出。

验证：
```text
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
npm.cmd --prefix apps/desktop/frontend run test -> 89 files / 579 passed
git diff --check -> passed
pnpm.cmd lint -> blocked by existing useProjectCommands.ts:81 react-hooks/set-state-in-effect
```

未验证：Vite production build was blocked by EPERM while Tailwind scanned apps/desktop/frontend/src/.pytest_cache; no source compilation error was reported.

### 2026-08-31 API/workflow boundary and dead-code cleanup

范围：确认已退役的 `apps/workflow` 不再作为运行时入口；清理其在当前 API/Desktop 侧遗留的孤儿 helper、未引用导出和占位脚本。保留 `apps/api` 作为 Desktop sidecar 的业务事实源、Agent/IDE 路由和 OpenAPI 契约边界。

验证：
```text
cd apps/api && uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_source_pruning.py tests/test_ide_book_breakdown.py tests/test_source_code_standards.py -q -> 55 passed
cd apps/api && uv run ruff check app --select F401,F841 -> passed
cd apps/api && uv run ruff check app/domains/ide/book_breakdown.py app/domains/ide/command_registry.py run_real_smoke.py -> passed
cd apps/api && uv run python -m compileall -q app -> passed
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml -> passed
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -> 41 passed, 1 ignored
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
npm.cmd --prefix apps/desktop/frontend run test -> 89 files / 579 passed
pnpm.cmd test:project-core -> 1 file / 7 passed
$env:UV_CACHE_DIR=.codex/tmp/uv-cache; pnpm.cmd check:drift -> passed, no OpenAPI/Agent WS drift
pnpm.cmd test:shared -> passed
git diff --check -> passed
```

本轮还修复了拆书命令返回值的回归：`_persist_report()` 返回完整报告时，调用方不再把完整对象嵌套到 `paths` 字段。未通过项：Vite production build 仍被 `apps/desktop/frontend/src/.pytest_cache` 的 EPERM 阻断；根级 `pnpm.cmd lint` 仍被未改动的 `useProjectCommands.ts:81` `react-hooks/set-state-in-effect` 阻断。两项均未报告本轮修改文件的编译错误。
补充收口：移除 `.env.production.example` 中无代码消费者的旧 Workflow runtime 变量，修正 README/运维手册/当前阶段 TODO 对已退役 `apps/workflow` 的活动入口描述，并删除 `.gitignore` 对已删除并发 smoke 脚本的例外。历史架构与迁移 ledger 文档保留不改，作为退役证据。
根级 `pnpm.cmd verify` 已复跑，仍在 lint 阶段被未改动的 `apps/desktop/frontend/src/components/app/useProjectCommands.ts:81` `react-hooks/set-state-in-effect` 阻断；本轮涉及的 Desktop/API 文件未出现在该错误中。
补充文档收口：更新 `CONTEXT.md`、`apps/desktop/README.md`、`docs/agents/domain.md` 与 `docs/operations/release-checklist.md` 中的退役入口描述；兼容 BookRun 调度路由仅改说明文字并执行 `pnpm.cmd openapi`，生成的 OpenAPI/TypeScript 差异仅为 description/summary，同步检查无漂移。
补充删除清单：移除已无调用方的 `apps/desktop/src-tauri/icons/crop_icon.py`、旧图标生成脚本、`apps/desktop/dev.sh`、前端占位 `index.html`、性能配置残留、`restart_api_server` 及其前端包装；smoke 不再 mock 已删除的 `/api/agent-runs/roles`，`run_real_smoke.py` 删除无效脱敏函数。`.env.production.example` 同步移除无消费者的 `WEB_BASE_URL` 与旧 Workflow runtime 配置。
最终复验（2026-09-02）：API 定向回归 55 passed，前端 89 files / 579 tests passed，Rust 41 passed / 1 ignored，project-core 7 passed，OpenAPI/Agent frame drift 无漂移，`git diff --check` 通过。根级 `pnpm.cmd lint` 与 Vite production build 仍分别受既有 `useProjectCommands.ts:81` 规则和 `src/.pytest_cache` EPERM 阻断。
追加修复（2026-09-02）：发现 `.codex/run-real-llm-acceptance-interactive.ps1` 仍指向已删除的并发 runner，且传递已不存在的 `--chapter-parallelism` 参数；已将其收敛到现存 `run-real-llm-long-direct.py`，并更新包装回归。连通性/包装测试 `uv run pytest tests/test_real_llm_connectivity_probe_script.py -q -> 10 passed`，Ruff 通过。为兼容 Windows PowerShell 5，连通性、10 章和交互验收 3 个 UTF-8 脚本补齐 BOM；脚本解析检查均为 0 errors。
追加回归复验：连通性包装、长跑包装、BookRun/IDE/source-pruning 和 source-standards 合计 `uv run pytest ... -q -> 81 passed`，API Ruff 通过，`git diff --check` 通过。
交互验收 wrapper 同步要求 `STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD`，并在 `-Interactive` 下安全询问；与正式长跑 runner 的预检要求保持一致。

### 2026-09-04 清理任务最终复核

本轮登记任务：`.trellis/tasks/09-04-09-04-dead-code-cleanup/`。复核重点是删除项引用、退役 Workflow 边界、BookRun 兼容路由、拆书报告返回结构和跨层契约。

验证命令与结果：

```text
cd apps/api && uv run pytest tests/test_book_run_workflow_dispatch.py tests/test_source_pruning.py tests/test_ide_book_breakdown.py tests/test_source_code_standards.py tests/test_real_llm_connectivity_probe_script.py -q -> 65 passed
cd apps/api && uv run ruff check app/domains/agent_runs app/domains/book_runs app/domains/ide app/domains/runtime_tools app/common/llm_client.py run_real_smoke.py tests/test_real_llm_connectivity_probe_script.py -> passed
npm.cmd --prefix apps/desktop/frontend run typecheck -> passed
npm.cmd --prefix apps/desktop/frontend run test -> 89 files / 579 passed
npm.cmd --prefix apps/desktop/frontend run build -> passed
$env:UV_CACHE_DIR=D:\StoryForge\.codex\tmp\uv-cache; pnpm.cmd check:drift -> passed, OpenAPI 无漂移
git diff --check -> passed
```

Rust 本次尝试因 Cargo 首次下载 `tempfile` 时用户缓存权限/网络受限而中止；未发现代码编译错误。此前同一清理批次已验证 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -> 41 passed, 1 ignored`，本次不重复扩大环境权限范围。

复核修正：`.codex/run-real-llm-acceptance-interactive.ps1` 仍被 API 测试读取，因此恢复 `.gitignore` 对该 wrapper 的跟踪例外；已删除并发 runner 的例外继续移除。删除 `apps/workflow` 相关代码不影响历史文档、迁移 ledger、`workflow-dispatch` 路由、`BookRunWorkflow*` schema 或 `workflow_nodes` 兼容字段。

### 2026-09-06 Desktop UI/UX 首轮规划审查

范围：仅创建本地 Trellis 规划与截图证据，任务保持 planning。产品源码、测试、provider 配置和项目手稿未修改；本报告只追加，保留原有未提交内容。

证据：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/audit.md`。

验证：
- `npm.cmd --prefix apps/desktop/frontend run dev -- --host 127.0.0.1`：Vite 6.4.3 预览；1280×720 默认视口与 1024×768 最小桌面窗口审查。
- 浏览器正常刷新后可复现：欢迎页“命令面板”进入文件搜索空态；设置弹窗 Shift+Tab 可落入背景欢迎页复选框。已保存截图及 DOM/焦点 JSON，未注入 mock runtime。
- `npm.cmd --prefix apps/desktop/frontend run test -- tests/settings-view.test.tsx tests/welcome-page.test.tsx tests/shortcuts.test.tsx tests/side-panel-resize.test.tsx tests/shell-panel-views.test.tsx tests/patch-review-panel.test.tsx tests/permission-profile-selector.test.tsx tests/behavior/writeback-guard.vitest.ts tests/behavior/agent-session-guard.vitest.ts tests/behavior/event-bus-contract.vitest.ts`：10 files / 78 passed，7.66s。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`：通过。
- `git diff --check`：通过。

边界：以上是既有测试基线，无新增产品修复。未启动 API/Tauri/真实 provider；“本地服务 · 连接中断”来自纯前端预览环境，不计产品缺陷。未做生产构建、全量门禁、浅色/系统缩放验收、真实项目编辑/保存/diff 写回或长篇质量验收。窄窗口编辑区宽度仅为代码约束推断，尚未在项目态渲染复现。

2026-09-06 规划续记：用户确认“保留 IDE 骨架，渐进优化”。已同步至本地 PRD 与审查结论；首批场景优先级尚待确认，任务继续 planning。本次仅更新规划文档，`git diff --check` 通过，未改产品代码或重跑行为测试。

### 2026-09-06 Desktop UI/UX 首批实施与复验

用户已选择“保留 IDE 骨架，渐进优化”并要求开始。本轮仅实现欢迎页/设置 UX-01—UX-05：欢迎命令入口改 commands、空 explorer 让出空间、作者视角说明、设置焦点/表单可访问性与可展开技术详情。保存/探测函数、Agent/权限/写回契约未变，保留原有未提交后端与文档改动。

验证命令与结果：
- `npm.cmd --prefix apps/desktop/frontend run test -- tests/welcome-page.test.tsx tests/settings-accessibility.test.tsx tests/settings-view.test.tsx tests/app.test.tsx tests/shortcuts.test.tsx tests/side-panel-resize.test.tsx tests/shell-panel-views.test.tsx`：7 files / 50 passed。
- `npm.cmd --prefix apps/desktop/frontend run test`：最终 92 files / 615 passed。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`、`pnpm.cmd lint`：通过，最终无 ESLint 告警。
- `npm.cmd --prefix apps/desktop/frontend run build`：通过；保留 Tauri event 混合导入与 chunk 大小告警，不压制。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`：通过；独立浏览器 smoke 脚本仅同步断言/语法检查，未运行。实际浏览器复验使用隔离 Vite 预览。
- `pnpm.cmd verify`：exit 0；Shared 类型通过，project-core 7 passed，Desktop 615 passed，API 1592 passed / 7 skipped / 6 warnings，Ruff 通过，独立临时库 daily sidecar 零 LLM 冒烟通过，OpenAPI 无漂移。API 既有弃用/测试 key 长度告警保留。
- `git diff --check`：通过。

渲染证据：1024×768 与 1440px 常规宽度、深浅两主题复验；最小窗口欢迎区 740px→976px，说明 11px→12px。欢迎命令/文件搜索分流、刷新后设置焦点环绕/恢复、无项目说明入口、技术详情搜索/展开均实际操作确认。截图为原始 JPEG；常规宽度截图实际为 1440×838，未伪称全高 1440×900 截图。

详细结果和原图入口：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/implementation-verification.md`。总门禁原始日志：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/pnpm-verify.log`。

未验证：真机 Tauri/WebView2、多轮真实 provider、真实项目打开/保存/diff 写回、系统缩放/屏幕阅读器/真实 IME、C-01/C-02 与长篇质量。浏览器没有连接真实后端，断连状态不计新增故障；总门禁的 sidecar 在独立临时环境运行。已恢复预览主题/视口并关闭本任务标签、停止本任务 Vite。代码未提交；Trellis finish-work 停在未提交检查，不自动提交、归档或改动其他任务。

### 2026-09-06 Desktop UI/UX 第二批阶段复验

本轮新增：项目打开异常接入现有可见弹窗（取消/切换守卫语义不变）；左侧栏支持 Tab、方向键/Shift 调宽、Home/End 和 Enter 复位；欢迎样例卡名称与原生实际生成的“StoryForge 示例项目”一致。不改 API、provider、权限或写回链路，保留所有已有未提交改动。

验证命令与结果：
- 定向 `npm.cmd --prefix apps/desktop/frontend run test -- tests/project-open-feedback.test.tsx tests/side-panel-resize.test.tsx`：2 files / 11 passed；新增错误反馈和键盘回归均先失败再修复。
- `npm.cmd --prefix apps/desktop/frontend run test`：最终 93 files / 620 passed（19:45:25，8.41s）。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`、`npm.cmd --prefix apps/desktop/frontend run build`：通过；构建保留原有混合导入/chunk 告警。
- `pnpm.cmd exec eslint . --ignore-pattern '**/native-ui-20260906-192750/webview/**'`：通过；仅排除本次隔离 WebView 生成缓存的诊断检查，不是原样门禁。
- `pnpm.cmd exec prettier --check "apps/desktop/frontend/src/**/*.{ts,tsx}" "packages/shared/src/**/*.ts" "scripts/**/*.mjs"`：通过。
- `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过；原生验收临时观察分支已还原，最终重新构建通过（18.10s），Rust 源码无 diff。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`、`git diff --check`：通过。
- **原样 `pnpm.cmd lint` / `pnpm.cmd verify` 未通过**：eslint 扫到本轮任务隔离目录 `webview/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js`，10 个生成代码错误；verify 停在首道门禁，后续 API 等门禁本轮未重跑。尝试有路径边界检查的单一缓存清理被执行环境拒绝，保留缓存，未绕过拒绝或修改检查配置。

原生证据：获用户允许后，在独立配置、SQLite、WebView profile 和任务自有样例目录启动当前 debug 构建，通过真实样例按钮/目录选择器创建并打开正文，正常窗口 1402×880。没有写入真实手稿、填写 provider key 或发起模型请求。GUI/隔离后端已关闭，临时 Rust 改动已撤销；**最小窗口拖拽未取得可靠证据，C-01 仍未解决**。纯浏览器实测侧栏值与实际宽度、Tab 可达、刷新后保持 350px、复位 340px；浏览器错误弹窗因缺少 Tauri invoke 触发，仅验证展示，不计原生故障。

详细步骤、命令与边界：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/second-batch-verification.md`。原生截图 `research/native-book-before-wide.png`，本轮预览原图 `research/13-open-project-error-preview.jpg` 至 `research/15-welcome-sample-title.jpg`。预览标签与 Vite 已关闭。未做 GUI diff 写回、多轮真实 provider、系统缩放/屏幕阅读器验收；任务继续 in_progress，代码未提交、未归档。

### 2026-09-06 写作区自适应与补丁头部续进

实现项目态 420px 主区、320—384px 弹性 Agent、只限制显示而不覆盖保存值的侧栏上限；拖拽和方向键从真实显示宽度起算，取消/卸载清理监听。补丁说明和操作组在窄栏换行，保留四个动作与原回调，补分组/展开/拒绝输入语义。无 API/权限/provider/写回契约变化。

- 真实 App 挂载回归确认项目选择后 1024↔1440 resize、Ctrl+3/1/2 实际模式切换、Editor/Agent 节点及状态计数器保留、保存的侧栏偏好不变；重型叶子替换为测试计数器，网络明确失败，不冒充真实 Monaco/Agent 验收。
- 显式标注的无后端组件夹具复用真实 SidePanel/AssistantPanelFrame/PatchReviewPanel：1024px 的侧/中/右为 236/420/320，无工作区横向溢出；1440px 为 420/588/384，保存偏好始终 420。窄栏补丁说明宽度约 156→396px，操作可达、回调可确认但不写文件。测试 HTML 未进入生产 dist。
- `npm.cmd --prefix apps/desktop/frontend run test`：最终 **95 files / 627 passed**（20:09:52，7.72s）；定向 3 files / 24 passed。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`、前端 production build、原范围 Prettier check、`git diff --check`：通过。构建原有混合导入/chunk 告警保留。
- `pnpm.cmd exec eslint . --ignore-pattern '**/native-ui-20260906-192750/webview/**'`：通过，仍只是排除单一旧运行缓存的诊断检查。
- 原样 `pnpm.cmd verify`：**未通过**，仍在 lint 扫到旧 WebView adblock_snippet.js 的 10 个错误，后续门禁没有执行。日志 `D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/pnpm-verify-layout.log`。未修改门禁配置，未绕过已被拒绝的缓存清理。
- 固定 1024×768 的临时原生观察构建通过，但隔离启动命令被执行环境拒绝；未使用其他工具重试。临时 Rust 改动已还原并重新构建通过（14.07s），源码无 diff。本轮未实际接管桌面；57506 无监听，Vite/浏览器夹具已关闭且临时视口 reset。

详细步骤、截图和边界：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/layout-verification.md`。AC14 组件补丁布局完成，AC11 原生最小窗口/真实编辑状态和 AC12 完整门禁仍未完成；没有把组件夹具当作真机 GUI、真实 provider 或 diff 写回验收。保留未提交修改，不归档或缩小持续目标。

### 2026-09-06 完成性审查与剩余门禁补验

本轮无产品源码修改。复查 PRD R1—R15、AC1—AC14、当前工作树和关键证据后，保留 AC11（原生项目态最小窗口/真实状态）与 AC12（原样完整门禁）未完成。前一回合为真实实现/渲染进展，本轮补跑被 lint 提前退出挡住的门禁，不扩展新功能或缩小目标。

本轮实际执行：
- 前端 typecheck 通过；全量 **95 files / 627 passed**（20:16:36，7.87s）。
- 原样 `pnpm.cmd verify` 仍 exit 1：本任务旧 WebView 缓存 adblock_snippet.js 的 10 个 lint 错误，与前两回合一致。日志 `research/pnpm-verify-final-audit.log`。
- 独立执行剩余门禁：Shared tsc 通过，project-core **7 passed**；API `uv run pytest` **1592 passed / 7 skipped / 6 warnings**（228.99s）；Ruff 通过；daily sidecar 独立临时 SQLite/54527 端口、零 LLM 冒烟通过；OpenAPI/实时帧 schema/类型刷新无漂移。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`、`git diff --check` 通过。未额外跑 GUI smoke、packaged sidecar、pnpm e2e 或真实 LLM/写回。上轮 production build/源码诊断 ESLint/Prettier 结果保留，本轮没有再次执行这些项。
- sidecar 验收端口及 UI 验收端口均无监听，临时 smoke 根已移除；原生源码与观察前备份 SHA256 一致，Rust 与生成契约无 diff。

分项通过不能替代原样 verify 成功。旧缓存阻碍已连续三个目标回合复现，前次清理被执行环境拒绝；未通过其他方式清理、移动或改规则绕过。原生隔离启动也曾被拒绝，目前没有新原生验收证据。已没有可通过继续改本轮前端代码消除的已知验收阻碍，持续目标标记受阻，等待用户/环境协助，不标记完成、不提交或归档。

逐项审查、完整日志索引、精确缓存路径和恢复条件：`D:/StoryForge/.trellis/tasks/09-06-desktop-uiux-optimization/research/completion-audit.md`。


### 2026-09-10 全部现有改动提交前复验

范围：按用户要求，将当前 master 的全部非忽略工作区改动提交，并准备连同已有 13 个本地提交推送 origin/master。本轮不改产品代码、不清理运行缓存、不修改门禁，也不创建 PR。

- `git fetch origin`：成功；复核 origin/master 与 HEAD 为 behind 0 / ahead 13，无需合并远端提交。
- `npm.cmd --prefix apps/desktop/frontend run typecheck`：通过。
- `npm.cmd --prefix apps/desktop/frontend run test`：95 files / 627 passed。
- `cd apps/api; uv run ruff check app tests`：All checks passed。
- `cd apps/api; uv run pytest tests/test_source_pruning.py tests/test_redis_cache_strategy.py tests/test_retrieval_real_providers.py tests/test_model_runs.py tests/test_book_run_workflow_dispatch.py tests/test_pagination.py tests/test_s3_integration.py tests/test_llm_config_file_override.py -q`：83 passed / 2 skipped。
- `node --check apps/desktop/frontend/scripts/verify-smoke.mjs`、`git diff --check`：通过。
- `pnpm.cmd verify`：exit 1；仍被 `.trellis/tasks/09-06-desktop-uiux-optimization/research/native-ui-20260906-192750/webview/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js` 的 10 个 ESLint 错误阻断，后续总门禁未执行。`git check-ignore -v` 确认此缓存由 `.gitignore` 的 `.trellis/` 规则忽略，不纳入提交；未改规则或移除缓存。
- 对未推送历史新增行、当前 diff 和 8 个非忽略新文件做常见密钥格式检查，未发现匹配；32 个待提交文件未发现敏感文件名或超过 10 MiB 的文件。这是有限模式检查，不等同于完整安全审计。

未验证：本轮未重跑 API 全量、契约刷新、production build、真机 GUI、真实 provider、长篇质量或写回验收。分项通过不代表总门禁通过；忽略的本地缓存、配置与 Trellis 资料不强制加入 Git。

### 2026-09-10 Desktop UI/UX 重整：首轮规划与只读审计

范围：用户批准建立仓库内 Trellis 任务，先审计并出改版方案；随后明确同意在 `tool_search` / `desktop-commander` 缺失时用只读 PowerShell 检查源码。本轮未修改业务代码，未启动应用、浏览器或后端，未读写仓库外小说、provider 配置或其他工作树。

产物：`D:/StoryForge/.trellis/tasks/09-10-desktop-uiux-redesign/` 下的 `prd.md`、`design.md`、`implement.md`、`research/audit.md` 和任务元数据。任务保持 `planning` / `desktop`；候选方案为作品概览主区化与写作工作台分离，尚未获用户方案确认。旧 UI/UX 任务和其他工作树独有结论未被自动合并、归档或宣称当前已实现。

本轮检查与结果：
- `python ./.trellis/scripts/get_context.py`、`--mode phase`、`--mode packages`、`--mode phase --step 1.1`：完成会话与规划规则检查；起始 Git 工作区干净，基线 `cd228734`。
- `python ./.trellis/scripts/task.py create 'Desktop UI/UX 重整：作品空间与创作主流程' --slug desktop-uiux-redesign`：创建成功；`task.py current` 指向新规划任务，未执行 `task.py start`。
- 只读 PowerShell 和两个只读 explorer：追踪作品侧栏 → 章节打开及 Agent → diff → 写回接缝；当前作品默认 340px 是源码事实，1024px 下侧栏预算 236px 是公式推导，不是本轮 GUI 测量。
- `python -B -` 内存检查：4 份规划 Markdown 的非空、结尾换行、尾部空白、代码围栏和占位词检查通过；42 个唯一绝对路径／行号锚点存在且未越界；任务状态与包归属检查通过。
- `git diff --check`：通过；`git diff --stat -- apps packages`：无输出，产品源码无改动。规划目录被仓库既有 `.trellis/` 规则忽略，已单独检查，不强制加入 Git。

未验证：本轮未运行组件／行为测试、typecheck、lint、build、`pnpm.cmd verify`、OpenAPI 刷新、真机 Tauri、真实 LLM 或写回验收。仅查看旧任务 `native-book-before-wide.png` 作历史视觉参考，不将其冒充当前渲染；不继承历史测试通过结论。PRD 的方案确认与实施门禁仍未完成，不提交、不推送、不启动实现。

### 2026-09-10 Desktop UI/UX 重整：双视图决策同步

用户明确接受“作品总览／写作工作台”结构。已同步 PRD R1/AC2、design、implement 和任务描述，删除该已解决问题；仍保持 `planning`，默认落点与首批交互尚未确认，未启动原型或产品实现。

只读补核 `workspace-session.ts`、`useSessionRestore.ts`、`useEditorWorkspaceTabs.ts`：现有恢复是单个最后工作区快照，手动打开与自动恢复入口可区分，不宣称每部作品各自记忆现场。推荐落点记录为待确认，不当作用户已选。

验证：规划文档／绝对路径行号与 task JSON 检查通过；`git diff --check` 通过；`git diff --stat -- apps packages` 无产品代码变更。未运行组件测试、构建、完整门禁、GUI 或 provider；既有验证报告仅追加，未覆盖。

### 2026-09-10 Desktop UI/UX 重整：默认落点决策同步

用户确认手动打开／切换先总览、启动有效最后章节回正文与光标、已有项目无有效章节回总览。已归入 PRD R5/AC6 并同步 design、implement、恢复审计与任务描述；AC6 是后续行为验收，未因方案批准勾选通过。首批作品总览与写作往返范围仍待用户确认，不改产品代码、不启动原型或实现。

复用原 explorer 对首批范围做只读压力测试：目的地与布局模式分离、手动导航优先、编辑／会话／作品草稿单实例保留、作品数据激活、总览待确认补丁入口属于必要兼容；Agent/diff 整体重设计可后置。这是规划审阅，不是新增运行证据。

验证：4 份规划 Markdown、44 个唯一文件行号锚点和 task JSON 的 `planning`/`desktop` 检查通过；`git diff --check` 通过；`git diff --stat -- apps packages` 无输出。未运行组件／行为测试、构建、完整门禁、GUI 或 provider；保留既有验证报告，仅追加本次记录。

### 2026-09-13 Desktop UI/UX 首批交互原型

用户确认首批范围：作品总览主区化、进入章节、返回总览、必要状态／补丁可达；写作区暂沿用现有布局，Agent/diff 全面重设计后置。已同步 `prd.md` R6/AC7、`design.md`、`implement.md` 与任务描述。

新增仅限 `.trellis/tasks/09-10-desktop-uiux-redesign/research/prototype/` 的自包含 HTML 和 README，不是产品路由或生产组件。A/B/C 三种结构可经 `?variant=A/B/C` 切换；演示导航、章节、主题、状态场景与 diff 均为内存模拟，明确“示例／不写盘”，无 API、Tauri、provider、localStorage 或网络调用。原型问题与运行命令见该目录 `README.md`。

验证结果：`node -e` 提取内嵌脚本并 `new Function` 语法检查通过；本地 `python -m http.server 43193 --bind 127.0.0.1 --directory .../prototype` 已启动；`Invoke-WebRequest` 对 A/B/C 三个变体均 HTTP 200（每个 21725 bytes）；标记／无网络静态检查通过；规划文档无尾空白检查通过；`git diff --check` 通过，`git diff --stat -- apps packages` 无产品代码输出。

限制：当前线程 Browser runtime 无可用浏览器（`agent.browsers.list()` 返回空），未能自动截图或点击验收；用户可打开本地 URL 手动审阅。未运行前端测试、typecheck、lint、build、Tauri、真实 provider 或写回验收。原型保留 A/B/C，尚未选择胜出方案或申请 `task.py start`。

### 2026-09-13 原型临时公网预览

为方便手机 Remote 查看，将仅包含原型目录的本地 HTTP 服务（`127.0.0.1:43193`）通过 Cloudflare Quick Tunnel 暴露：`https://obtain-sight-internship-mono.trycloudflare.com/?variant=A`。公网请求实测 HTTP 200、标题与原型一致；B/C 变体继续通过 `?variant=B/C` 切换。隧道为临时匿名通道，无 uptime 保证；停止本地 HTTP 或 `cloudflared` 进程后链接即失效，不暴露仓库其他目录。未连接 API/provider，原型仍是示例数据且模拟写回不落盘。

### 2026-09-13 公网预览恢复

上一个 Quick Tunnel 在用户手机访问时已返回 Cloudflare `1033`，确认其隧道进程已结束。本次重新以隐藏后台进程启动原型 HTTP 服务和 `cloudflared --protocol http2`，新地址为 `https://forming-hopefully-ind-propecia.trycloudflare.com/?variant=A`。A/B/C 公网请求均 HTTP 200（每个 21725 bytes）；仅服务 `.trellis/tasks/09-10-desktop-uiux-redesign/research/prototype`，未暴露整个仓库。后台进程属于临时预览，电脑休眠、进程回收或隧道故障后仍可能失效。

### 2026-09-13 原型方向选择同步

用户选择 A+B 方向：保留 A 的宽幅作品档案骨架，并吸收 B 的当前章节／继续写作模块；C 已从原型变体中移除，非法 `?variant=C` 回退 A。原型 README 与任务 PRD/design/implement 已同步；A+B 的生产形态（合并一页或两个入口）仍待确认。

验证：原型内嵌 JavaScript `new Function` 静态语法检查通过；公网上 A/B/C 请求均 HTTP 200；原型静态检查确认无 `localStorage`、`sessionStorage`、`fetch(`、`XMLHttpRequest` 或外部 URL；`git diff --check` 通过。未改 `apps/desktop` 产品代码，未运行前端门禁、Tauri、provider 或写回验收。

### 2026-09-13 A+B 合并布局设计定稿

用户确认将 A（宽幅作品档案）与 B（当前章节／继续写作）合并为单一作品总览页；本轮同步 `prd.md`、`design.md`、`implement.md` 和原型 README。生产设计明确 `mainSurface: overview | workspace` 与现有 `layoutMode`/`shell.view` 分离，保留 Editor、ChatWindow、Book 表单实例及现有权限、补丁、写回守卫；手动打开落总览，启动仅在有效章节记录时恢复工作台，补丁事件先使工作台可见。

原型入口 `research/prototype/index.html` 已恢复并改为合并布局，包含总览 → 章节 → 写作 → 返回、章节选择、主题按钮和模拟 diff 接受／拒绝（均不写盘）。

验证：`node -e` 提取内嵌 JavaScript 并 `new Function` 语法检查通过；公网预览 `https://forming-hopefully-ind-propecia.trycloudflare.com/?variant=A` HTTP 200；`git diff --check` 通过；`git diff --stat -- apps packages` 无产品代码输出。当前未运行浏览器 GUI、前端门禁、Tauri、真实 provider 或写回验收。

任务仍为 `planning`；本轮未修改 `apps/desktop` 业务代码，下一步需用户明确授权后才能进入实现。

### 2026-09-13 Desktop UI/UX 首批实现

用户明确授权开始实现。本轮仅改 Desktop 前端：新增 `src/components/app/BookOverview.tsx` 与 `app-shell-types.ts`，并在 `App.tsx` / `AppShell.tsx` 接入 `mainSurface: overview | workspace`。作品总览现在占据主工作区，展示封面、简介、标签、统计进度、最近章节、大纲速览、继续写作和手稿加载错误；写作工作台通过 CSS 隐藏保留 Editor/Chat 实例，章节/搜索/大纲定位会先切回 workspace。手动项目切换落总览，文件打开与补丁定位落工作台；作品数据激活不再只依赖旧 book 侧栏。

验证结果：
- `npm.cmd --prefix apps/desktop/frontend run typecheck`：通过。
- `npx.cmd eslint apps/desktop/frontend/src/App.tsx apps/desktop/frontend/src/components/app/AppShell.tsx apps/desktop/frontend/src/components/app/BookOverview.tsx`：通过。
- `npm.cmd run test`（`apps/desktop/frontend`）：95 files / 627 tests passed。
- `npm.cmd run test -- tests/workspace-layout-app.test.tsx`：通过；回归证明 chat/editor 布局与 Editor/Agent 保留语义未破坏。
- `git diff --check`：通过；`git diff --stat -- apps packages` 仅含上述 Desktop 文件，无 API/契约改动。

未验证：真机 Tauri、浏览器截图/点击、真实 Agent 待确认补丁端到端、provider、写回和全量 `pnpm verify`。现有 `.pytest_full.log` / `.pytest_full2.log` 未触碰。

补充复验（同日）：对无有效 `currentRelativePath` 的总览状态，继续写作按钮现显示“选择章节开始”并禁用，避免自动伪造第一章；typecheck、目标 ESLint 与 `git diff --check` 仍通过。
- 变更后再次执行 `npm.cmd run test`（`apps/desktop/frontend`）：95 files / 627 tests passed。
补充：写作工作台新增“返回作品总览”按钮，使用同一 `mainSurface` 控制器，不重置页签或 Agent。新增改动后 typecheck 与目标 ESLint 通过；此前布局回归和全量前端测试均通过（95 files / 627 tests）。

### 2026-09-14 Desktop UI/UX 主流程补齐

继续实现后，作品导航不再只是旧侧栏：`App` 现在拥有 `mainSurface`，作品图标进入宽幅总览；总览顶部提供“编辑作品资料”和“写作工作台”，写作页提供“返回作品总览”。总览期间 SidePanel、Editor、ChatWindow 以隐藏方式保留挂载，编辑作品资料仍复用原有 `BookProfileView` 和宽度偏好。

新增 `EditorPendingSuggestionSummary` 只读投影（项目、文件、patch id、确认要求），总览显示待确认修改数量并可打开目标文件；既有 `APPLY_FILE_SUGGESTION_EVENT` 仍先让工作台可见，即使目标已经是当前文件也不会被早返回吞掉。总览字数仅使用 `useBookProfile.totals`，章节路径经过项目边界校验；无有效当前章节时引导聚焦章节列表，不伪造恢复目标。

新增 `tests/book-overview.test.tsx` 与 `tests/book-overview-app.test.tsx`，并更新 `workspace-layout-app.test.tsx` 适配“作品图标→总览、编辑资料→旧面板”语义。

验证：
- `npm.cmd run typecheck`（`apps/desktop/frontend`）：通过。
- 目标 ESLint（App/AppShell/BookOverview/Editor）：通过。
- `npm.cmd run test`（`apps/desktop/frontend`）：97 files / 631 tests passed。
- 新增/相关 3 个测试文件：5 tests passed。
- `git diff --check`：通过；无 API/DB/OpenAPI 改动。

未验证：浏览器 GUI/截图、Tauri 真机、真实 Agent provider、真实写回与完整 `pnpm verify`。`.sf_tmp/`、pytest 日志等既有未跟踪文件未触碰。
- `pnpm.cmd lint`：未通过，仍被既有 `.trellis/tasks/09-06-desktop-uiux-optimization/research/native-ui-20260906-192750/.../adblock_snippet.js` 的 10 个 ESLint 错误阻断；改动文件的目标 ESLint 已独立通过，未修改缓存或 lint 规则。
- 变更后最终复验：目标文件 Prettier check、目标 ESLint、前端 typecheck 及 `npm.cmd run test` 均通过（97 files / 631 tests）。
- `npm.cmd run build`（`apps/desktop/frontend`）：通过；Vite 仅提示既有 Monaco 大 chunk 与 Tauri event 动态/静态 import 警告，未改阈值或依赖。
- 按 Phase 3.3 更新 `.trellis/spec/desktop/frontend/state-management.md`，记录 `mainSurface` 与补丁可达性/挂载保留契约。

## 2026-09-14 continued — 示例项目创建入口归入作品总览

- 调整 `apps/desktop/frontend/src/components/app/useProjectCommands.ts`：创建示例项目后保留 `selectProject` 的总览入口，不再强制跳过总览进入工作台；与“项目打开 → 作品总览、明确继续写作 → 工作台”的主流程一致。
- 验证：`npm.cmd run typecheck`（通过）；`npm.cmd run test -- --run tests/book-overview-app.test.tsx tests/book-overview.test.tsx`（2 files / 4 tests 通过）。
- 回归：`npm.cmd run test`（97 files / 631 tests 全部通过）；`npx.cmd prettier --check src/components/app/useProjectCommands.ts`（通过）。
- 同步更新 `.trellis/tasks/09-10-desktop-uiux-redesign/prd.md` 与 `implement.md` 的实施状态，标注用户授权及首批切片已进入 `in_progress`；`python ./.trellis/scripts/task.py validate desktop-uiux-redesign`、`git diff --check` 通过。
- 回归：`npm.cmd run build`（通过；仅保留既有 Monaco 大 chunk / Tauri event split 警告）。
- 回归：目标文件 `npx.cmd eslint src/App.tsx src/components/Editor.tsx src/components/app/AppShell.tsx src/components/app/BookOverview.tsx src/components/app/useProjectCommands.ts`（通过）。

## 2026-09-14 Agent 状态总览可达性（agent_summary）

- 改动：`ChatWindow` 投影 running/waiting/paused AgentRun 摘要，`AppShell`/`App` 转发到 `BookOverview`；总览显示可点击状态卡并回到工作台。
- 竞态：项目切换时先清空旧项目摘要，避免隐藏右栏状态泄漏。
- 验证：`npm.cmd run typecheck`、目标 `eslint`、`npm.cmd run test -- --run tests/book-overview.test.tsx`（4 tests）通过。

## 2026-09-14 continued — 启动恢复与 Agent 状态摘要

- `useSessionRestore` 现在区分“项目不存在”和“项目存在但所有存档页签失效”：后者仍恢复项目本身并由 App 落到作品总览，不伪造 activeFile；新增时序回归测试。
- `ChatWindow` 新增只读 `AgentRunOverviewSummary` 投影，仅暴露 running/waiting/paused 及目标，按项目切换清空旧摘要；总览提供 Agent 状态入口，点击返回工作台。
- 验证：前端 `npm.cmd run test`（97 files / 633 tests）；typecheck、目标 ESLint、Prettier 全部通过。
- `npm.cmd run build`（Agent 摘要与启动恢复改动后复验通过；仅既有 chunk 警告）。
- 补充集成验证：`tests/book-overview-app.test.tsx` mock Agent 运行态在隐藏右栏时仍显示总览状态卡，点击后回工作台（1 test）通过。
- Agent/恢复切片后复验：前端 typecheck、目标 ESLint、Prettier、`git diff --check` 与 Trellis task validate 均通过；全量测试 97 files / 633 tests。
- 项目切换清理改为 `showOverview` 同步清空 Agent 摘要，避免 React effect 级联渲染；`npm.cmd run typecheck`、目标 ESLint、总览集成测试继续通过。
- 复核 Agent 状态卡：surface-only 总览/工作台切换保留运行摘要，项目切换由 ChatWindow project-scope effect 清理旧摘要，避免返回总览时误隐藏活动任务；typecheck 与 3 个相关测试文件（13 tests）通过。
- 项目切换竞态再收紧：总览仅渲染与当前 `activeProject` 匹配的 pending/Agent 摘要，避免 effect 清理前短暂串项目；前端全量测试 97 files / 633 tests 通过。

## 2026-09-14 restore handoff guard

- `npm.cmd run test -- --run tests/workspace-session.test.tsx`：10 tests passed。
- `npm.cmd run typecheck`（`apps/desktop/frontend`）：passed。
- `npx.cmd eslint src/components/app/useSessionRestore.ts tests/workspace-session.test.tsx`：passed。
- 覆盖：迟到自动恢复不覆盖手动项目；非正文/失效 activeFile 不伪造章节；有效页签与光标保留。

## 2026-09-14 完整章节索引切片
- 新增 pps/desktop/frontend/src/components/app/useBookOverviewChapters.ts 与 src/lib/project/chapter-index.ts：基于 uildProjectIndex 只读本地确定性索引，完整列出 draft Markdown，项目边界校验当前章，状态含 loading/available/error/unavailable，支持 retry 与 FS_MUTATION_EVENT 防抖刷新。
- 新增 	ests/use-book-overview-chapters.test.tsx：覆盖完整列表与序号、跨项目迟到结果、错误重试与项目内文件变更。
- 验证：
pm.cmd run test -- tests/use-book-overview-chapters.test.tsx 3/3；目标 ESLint/Prettier 通过。
- 注意：全量 typecheck 当前被 ChatWindow AgentRunOverviewSummary status 联合类型（waiting）既有接线错误阻断，已通知主代理。

- 章节索引边界加固：uildProjectChapterIndex 二次验证
elativePathInsideProject(index.projectPath, file.path)，拒绝不在项目内的 draft 条目；project-context.ts re-export hook helper/type。目标 eslint、章节测试 3/3、typecheck 通过。

## 2026-09-14 session restore issue projection

- `useSessionRestore` 暴露只读 `restoreIssue`：区分 missing-project 与 check-failed；不改变自动恢复安全边界。
- 手动 `selectProjectManually` 清理 issue；项目检查异常不导航，等待 App 通过现有 toast/通知呈现。
- `npm.cmd run test -- --run tests/workspace-session.test.tsx`：11 tests passed；`npm.cmd run typecheck`：passed。
- 后续补充 `workspace-session.test.tsx`：restoreIssue（missing/check-failed）、手动接管清理错误；当前定向 14 tests passed。
## 2026-09-14 useBookProfile 读取/保存错误切片
- useBookProfile 新增可选只读投影 profileError / outlineError / outlineLoading / saveError：非缺失档案 I/O 不再吞为默认空档案；大纲读取失败不再静默空列表；保存失败保留作者当前编辑值但暴露失败原因与 toast。按 activeProject lifetime 守卫迟到保存失败，避免污染切换后的项目。
- 新增 tests/use-book-profile-errors.test.tsx：4/4 覆盖档案读取失败、大纲失败、保存失败可见、跨项目迟到保存失败隔离。
- 验证：目标测试、ESLint、Prettier、typecheck 通过。

## 2026-09-15 UI 全量修整复验

- 独立章节索引已接入作品总览：本地 `buildProjectIndex` 生成完整正文列表，当前章节只在当前文件真实存在且属于正文时显示；章节字数未知明确显示“字数未知”。
- Agent 状态投影区分运行、权限/章节/补丁等待、暂停、完成、停止、失败和会话错误；总览入口实际打开工作台/对话栏，不虚报已重试。
- 启动恢复接入手动项目选择：generation 守卫阻止迟到恢复覆盖；保留有效页签/光标；失效或非正文 activeFile 回总览；missing-project/check-failed 通过 Toast 明示。
- 作品资料/大纲/保存错误均有可见状态，保存失败保留编辑值；侧栏隐藏时 BookProfile/Editor/Chat 仍保持挂载。
- 运行验证：`npm.cmd run typecheck`、目标 ESLint、`npm.cmd run test -- --run`（100 files / 649 tests）、`npm.cmd run build`、`git diff --check` 均通过。
- 浏览器真实渲染验收：UI 夹具在 1024x768/1440x900 × 深色/浅色四种组合通过；章节点击进入工作台，待确认补丁可见并回到总览显示计数；后端 503 被如实显示为离线状态，未伪造业务数据。
- `pnpm.cmd lint` 仍被既有 `.trellis/tasks/09-06-desktop-uiux-optimization/research/native-ui-20260906-192750/.../adblock_snippet.js` 10 个 ESLint 错误阻断，未修改该缓存或 lint 规则；改动文件目标 ESLint 独立通过。
- 未宣称 Tauri 真机、真实 provider、真实 guarded writeback 已验收；未提交或推送。

### 2026-09-15 最终微调复验

- `App.tsx` 400 行、`AppShell.tsx` 494 行，满足前端 owner 行数护栏；侧栏隐藏改为 CSS 隐藏而非卸载，确保资料表单状态保留。
- 命令面板“恢复完整布局/聚焦对话/聚焦工作区”从总览也会先返回工作台，避免死动作；Ctrl+B、作品/其他 Activity 导航同样遵循 surface 控制器。
- 章节索引 loading/error 状态在总览中明确展示，后端 context 失败不再覆盖独立本地章节事实。
- 最后复验：typecheck、100 files/649 tests、build、target ESLint、Prettier touched-file check、git diff --check 均通过。

## 2026-09-18 UI/UX 优化后只读复查

- 基线：`2d420127`；未改产品代码。报告：`.trellis/tasks/09-18-desktop-uiux-followup-review/review.md`，截图与观察记录在其 `evidence/`。
- `npm.cmd run typecheck`（`apps/desktop/frontend`）：通过。
- `npm.cmd run test -- tests/book-overview.test.tsx tests/book-overview-app.test.tsx tests/accessibility-guards.test.ts tests/shell-panel-views.test.tsx tests/workspace-layout-app.test.tsx tests/shortcuts.test.tsx tests/editor-tabs.test.tsx tests/search-view-live-region.test.tsx tests/chat-run-live-region.test.tsx tests/settings-accessibility.test.tsx`：10 files / 53 tests passed。
- 浏览器验证：实际欢迎页与设置；仓库现有 UI fixture 在 1024×768 深色总览/工作台/补丁、1024×768 浅色总览、1920×1080 浅色总览。设置搜索与 Escape 焦点返回正常；小窗口补丁操作组均可见。
- 已确认问题：同一侧栏收起后无法通过当前图标重新展开；总览未呈现 profileError/outlineError，失败显示为空；深色主按钮文字对比度 2.53:1、浅色 11px 提示 3.25:1；骨架与正式 hero 同时渲染。
- 骨架证据：临时 Node/Vite SSR 加载真实 BookOverview + emptyBookProfile；loading 下 skeleton/hero/chapterList/continueButton 同时存在，settled 下仅 skeleton 消失。无新增产品测试文件。
- 未验证：原生 Tauri、真实 provider、真实 guarded writeback、全量 pnpm verify、屏幕阅读器听测、长篇质量。现有 fixture 的 503 不视为产品在线服务故障；未接受补丁、未写入真实小说。

## 2026-09-18 Desktop UI/UX 后续优化实施

- 范围：侧栏 toggle/总览导航、资料/大纲读取状态与重试、陈旧字数标识、互斥 hero/skeleton、主题对比度、空封面文案、Agent 提示填入与焦点。API、权限及 guarded writeback 契约未变；Editor/Chat 保持挂载。
- `npm.cmd run test`（`apps/desktop/frontend`）：104 files / 688 tests passed。最后的占位高度与光标调整后，五个相关测试文件再次通过，25 tests passed。
- `npm.cmd run typecheck`、`npm.cmd run build`：通过；构建仍有既有大 chunk 和 Tauri event 混合导入提示。
- 本轮全部改动 TS/TSX 的目标 ESLint、目标 Prettier、`git diff --check`：通过。`uv run pytest tests/test_source_code_standards.py -q`：16 passed；App 从 413 降为 398 行，总览从 535 降为 382 行，新增 Hero 250 行。
- `pnpm.cmd verify`：在首个 lint 阶段被旧 `.trellis/tasks/09-06-desktop-uiux-optimization/research/native-ui-20260906-192750/webview/EBWebView/Subresource Filter/Unindexed Rules/10.34.0.84/adblock_snippet.js` 的 10 个错误拦住，后续总门禁阶段未执行。完整输出在本任务 `evidence/verify-local.log`；未修改缓存或 lint 配置。
- 诊断检查 `pnpm.cmd exec eslint . --ignore-pattern '.trellis/tasks/09-06-desktop-uiux-optimization/research/native-ui-20260906-192750/webview/**'` 通过，仅用于确认错误来源，不视作总门禁通过。独立运行根 Prettier 后只剩 `CommandPalette.tsx`、`shell/ContextMenu.tsx` 两个既有格式问题；已按字节验证与 HEAD 相同。
- 对比度：深色主按钮由 2.53:1 提高为 6.72:1，浅色为 5.81:1；subtle 在最弱 elevated 表面深/浅分别为 4.59:1 / 4.76:1。回归断言覆盖双主题的四类常用表面。
- 浏览器：真实 App/Editor/Chat 的隔离内存夹具完成 1024×768 / 1920×1080 × 深浅主题检查。侧栏可见序列 1→0→1；提示追加保留草稿、焦点为真实 textarea，光标到末尾且提示可见。1024 下四个补丁操作按钮均在视口内，未接受补丁。
- 加载几何：1024 下骨架/hero 均 300px、章节列表 y=497.5；1920 下均 348.65625px、章节列表 y=632.15625。成功内容与骨架不共存；读取失败显示错误和重试，旧字数标“上次统计”，恢复后重新显示有效资料。无横向页面溢出。
- 证据：`.trellis/tasks/09-18-desktop-uiux-followup-review/evidence/optimized-*.png`、`optimized-browser-observations.json`。记录中明确保留了一次热重载导致无项目的无效采样，最终结论仅用后续 verified 样例。
- 已更新本地 Trellis frontend component guidelines；该目录按仓库 `.gitignore` 约定保持本地。未验证原生 Tauri、真实 provider、真实写回、屏幕阅读器听测和长篇质量。产品改动已完成，git 提交与任务归档待提交计划确认。

## 2026-09-18 API IDE 无调用读路由收窄

- 从 `apps/api/app/domains/ide/router.py` 移除已核实没有 Desktop 调用方的 6 条旧读路由：workspace tree、diagnostics、scene、context snapshot、Story Memory query、artifact preview；对应 service/schema 实现保留供未来产品面复用。
- 删除仅覆盖这些 HTTP 契约的 5 个 API 测试文件，新增 `test_source_pruning.py` 路由/OpenAPI 不复活护栏；同步更新 `DOMAINS.md`、重构主计划和生成的 OpenAPI/TypeScript 契约。
- 验证：API 全量 `1560 passed, 7 skipped`；定向 IDE/source-pruning/api-surface `46 passed`；Ruff、shared TypeScript、Desktop frontend typecheck 通过；`pnpm.cmd check:drift` 通过；`git diff --check` 通过。
- 未验证：真实 Desktop GUI、Tauri、真实 provider、guarded writeback 和长篇质量；根级 `pnpm verify` 未在本轮重跑。

## 2026-09-20 Desktop 客户端体验优化 · 诊断与规划

- 创建本地 Trellis 任务 `.trellis/tasks/09-20-desktop-client-experience`，状态 planning。用户已批准只读 shell 诊断与核心工作区重排方向；尚未批准最终方案实施。没有修改产品代码、API 或共享契约。
- 已完成项目边界/旧任务核对、两份并行源码审计、PRD/设计/实施计划及真实浏览器视觉基线；原有工作树改动保留。
- `npm.cmd run typecheck`（apps/desktop/frontend）：通过。
- `npm.cmd run test -- tests/workspace-layout-app.test.tsx tests/book-overview-app.test.tsx tests/settings-accessibility.test.tsx tests/conversation-starters.test.tsx tests/editor-tabs.test.tsx`：5 files / 21 tests passed。
- `python ./.trellis/scripts/task.py validate .trellis/tasks/09-20-desktop-client-experience`：上下文清单校验通过；`git diff --check` 通过。
- 浏览器使用原有 `tests/fixtures/uiux-app.html`，隔离端口 3017；检查 1280×720 深色欢迎/总览/工作台，1024×768 深浅工作台与浅色补丁预览，1440×900 浅色总览待确认入口。没有接受补丁；夹具固定 503 不视作产品网络故障。已关闭临时页并停止本轮 Vite 服务。
- 审计风险与设计机会明确分开；各项源码风险尚需实施时独立最小复现/失败测试，不因基线测试通过就认为覆盖。没有把已有适配、对比度修复或 CSS 保挂载列为缺失能力；也不统一禁用输入控件中的全局保存/搜索。
- 未验证：新设计（尚未实现）、全部分辨率/缩放矩阵、全量 test/build/lint/verify、Tauri 真机、真实 provider/写回、屏幕阅读器听测及长篇质量。材料见本任务 `research/`，截图在任务会话内，未保存本地 PNG。

## 2026-09-20 UI/UX 第一批：客户端外壳与正文层级

- 实施：`App.tsx` 壳层导航快捷键仅在非可编辑目标且非 IME 时接管；保留 S/P 跨文本语义；返回作品总览并入页签行；页签改为单一 `role=tab` 按钮与相邻关闭控件，补 Home/End、关闭焦点衔接；移除重复 WebKit scrollbar 级联并同步 scrolling token。
- 通过：`npm.cmd run typecheck`；`pnpm.cmd exec vitest run tests/editor-tabs.test.tsx tests/shortcuts.test.tsx tests/workspace-layout-app.test.tsx tests/book-overview-app.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`（4 files / 21 tests）；`npm.cmd run build`；`git diff --check`。
- 备注：测试输出含既有 StatusBar act 警告、Tauri invoke mock 警告；不影响通过。构建保留既有动态导入和大 chunk warning。未验证 Tauri 原生窗口、Firefox/真实 WebView scrollbar 差异、完整尺寸/缩放矩阵和全量门禁。

## 2026-09-20 UI/UX 第二批：Agent 连续交互与审阅反馈

- 实施：Composer 运行中待发改为带 scope/id 的内存有序队列，切换/卸载清理并提供可取消列表；MessageList 增加 48px near-bottom 跟随、上滚 unread 回底入口且 mousedown 不抢 Composer 焦点；PatchReviewPanel 限制当前可见操作组、非文本/非 IME 快捷键并加 action in-flight 状态；useSuggestionWriteback 对接受/分块/旁注/拒绝加 token 防重复与旧 suggestion 失效。
- 通过：`npm.cmd run typecheck`；`pnpm.cmd exec vitest run tests/editor-tabs.test.tsx tests/shortcuts.test.tsx tests/workspace-layout-app.test.tsx tests/book-overview-app.test.tsx tests/chat-window-lifecycle.test.tsx tests/message-list-scroll.test.tsx tests/chat-ux-polish.test.tsx tests/chat-run-live-region.test.tsx tests/patch-review-panel.test.tsx tests/behavior/patch-rejection.test.tsx tests/behavior/auto-writeback.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`（11 files / 85 tests）；`npm.cmd run build`；`pnpm.cmd exec prettier --check ...`；`git diff --check`。
- 备注：测试有既有 React act/Tauri mock 警告；构建保留动态导入与大 chunk warning。未验证 Tauri 原生窗口、真实 provider/写回、完整尺寸/缩放矩阵、Firefox/真实 WebView 滚动条和全量门禁。

## 2026-09-20 UI/UX 第二批补充复验

- `pnpm.cmd exec vitest run tests/patch-review-panel.test.tsx tests/behavior/patch-rejection.test.tsx tests/behavior/auto-writeback.test.tsx --pool=threads --maxWorkers=1 --reporter=dot`：3 files / 39 tests passed。
- `npm.cmd run typecheck`（`apps/desktop/frontend`）：通过；`git diff --check`：通过。
- 额外覆盖：补丁写回失败后面板保留、状态可重试；旧 suggestion 异步完成不会释放新补丁 action 状态；接受/拒绝等操作防重复提交。

## 2026-09-20 UI/UX 第三批：总览、设置、恢复与集成收口

- 实施：总览长篇章节改为当前章附近 8 章窗口并提供“查看全部”手稿入口；编辑器读文件失败显示真实错误和可重试按钮，保留 request-id/model 隔离；恢复流程补 A→B→A 迟到结果回归。
- 实施：Settings provider/polish 的读取、探测、保存和清除动作加入 scope/revision/request token 守卫，迟到结果不覆盖新输入；Toast action 按 item identity 防双击，处理中状态可见，失败保留通知并支持重试。
- 通过：前端 `npm.cmd run typecheck`；定向 20 files / 150 tests。全量首跑发现 `Composer.tsx` 裸 `rounded` 违反现有 radius 规则；修复为 `rounded-sm` 后，`radius-scale` 与相关 3 files / 23 tests 通过，并复跑全量 `pnpm.cmd exec vitest run --pool=threads --maxWorkers=1 --reporter=dot`：106 files / 708 tests 全部通过。
- 通过：`npm.cmd run build`；目标 ESLint（CSS 文件被配置忽略的既有 warning，无 error）；目标 Prettier；`git diff --check`；Trellis task validate。
- 备注：测试仍有既有 React act、SSR `useLayoutEffect`、Tauri invoke mock 警告；build 保留 Tauri 动态导入和 Monaco 大 chunk warning。未验证 Tauri 真机、真实 provider/guarded writeback、屏幕阅读器听测、完整缩放矩阵；未运行根级 `pnpm verify`。
- 后续复验：修正 `App.tsx` 行数回到 400 行并通过 `uv run pytest tests/test_source_code_standards.py -q`（16 passed）；根级 `pnpm.cmd verify` 全绿：API 1560 passed / 7 skipped、Ruff、sidecar smoke、OpenAPI drift 均通过。


## 2026-09-24 公开测试版发布准备 · 规划初稿

- 用户确认目标为 GitHub Release + 安装包的公开测试版，并授权本地 Trellis 规划；创建 `.trellis/tasks/09-24-public-beta-release`，状态 planning，含 PRD、设计和实施计划草案。首发平台等决策待确认。
- 只读核查：`git status --short`、产品配置/发布脚本/更新检查/密钥存储源码；`gh repo view` 确认 PUBLIC、`gh release list` 无 Release；本地无 `.github/workflows`，远端最近查询的 CI 记录为历史失败，不推断当前提交失败。未读取实际密钥。
- 历史验证结果仅引用 9 月 20 日记录，不作为本次安装包验收。未改产品代码；未构建、安装、调用真实模型、提交、推送或发布。
- 规划校验：`python ./.trellis/scripts/task.py validate .trellis/tasks/09-24-public-beta-release` 通过，但 implement/check context 均为 0 条，仅结构检查，不满足实施就绪；`git diff --check` 通过。未执行 `task.py start`。

### 2026-09-24 发布范围确认

- 用户明确首发仅 Windows x64；同步更新发布任务 PRD、设计、执行计划与 task.json，排除 macOS/Linux/Windows ARM64 安装包，最低 Windows 版本和签名安排仍待决定。
- 文档一致性断言通过：三份规划材料均含 Windows x64，任务仍为 planning。仅规划文档变更，无产品测试、构建、安装、提交或发布。

### 2026-09-24 公开前签名门槛确认

- 用户选择「准备签名后公开」；同步 PRD、设计、执行计划与 task.json，签名缺失/验证失败阻止公开发布，不自动降级未签名公测。尚未选择或采购签名证书/服务。
- 规划一致性断言通过，任务仍为 planning；未改产品代码，未构建、调用真实模型或操作远端。

### 2026-09-24 BYOK 产品方案确认

- 用户确认首版 BYOK：用户自带模型 key 并直接承担提供商调用费用，不新增共享密钥、代付或充值服务；同步 PRD、设计、执行计划与 task.json。真实模型验收预算仍待独立确认。
- 三份规划文档的 BYOK 一致性断言、planning 状态断言及 `git diff --check` 通过；仅更新规划材料和本报告，未改产品代码、调用模型或发布。

### 2026-09-24 手动升级方式确认

- 用户选择提示新版后手动下载安装；同步 PRD、设计、执行计划与 task.json。首版不新增自动下载/安装，仍要求真实制品下载入口、升级数据保留和恢复验证。
- 规划断言及 `git diff --check` 通过；任务保持 planning，未改产品代码、构建或发布。

### 2026-09-24 已有改动纳入原则确认

- 用户选择现有 UI/UX 优化、API 清理及契约变更经审查验证后纳入公测；同步三份规划材料及任务元数据。临时日志、缓存、私有配置及无关文件排除，但不删除；该选择不是产品改动、提交或推送授权。
- 文档断言及 `git diff --check` 通过，仍为 planning。具体候选差异尚未完成审计，不宣称这些变动已通过发布验收。

### 2026-09-24 首版 Windows 支持范围确认

- 用户选择仅承诺 Windows 11 x64；更新 PRD、设计、执行计划和任务元数据，不承诺 Windows 10，不据此新增 OS 硬拦截。具体测试系统版本将在验收证据中注明。
- 三份规划文档的系统范围断言、planning 状态断言及 `git diff --check` 通过；仅更新规划材料，未更改产品代码或执行安装验收。

### 2026-09-24 个人发布与签名主体确认

- 用户选择个人名义发布和申请签名；同步三份规划材料及 task.json。签名服务资格、地区适用性及成本仍待官方资料核实，不假定证书可用，不采购或索取私钥/身份证件。
- 个人主体文档一致性断言、planning 状态断言及 `git diff --check` 通过；未改产品代码或操作远端。

### 2026-09-24 受限许可方向确认

- 用户希望保留商用或再分发限制；更新规划材料与任务元数据，明确软件转售/托管、修改版分发与作者商业写作的边界尚未确认，不推断作品禁止盈利，不选定或新增许可证。
- 三份规划材料的许可方向断言、planning 状态断言及 `git diff --check` 通过；未修改产品代码、许可文件或远端内容。

### 2026-09-24 软件商业分发与作者作品收益边界确认

- 用户选择限制未经另行授权的软件转售/收费托管，但允许作者使用软件创作并赚取稿费等作品收益；更新 PRD、设计、执行计划及任务元数据。免费再分发条件和具体许可证仍待确认，不采用笼统禁止一切商业用途的表述。
- 三份规划材料的边界断言、planning 状态断言及 `git diff --check` 通过；未新增 LICENSE、改变产品代码或对外发布授权条款。

### 2026-09-24 修改版分发许可确认

- 用户选择修改版即使免费对外分发也须事先许可；同步 PRD、设计、执行计划与任务元数据。原版免费再分发条件尚待确认，不把软件分发限制扩展为作者作品发布限制，未选定许可证或宣称限制已生效。
- 三份规划文档的修改版分发规则断言、planning 状态断言及 `git diff --check` 通过；未修改产品代码、LICENSE 或远端资源。

### 2026-09-24 原版安装包分发规则确认

- 用户选择原版只分享官方下载链接，重新上传或镜像分发须事先许可；同步 PRD、设计、执行计划与 task.json。尚需核对公开源码平台与第三方组件许可边界，不宣称项目限制已生效或覆盖第三方权利。
- 三份文档的下载入口规则断言、planning 状态断言及 `git diff --check` 通过；未改变产品代码、LICENSE、仓库可见性或远端资源。

- 后续只读许可核查：已阅读 GitHub 官方服务条款 D.5、可见性变更文档及 Git 官方 GPL v2 文本，结合本地 MinGit notices 写入发布任务 `research/distribution-license-boundaries.md`。源码可见性策略仍待用户决定；未完成全量第三方合规审计，未变更远端。

### 2026-09-24 保持源码公开确认

- 用户选择源码继续公开并接受 GitHub 站内查看/fork；同步 PRD、设计、执行计划、许可研究与 task.json。软件/安装包商业及对外分发限制须保留平台和第三方权利例外，不私有化或新增分发仓库。
- 规划文档的源码公开/fork 一致性断言、planning 状态断言及 `git diff --check` 通过；未新增许可证、修改产品代码或更改远端。

- 个人签名资格初查：Microsoft 官方 Quickstart 将 Artifact Signing 个人公开信任申请范围列为美国/加拿大；已记录到 `research/personal-signing-eligibility.md`。申请人地区尚未知，不据语言或时区推断，不采购或变更签名门槛。

### 2026-09-24 中国大陆个人签名资格与费用初查

- 用户确认中国大陆个人主体；同步规划材料及签名研究。依据微软官方个人地域条件排除 Artifact Signing Public Trust；Certum Standard Cloud 与 SSL.com IV 仅列为询证候选，不承诺中国大陆受理。
- 官方页面价格分别为 EUR 209 起（Certum 当前抓取显示缺货）、USD 129/年证书（SSL.com，云签名订阅或硬件另计）；不视为完整报价，不假定项目满足开源优惠资格。未询价、购买或收集证件。
- 三份规划文档的地区断言、planning 状态断言及 `git diff --check` 通过；未改产品代码或发布。

### 2026-09-24 最终许可证决定：标准 MIT

- 用户在获知 MIT 允许商用及再分发后明确选择标准 MIT，覆盖此前受限分发意向；同步三份规划材料、许可/签名研究和 task.json，移除活动要求中转售/托管/原版或修改版分发须批准等限制。历史记录保留但不再作为实施依据。
- 第三方许可证不变；贡献来源、版权署名和依赖审计待确认，根 LICENSE 尚未创建。开源签名计划资格需按 MIT 重新筛选，不自动承诺合格或购买。
- 活动文档 MIT 一致性及旧要求消除断言、planning 状态断言、`git diff --check` 通过；未改产品代码、提交、推送或发布。

### 2026-09-24 标准 MIT LICENSE 落地

- 用户确认使用 MIT 及版权署名 XZZKANY；确认根目录无既有许可证后，以独占创建模式新增 `LICENSE`，写入完整标准 MIT，版权行为 `Copyright (c) 2026 XZZKANY`。仅同步相关规划状态，未改产品代码或第三方许可证。
- 校验：从 SPDX 官方 MIT 文本取得参考，替换年份/署名后按空白归一化与本地正文完整比对通过；UTF-8 无 BOM、无尾随空格检查通过；`git diff --check` 通过；活动规划文档的署名/落地状态一致性断言通过。
- LICENSE SHA-256：`1caea8bb502ed484b9a311ebc6965ec85cbfa5a6063e8242e58770aedabfa5c9`。
- 未验证：已有代码授权来源、完整依赖许可审计及安装包携带许可；未跑产品测试（纯许可/规划文档变更）。整体任务仍 planning，未提交、推送、购买签名或发布。


### 2026-09-24 发布工程拆分与只读研究

- 继续 planning：建立三个子任务（Windows BYOK 密钥保护、公测更新入口与许可交付、候选安装包签名与真机验收）的 PRD/design/implement；首项整理真实上下文 manifests，未 start。
- 保存候选清单与只读审查：当前 OpenAPI 相对 HEAD 移除 6 个路径/18 个 schema，保留路径操作无结构变更；动态调用兼容、删除测试的替代保护及全部当前测试仍未验证。新增相关测试列入候选，日志/缓存排除但未删除。
- 官方资料研究：Windows 用户级 DPAPI 跨 Rust/Python 配置方案；MIT 后 Certum OSS/SignPath 资格与限制。官方资料不是 native 互操作、证书可购或大陆受理证明；未购买、询价或提交身份信息。
- 检查通过：task.py validate 密钥子任务（implement 6/check 2 条真实引用）；父子关系、planning 状态、三份规划无 TBD 与 MIT/支持范围一致性断言；git diff --check。结构验证不等于产品通过或发布就绪。
- 本轮只修改规划材料和本报告；未修改产品代码、读取真实 key、运行产品测试、构建安装包、调用付费模型、提交、推送或发布。首项工程等待用户审阅确认；后续渠道/版本、签名资源和模型验收预算仍待决定。


### 2026-09-24 Windows BYOK 密钥保护与迁移

- 授权与范围：用户确认“嗯 开始吧”，启动 `09-24-beta-key-protection`。仅改动密钥存储/读取、启动配置边界、provider-health 配置错误映射和相关测试；未修改既有 UI/UX/API 路由清理差异，未迁移开发者真实 llm-provider.json，未调用真实模型或采购/发布。
- 实现：Windows 用户级 DPAPI，磁盘 schemaVersion=2，main/polish apiKey 为受保护 envelope 或 null。迁移全部槽位保护并解密自检后，以 tempfile 同目录暂存、sync/persist 原子替换；失败保持原文件且清理暂存。Tauri DTO 不回显明文/密文；设置保留只读元数据，支持损坏的两个槽位分别重新输入。新 key 不再作为 spawn 环境快照注入；托管后端实时解保护，缺文件/损坏/未知版本明确失败，clear/null 和缺 polish 不复活旧环境 key。非托管旧 CLI 和显式 env 保持兼容。
- 错误可见性：provider-health 返回已有 misconfigured 结构；修订请求遇到不可解密 key 在网络调用前返回安全 503。新增固定消息不含配置原文/密文，原有 OpenAPI/WS DTO 未修改。get hasApiKey 仅表示已存字段存在，不证明解密/远端鉴权成功。
- 红绿证据：新增 API 第一轮 24 failed / 1 passed（验证原实现在托管配置错误时静默回退旧值）；实现后相关合集通过。
- `pnpm.cmd verify`：通过。根 lint、Desktop typecheck、shared/project-core、前端 106 files / 708 tests、API 1586 passed / 7 skipped（6 warnings）、API Ruff、daily 源码 sidecar 零 LLM 冒烟、OpenAPI 刷新零漂移。此轮收集后补充的修订 503 用例另在下面最终相关合集验证，不冒充已包含在该次全量计数内。
- `uv run pytest tests/test_llm_config_protected.py tests/test_llm_config_file_override.py tests/test_assistant_provider_health.py tests/test_agent_polishing_service.py tests/test_llm_provider_dispatch.py tests/test_judge_semantic.py tests/test_source_code_standards.py -q --tb=short`：最终 88 passed；新保护文件自身 27 passed。Ruff 对全部本次 Python 文件通过，新增三个 Python 文件 ruff format 完成。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-default-features`：最终 53 passed / 1 ignored（既有需显式提供真实项目的 shadow Git dogfood）。其中本任务 14 项：启动 env、首次空配置、迁移/重复迁移、单/双槽位、保护中途失败注入、替换文件失败、损坏密钥重新输入以及真实 Rust DPAPI→API .venv Python 解密/热换/清除互操作。
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：默认 feature 编译检查通过。原生测试环境：Microsoft Windows 11 家庭版 中文版，10.0.26200，64 位。
- `rustfmt --edition 2021 --check` 对 llm_config.rs、llm_config_store.rs（含 tests.rs）、secret_protection.rs 通过。全库 `cargo fmt ... -- --check` 未全绿：既有未修改的 fs.rs 存在格式差异；本次 main.rs 新增 mod 排序已修正，不顺手格式化 fs.rs。
- `git diff --check`、Trellis context validate 通过。OpenAPI 与 api-types 相对本任务门禁前工作树的 SHA-256 完全相同，保留用户原有契约清理，不把这些差异纳入本次提交。规范已更新（本地 gitignored Trellis），日志留在任务目录。
- 未验证/限制：未运行最终 PyInstaller/Tauri/NSIS 签名安装包及真实 GUI 迁移；未在另一 Windows 用户或另一机器实测；同用户恶意进程/内存取证/旧磁盘扇区擦除不属于 DPAPI 保护承诺。未知 schema/损坏 JSON 不自动重置，需显式修复；正常 v2 损坏密文可在设置逐槽位替换。此结果不等于发布就绪。
- 实施结束时尚未暂存/提交/推送；临时日志和用户已有无关文件均保留且排除。
- 提交授权：用户随后确认“现在提交”，只提交密钥保护清单和本条验证记录；不夹带先前改动，不推送。提交前复核 API 配置/provider-health 43 passed；Rust 密钥相关测试 14 passed（含原生 Rust/Python 互操作）。


### 2026-09-25 Desktop UI/UX 完整方案交付（R1–R7）

- 授权与范围：按用户“核心工作区重排”和“按照方案实施完再结束”推进父任务 `09-20-desktop-client-experience`。本任务产品变化仅 Desktop 及其验收工具；保留已有 API 清理、契约、License、其他任务报告和临时文件，不恢复 web/workflow、不改 API/DB/权限契约、不读取真实小说或调用付费模型。
- 工作区与导航：保留项目—正文—Agent骨架，将返回总览并入页签行，正文顶部112→76px；紧凑hero/章节窗口、双主题层级、低于1008 CSS px显示降级不覆写偏好；修正无项目欢迎页被历史chat状态隐藏与默认布局恢复。页签键盘/脏文件确认、异步关闭不抢新焦点、IME/输入焦点快捷键边界均有回归。
- Agent与审阅：单条可见可取消待发（第二次保留草稿，不隐式FIFO）、按阅读位置滚动、上下文去重且不隐藏缺失警告；专注diff/退出、隐藏与输入场景不误接受；跨scope事务目标捕获、同帧claim和完整写锁、真正await重试回执、迟到结果不清新补丁或作者输入。guarded writeback、漂移拒写、项目边界、写前快照与版本记录保留。
- 恢复与可访问性：文件读取失败不挂旧model且可真实重试；Settings按槽位/请求身份合并新输入、跨槽共享配置写锁、保留已有DPAPI元数据契约；Toast异步动作防重复、pending停超时、失败可重试。最后审计发现Monaco JS平滑滚动不受CSS限制，补齐create/updateOptions/媒体change/cleanup，不重建Editor/model；新增3项先红后绿。CSS降低动效规则是静态核查，媒体生命周期测试使用模拟事件，不冒充系统设置或屏幕阅读器人工验收。
- 最终 `pnpm.cmd verify`：**通过**。根ESLint/Prettier、Desktop TypeScript、shared/project-core、Desktop **111 files /790 tests**、API **1587 passed /7 skipped /6 warnings**、Ruff、daily源码sidecar、OpenAPI刷新零漂移。日志 `D:/StoryForge/.trellis/tasks/09-20-desktop-client-experience/evidence/verify-delivery.log`。此前787项版本两次通过记录作为历史保留，最终790已包含最后的动效修正。
- 最终 `npm.cmd --prefix apps/desktop run verify:tauri-smoke`：**通过**，本进程设置 `NODE_OPTIONS=--max-old-space-size=6144`。包含最终frontend生产构建和真实Tauri/WebView2执行；日志 `evidence/tauri-smoke-delivery.log`。真实可见导航、overview/workspace节点保留、125%/150%缩放及100%恢复、未确认/拒绝不写盘、dirty drift拒写、确认写回、写前shadow Git快照、版本及author-loop证据均通过。
- 原生几何：1400×900基线Editor708×798；125% CSS1120×720下Editor428×618、专注diff463.70px；150% CSS933×600下Editor625.33×498、专注diff383.83px。8个稳定快照均无文档横溢、按钮实际可达、patch/diff在Editor内、底部留白26px；恢复100%完整Editor矩形与基线一致。原始记录 `evidence/native-zoom-delivery-geometry.json`，不是CSS transform或浏览器等效尺寸冒充原生缩放。
- 原生工具回归：`node --test apps/desktop/scripts/verify-tauri-smoke.test.mjs apps/desktop/scripts/native-smoke-ui.test.mjs` **14 passed**；`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml smoke_ -- --nocapture` **6 passed**；本次Rust文件targeted rustfmt通过；`git diff --check`及Trellis上下文validate通过。Node几何/可见性夹具本身不算真实WebView证据，完整执行日志另存。
- 浏览器：真实App隔离夹具双主题×1024×768/1440×900/1920×1080，欢迎/总览/正文/审阅/设置无文档横溢；补819×614和683×512窄窗。真实Monaco键盘输入→脏状态→总览往返→Ctrl+Z、Agent草稿保留、读取失败→重试正确文件、设置焦点返回、骨架hero248px不跳动均留截图/DOM证据；完整映射见任务 `research/final-acceptance.md`。
- 失败与校准如实保留：默认Node4GB堆构建OOM后仅提高进程堆；Windows reqwest忽略ProxyOverride使loopback走代理502后，仅smoke子进程NO_PROXY合并绕过；旧原生导航断言与批准界面不符，改为真实可见入口但不删除安全断言；初次缩放探针放行过渡几何，新增先红后绿并加强稳定矩形后完整重跑，未放宽容差或改产品掩盖。
- 边界：**生产启动的Windows系统代理loopback兼容风险仍未修复**（本轮只修隔离harness）；默认构建堆容量、既有Monaco大chunk/import warning和未触碰fs.rs格式差异已记录。未验安装包签名/发布、全套系统菜单与目录选择器人工流程、多显示器DPI、屏幕阅读器、在线provider多轮或长篇文学质量；不得将本次受控原生链路等同全部真实用户GUI验收。
- 交付：Trellis父任务实施/验收完成但保留当前目录，不执行会自动提交的archive/add_session。代码**未暂存、提交或推送**。临时浏览器离开夹具并恢复viewport，自身Vite与原生临时服务已结束；截图、历史失败及最终成功日志保留，未清理用户无关文件。


### 2026-09-25 作品库补齐与 Agent 空态返工

- 用户验收纠正：启动先作品库；补明确新建/打开/最近作品与常驻返回入口。新建填写书名和本地目录，不要求提示词、不自动调用模型。删除用户截图中的四快捷项及空参考卡；仅按需上下文/真实警告保留。
- 往返保留Editor/Agent挂载、正文撤销、草稿和待确认patch；上次现场在显式选择后恢复。独立审查修复迟到恢复抢新建/回库、native chooser重选同根清页签两处blocker，新增真实App五项通过并复审关闭。
- 最终 `pnpm.cmd verify` **通过**：ESLint/Prettier、TypeScript、Shared/project-core、frontend **116 files /868 tests**、API **1587 passed /7 skipped /6 warnings**、Ruff、daily源码sidecar、OpenAPI零漂移。完整日志 `.trellis/tasks/09-25-desktop-project-home/evidence/verify-delivery-final.log`。
- 最终 `npm.cmd --prefix apps/desktop run verify:tauri-smoke` **通过**（本进程Node堆6144MB）：含production build、真实可见库入口与往返、pending patch、guarded writeback/拒绝/漂移/写前快照/版本、125%/150%与100%恢复。日志同目录 `tauri-smoke-delivery-final.log`，8几何/9导航原始证据 `native-delivery-final-evidence.json`。
- 新建切片75项、Agent定向91项、恢复/集成最终50项、Rust smoke6项/Node探针14项通过；这些为不同定向组合，不与868直接相加。完整浏览器双主题与683px最小窗口、真实Monaco撤销/未发送草稿验证见子任务 `research/browser-acceptance.md`。
- 中途App407行触发400硬门禁，未调阈值/删安全测试；分组surface接线至400行后重新完整门禁通过，历史失败保留。HMR后绘制观测经干净reload不能复现，不做推测性修复。
- 未验证：人工Windows目录选择器到实际新建全链；真实模型多轮/文学质量；签名安装包。既有生产loopback系统代理风险和大chunk警告不宣称已解决。没有覆盖用户API清理等无关改动，也无真实作品IO。
- Trellis child `09-25-desktop-project-home` 完成，父任务的旧完成记录已补用户返工说明。未暂存/提交/推送，不执行自动提交归档或journal脚本；临时浏览器与自有Vite已收尾。详细最终报告见子任务 `research/final-acceptance.md`。


### 2026-09-25 Agent 输入区整体重设计

- 用户同意整体改造截图中的输入区。仅两项产品组件：Composer 一体式框体、短提示、引用上移、32px 固定工具行和独立发送；PermissionProfileSelector 轻量入口、按 Composer 对齐菜单、完整键盘/IME/禁用保护。默认询问、四档业务权限、提交 owner、待发和项目持久化不变；form 新增空白/disabled 防护。
- 最终 `pnpm.cmd lint`、`npm.cmd --prefix apps/desktop/frontend run typecheck`、`npm.cmd --prefix apps/desktop/frontend run test`（**117 files / 899 tests**）、`npm.cmd --prefix apps/desktop/frontend run build` 全部通过；仅本进程设置 Node 堆 6144MB，原有大 chunk 警告未掩盖。日志 `.trellis/tasks/09-25-desktop-composer-refinement/evidence/`。`git diff --check` 与 Trellis context validate 通过。
- 权限新增预期先红后绿，定向27项通过；新增 Composer15项因并行产品已到位首次即通过，如实保留，不制造先红记录。全前端包含新旧回归，不把定向数量重复累加。
- 实际浏览器内存夹具：双主题1024×768/320px Agent栏、四引用+N、Shift+Enter、@剧情补全、权限方向键不改档位/Esc返回入口；菜单与发送按钮无横溢。683×512键盘/浮层几何也通过，但夹具控制条遮挡底部部分区域，不宣称所有鼠标命中已验。截图及完整步骤见任务 `research/final-acceptance.md`。
- 未验证：本次最终版本的全栈pnpm verify/API/native写回、真实OS输入法、在线模型和签名安装包；此前任务原生门禁是历史，不冒充本次执行。无真实作品IO，不改变API/契约或既有无关差异。
- Trellis子任务完成，规范补齐；浏览器离开夹具并恢复viewport，自有Vite已结束。未暂存、提交、推送或运行自动提交归档/journal。


### 2026-09-25 客户端整体去分割线

- 用户明确“整体”，本轮覆盖主壳、实际侧栏/Agent内容表面、作品库/总览/设置，去普通横竖边线与重复卡框；选中改圆角填充。表单、焦点、弹层、安全提示和diff边界保留，未全局透明border。调宽5px/ARIA/原owner保留，新增活动标记与focus/drag高亮；无业务/布局持久化/挂载/API/权限变化。
- 最终根 `pnpm.cmd lint`、frontend `typecheck`、`test`（**118 files / 905 tests**）、`build`均通过；当前进程Node堆6144MB，既有大chunk警告保留。`git diff --check`、Trellis validate通过。完整日志 `.trellis/tasks/09-25-desktop-borderless-surfaces/evidence/`。
- 新增4项静态表面契约、2项调宽行为回归；独立增量审查通过。before备份最初以tsx保存被lint扫描，改自有备份为txt后重跑全门禁通过，不豁免规则；原失败保留。
- 浏览器内存夹具：深浅色1280/1024主工作区、库/总览/设置、683compact与Agent切换；0px主壳边线、5px键盘调宽焦点/复位、1024下正文420/Agent320、全窗口无文档横溢、草稿往返保持。hero骨架与正式均248px且章节区top428.5不变。最终截图 `workspace-dark-delivery.png`；详细过程见任务 `research/final-acceptance.md`。
- 未验：当前最终版本全栈/API/native写回/原生拖窗、真实浏览器pointer拖拽（活动由组件测试覆盖）、在线provider/安装包。夹具503和手稿读取失败不等于产品在线数据成功；无真实作品IO。
- 临时Vite/浏览器已收尾，Trellis完成但保留目录；未暂存、提交、推送或自动提交归档。原有API清理/契约及其他dirty文件不恢复；本轮增量与before另存，不把历史diff冒充本轮。


### 2026-09-25 近黑配色与部分主分割线恢复

- 用户纠正上一轮去线过度且背景偏浅：深色画布/导航/浮层/选中改为#101012/#161618/#1d1d20/#29292d；文字/语义色不动，浅色token完整比对不变。仅恢复顶栏下沿、底栏上沿、侧栏右沿、Agent左沿的暗色1px低对比边界，不恢复小区域网格线。Monaco正文/gutter/滚动条同步，浅色主题对象不变。
- 最终根 `pnpm.cmd lint`、frontend `typecheck`、`test`（**119 files / 909 tests**）、`build`全部通过；进程Node堆6144MB，既有大chunk警告保留。`git diff --check`、Trellis validate通过；日志 `.trellis/tasks/09-25-desktop-borderless-surfaces/evidence/palette/`。
- 真实浏览器内存夹具：深色正文+diff两侧三实例均rgb(16,16,18)，四主边线1px rgba(52,52,57,.6)；切浅色三实例rgb(247,247,248)、主边线0px。1024窄窗正文420/Agent320、无横溢且草稿保留。最终预览 `workspace-dark-delivery.png`、计算值 `browser-probes.json`。拒绝了验收内存补丁，未接受/真实写回。
- 未重跑全栈/API/native/安装包，未调用真实模型。此前全去线方案已按用户校准修正规范，旧905项报告/截图仅作历史；本次审美仍待用户确认，测试不代替观感。
- Trellis已记录，产品6文件最小增量与before分存；浏览器/自有Vite已收尾。未暂存、提交、推送或自动提交归档，未恢复无关dirty文件。


---

## 2026-09-25 Desktop UI/UX 全维度审查与 P1 修复

### 背景

工作树沉淀�?119 个未提交改动�?9019/-6924 行，桌面�?UI/UX 大改），用户要求评估"UI/UX 是否还有优化空间"。本次采�?5 个并行只读审查代理（壳层导航/写作工作�?Agent 对话/作品库设置知�?视觉系统可访问性）+ 主代理交叉核验完成全维度审查，并顺手修复 2 �?P1 级缺陷�?
### 审查产出

5 份审查报告落�?`.codex/reviews/`�?- `shell-nav-ux-review-2026-08-07.md`（壳层与导航�?- `editor-workspace-ux-review-2026-08-07.md`（写作工作台�?- `visual-a11y-ux-review-2026-08-07.md`（视�?可访问性）
- Agent 对话和作品库设置知识的详报在子代理消息中（本会话已读取核实）

### 已修复的 P1 缺陷

**P1-1 消息列表性能死路**：`panels.tsx:272` 此前 `key={index}` �?MessageItem �?memo。Agent step 事件高频�?20/秒）时，整列表含每条 assistant 消息�?react-markdown 全量重渲染。修复：稳定 key（djb2 hash role+content�? React.memo；新�?`tests/message-list-memo.test.tsx`�? 测试）验�?DOM 节点 identity 保留�?
**P1-2 waiting 死路**：`useRunAuthorAgent.ts` 在两种情况下把前端置于无法逃出�?等待确认"状态：
- repair patch 缺少 approval_command（`repairProposal.command === null`）时，仍�?`requires_user_confirmation` �?waiting；前�?RunActionBar 的「接�?拒绝」依�?`approvalStep.patchId`，缺失时按钮静默无效，composer 被锁，作者只能切会话�?- 纯文本总结（无 proposed patch / repair / review / chapterBrief）若后端错误地置 requires_user_confirmation，同样死路�?
修复：仅在有真实批准路径时才允许 waiting——repair �?`command !== null`，fallback �?`responseChapterBrief`。新�?`tests/agent-waiting-dead-end.test.ts`�? 测试）�?
### 副产�?
- `useRunAuthorAgent.ts` 行数恰好压到 500（Desktop live-module 硬限）�?- `panels.tsx` 通过 memo 导入�?
### 验证

| 门禁 | 结果 |
|---|---|
| `pnpm verify` | exit 0�?1 步骤全过：根静�?桌面 typecheck/shared 契约/project-core/桌面单元 914 测试/API 1592 测试/ruff/sidecar daily 冒烟/OpenAPI 零漂移） |
| `npm --prefix apps/desktop/frontend run typecheck` | 0 �?|
| `npm --prefix apps/desktop/frontend run test` | 121 文件 914 测试全绿（新�?5 个：2 memo + 3 dead-end�?|
| API 源码规范测试 | 16 通过（useRunAuthorAgent.ts 恰好 500 行不�?Desktop live-module 硬限�?|
| `pnpm lint` | 0 �?0 �?|
| OpenAPI drift | 零漂�?|

测试基线从原 909 增至 914（净 +5）�?
### 剩余 P2（未动）

本次只修 P1。已识别但未修（详见审查报告）：
- 键盘契约：Ctrl+2 �?compact 失效但污染存储偏好、Ctrl+Shift+E/F/M/O �?library 态仍全局生效
- 布局死区：compact 断点 1008px �?Tauri minWidth 1024px 之间 16px 死区
- 可达性：knowledge 视图 title 英文/无快捷键/无命令面板条目；封面空态指向断路；"专用润色模型"分组无导航锚�?- 反馈：漂移拒�?可重�?误导；编辑器区无权限档位被动指示；Ctrl+W 无可发现入口；激活页签关闭按�?hover 反馈不可�?- 视觉/可访问性微调：浅色主题 editorLineNumber 3.04:1 不达 AA；text-warning/text-success 浅色文字色不�?AA；CommandPalette 列表�?listbox 语义

按主题分批小步修，每批独立可回滚�?
### 真机验证待办

- 1024×768 balanced 实际渲染（compact 死区是否真溢出）
- compact �?Windows 125%/150% 缩放体感
- 浅色主题卡片化整体观�?- 10 万字单文件写�?`normalizeEol(model.getValue())` 耗时
- 会话切换中阅读位置是否保�?