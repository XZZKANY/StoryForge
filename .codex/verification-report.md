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
