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
