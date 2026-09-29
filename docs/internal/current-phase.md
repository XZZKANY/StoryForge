# StoryForge 当前阶段事实源

更新时间：2026-09-28（本地未提交工作树集成，非发版声明）

## 事实源职责矩阵

| 文件 | 职责 |
| --- | --- |
| `docs/internal/current-phase.md` | 当前阶段唯一事实源：能力、证据、未验收边界。 |
| `docs/internal/TODO.md` | 当前下一步执行入口，不复制历史流水账。 |
| `docs/internal/PROJECT_SUMMARY.md` | 项目总览和验证状态摘要。 |
| `README.md` | 面向使用者的入口摘要。 |
| `docs/internal/dev-plan.md` | 历史计划和阶段 DoD，不证明最新状态。 |

逐次验证命令和结果见 [验证报告](../../.codex/verification-report.md)。7 月及以前经过见 [阶段历史](current-phase-history-2026-07-26.md)。

## 当前阶段

StoryForge 是面向长篇小说作者的 Desktop IDE-first AI writing workbench，产品方向为 Cursor for Fiction。`apps/desktop` 是唯一主体验；`apps/api` 负责运行时、业务判断及证据；manuscript truth 是本地项目文件。`apps/web` 已退场，`apps/workflow` 已于 2026-07-26 退役，不恢复旧入口。

当前已完成本轮作者辅助 IDE 的持续演进基础计划及本地分档验收。修订能力、输入选择、工具策略、结算一致性、provider 诊断和性能反馈已增量落地；这不等于“发布就绪”，后续仍按真实使用反馈小步迭代。保留既定写作优先方向，以真实写作摩擦决定功能需求。本轮没有读取仓库外连载资产，不把 7 月章节数当作当前写作进度。

## 已实现的能力与证据

| 能力 | 当前代码依据 | 证据边界 |
| --- | --- | --- |
| 项目全文搜索 | `apps/desktop/frontend/src/App.tsx` 接入 `useProjectSearch` | 已接入；本轮未重做 GUI 验收。 |
| 工作区现场恢复 | `App.tsx` 接入 `useSessionRestore` | 已接入项目、页签与光标恢复；不代表所有面板状态均持久化。 |
| 对话式 Agent | `agent_runs/loop_runtime.py`、`loop/sdk_adapters.py`、`app/platform/ai_sdk` | 自由文本工具循环，ToolSpec 派生能力；固定 intent 仍是独立入口。 |
| 写章及受控润色 | `agent_runs/intent.py` 包含 `chapter.write`、`chapter.polish` | 已实现，不等于小说质量通过。 |
| 结构化拆书 | `useProjectCommands.ts`、`ide/book_breakdown.py` | Desktop 调用已接入；报告加载按项目归属，切换/关闭项目和旧响应回流回归通过。 |
| 文件边界与资源限制 | `agent_runs/fs_safety.py`、`fs_tools.py`、`fs/project_knowledge.py` | 修复已提交为 `fd7a7fa6`；定向测试及冻结 exe 实际搜索通过，Linux 已补齐普通符号链接验证，Windows junction 通过。 |
| BookRun 历史兼容 | `tools/catalog.py` 已移除 `bookrun.*` 注册，`intent.py` 已移除 `bookrun.start` | 后台兼容仍存在，不再列为桌面 Agent 可启动的当前能力。 |

默认 `ask` 档逐次确认；`auto` / `full` 只免点击，不免除 guarded writeback、漂移拒写、项目边界、写前快照与版本记录。后端仅产出 proposed patch，不直接修改手稿。一次对话的单补丁限制仍存在。

不再在活文档手写工具、intent 或视图总数；实际清单以注册代码和派生 schema 为准。

## 持续演进基础（2026-09-27）

职责、live/backing/frozen 路径与按变更选测试的入口见 [写作能力反馈地图](../architecture/authoring-feedback.md)。不以 SDK 发布、目录拆分或整后端重写为目标。

- 修订能力从会话副作用中分离；保留 facade/四入口和现有协议，独立比较生成策略不写会话。项目知识采集与纯选择/快照分开，固定输入可重放。
- 同类工具可信上下文与 trace 策略从 ToolSpec 派生，消除中央重名名单；角色和权限约束保留。
- Agent 结算状态与对应持久事件共同提交、故障回滚、重复重试；回调在提交后。停止/暂停抑制迟到 patch，保留 Brief 恢复；不是 exactly-once、强杀 provider 或任意重启恢复承诺。
- Provider 有限协议与诊断一致；实际凭据在截断/序列化前脱敏。没有更换 SDK 或新建 provider runtime。
- 共享有界阶段测量、固定输入/代码版本/失败样本/成本可用性报告，第二条真实受控润色复用同一链。120 条离线基础样本及两轮各 96 条资源对照，不是实际模型文学质量。
- 文风基线从全文件读取改为每候选 200KB；大后缀夹具读量约减少 97.6%、Python 分配峰值约减少 87.8%，精确 prompt/patch 等价。小章瞬时分配增加，整体 Agent 耗时无稳定改善；不宣传为整体提速。
- 用户授权的前端集成只提取导航回调并恢复生成 WS 契约，保留并行样式、快捷键、总览等工作；所有切片尚未提交/发布。

## 当前验证状态

### Agent 可靠性切片 R1–R8（2026-09-28，本地集成完成）

完整范围为 `.codex/agent-reliability-plan.md`，在既有 Python SDK / Desktop 写回边界上补可靠性，不替换 runtime。当前是 HEAD `e6ca61733d8b63ec0fb15fcba4ee67150a7d1140` 加本轮与用户已有未提交改动；本次实现及规定的本地集成验收已完成，未提交、未发布。

- 同 run 传输恢复和全提交入口未知态守卫、失败/截断结算、raw disk 条件写、shared deadline/阶段取消、来源与作者决策保真的压缩、隐藏本地请求证据、有限持久恢复和原生写回回执均有对应行为回归。
- 最终审计补充：非2xx响应头立即封闭恢复资格；错误正文独立2秒/64KiB累计解析预算，挂起、读取失败或取消失败不启动GET或伪报unknown。真实401/422两项RED后，21项专项与174项相关回归通过；最终总门禁和Desktop重建/隔离GUI已重跑。API源码未变，复用同hash的当前构建。
- 新增收口：Knowledge 先 inspect 再按需读原始磁盘基线；applied/unreadable 可补审计但不谎称已核对，unknown 不重放；工具策略漂移通过公开恢复入口拒绝且零派发；自动档步骤明确“准备完成”，不是落盘回执。
- 原生重复提案的旧失败是 opacity 动画首帧 hidden-target。仅修验收 readiness，复用真实点击的可见/禁用/视口/hit-test，轮询不点击，真正点击一次；未削弱产品守卫或原断言。

| 验证项 | 当前结果 | 证据边界 |
| --- | --- | --- |
| `pnpm.cmd verify` | 全部通过，exit 0 | `r8-verify-final4.log`；含根 lint/format、FE typecheck、Shared、project-core、API Ruff、daily sidecar 与契约生成/drift。 |
| API 全量 pytest | **2349 passed / 7 skipped** | 6 条既有 warning（2 条弃用、4 条测试 JWT 短密钥警告）；跳过 4 项 Windows 原生 symlink、1 项真实 LLM、2 项真实 MinIO，不能视为通过。 |
| Desktop frontend | **149 files / 1231 passed** | 包含未知请求 public submission、Knowledge 恢复及真实步骤映射/mounted 展示回归。 |
| project-core / E2E / Desktop runner | **7 / 20 / 30 passed** | E2E 为契约；runner 单测不代表实际安装器验收。 |
| Rust | **82 passed / 1 ignored** | ignored 是需指定真实用户项目的 dogfood，不启用也不当作通过。 |
| API / Desktop 当前构建 | **API 同源构建已核对 / Desktop 新重建通过** | 离线已有依赖，PyInstaller + Tauri release `--no-bundle`；未安装新包。 |
| packaged sidecar | **通过，ready 4660ms** | 当前冻结 API；会话、SSE/control、Alembic、bundled prompt；零 LLM/零外网。 |
| 两条 browser smoke | **通过** | 固定 synthetic API/FS，仅证明当前包的 UI 接线，不替代真实模型链路。 |
| 两次全新隔离 native GUI | **均通过** | 保留拒绝、漂移拒写、确认写盘、快照/版本及导航/缩放；真实落盘后丢回执每次 write dispatch=1，重复同一提案 dispatch=0，disk/buffer 全文和版本/审计计数独立核对。 |
| 契约 | **四份生成物无新漂移** | OpenAPI、Agent 帧 schema、API types 与 Agent 帧 TS 均与冻结前哈希相同，不抹掉已有未提交合同改动。 |
| 真实 provider / 全权限 GUI / 安装器 / PostgreSQL / 长篇质量 | **本轮未验证** | 不借用历史结果；也不承诺全任务金额硬限、强杀同步 I/O 或副作用 exactly-once。 |

证据根 `.codex/agent-reliability/`；完整范围审计与最终源码/产物/日志绑定见 `r8-completion-audit.md`、`r8-artifact-binding-current.json`，详情见 `.codex/verification-report.md`。1105 个源码/测试/配置文件的冻结 hash 为 `ba88809dd1b25658a7aa0dc955635c960e417a90493bdb0ef3649ebcb5ab6c5c`；API exe SHA-256 为 `3cc6cef5d7b90480dad65f243386e7fb9ee6bdf25c57531173bd2e090339f2b1`，Desktop exe 为 `d185b6cf316829ae131825bd39b07fec9df00aa12b3fe45723d64d442485ac5e`。构建前后已核对无源码漂移。

原生 runner 使用显式新构建 exe 和全新临时项目/SQLite/config/local-data/WebView/端口，未停止既有 3007 服务；输出 installed 标签不是安装器通过。R6 请求证据专项使用实际请求构造链和 HTTP 出口替身；R7 startup 是持久连接重开/恢复入口，不冒充 kill-sidecar 全时序验收。历史 RED、中断与修复前失败日志全部保留。

### 历史基础集成（2026-09-27，非本轮 R1–R8 结果）

2026-09-27 本地未提交工作树，HEAD `e6ca61733d8b63ec0fb15fcba4ee67150a7d1140` + 本轮及用户已有改动。**本轮持续演进基础总计划已完成本地实现与验收：核心门禁、浏览器场景和隔离原生 GUI fixture 均通过。** 日志在 `.trellis/tasks/09-27-foundation-final-integration/research/`，逐项结论见验证报告。

| 验证项 | 本轮结果 | 证据边界 |
| --- | --- | --- |
| `pnpm.cmd verify` | 全部通过 | 使用已有 pnpm 9.15.4 缓存；未 install/重建 node_modules。第一次被研究备份误纳 lint、第二次导航接线格式失败，均修复后完整重跑。 |
| API 全量 pytest | **1852 passed / 7 skipped** | SQLite/离线 provider/故障注入；不是本轮在线 PostgreSQL 或付费模型。 |
| Desktop frontend | **136 files / 1038 passed** | lint、typecheck 通过；含 12 项新导航行为回归，App 最终 384 行。 |
| project-core / Shared / Ruff | **7 passed / 类型通过 / 全量通过** | 根总门禁实际执行。 |
| E2E 契约 | **20 passed** | 原 3 项强制已退役 IDE 读路由的测试失败；核对现行 router/既有 pruning 护栏后，校准为退役路由禁止回流 + Agent 事件/产物回放 + 命令审计合同，不恢复旧 HTTP 面。 |
| OpenAPI / Agent 帧生成物 | **四份均与 HEAD 相同、重复生成无漂移** | Desktop WS 原差异仅引号/union 格式，按授权恢复生成结果。 |
| daily / packaged sidecar | **通过 / 重建后通过**，ready 3157ms / 4179ms | 会话往返、确定性失败 SSE、control、Alembic managed 与 bundled prompt；零 LLM，不是成功生成或 GUI 写回。 |
| Rust / bundled Git / native runner 单测 | **56 passed / 1 ignored**；Git **7 passed**；runner **18 passed** | Git 包校验通过；runner 单测不是实际 NSIS 安装/卸载验收。 |
| 当前 release 构建 | **重建通过** | PyInstaller + Tauri release `--no-bundle`；产物哈希已记录，非已安装/发布版本。 |
| 两个 headless browser smoke | **通过** | 只校准当前作品库→总览→工作台路径、真实可见控件与合成响应；保留节点复用、SSE 请求/正文/固定上下文/事件驱动步骤断言。固定 synthetic API、禁读 env、未知请求账本+网络拦截；失败负对照已通过。不是实际后端响应/模型质量证据。 |
| 重建 release 原生 GUI fixture | **两次全新隔离运行通过** | 只把漂移观测从已退役 toast 移到可见 patch-action-status；保留实际拒绝不写盘、漂移拒写、确认写盘、写前快照及版本/author-loop 证据。导航/缩放可达性亦通过；使用合成补丁，不覆盖全部权限档位或真实模型→GUI 全链。 |
| 真实 provider / 长篇人工质量 / 最新远端 CI | **本轮未验证** | 不继承历史通过结论。 |

原生 runner 因已有未知归属的 3007 服务而使用显式新构建 exe 入口，未占用/停止该服务；该入口输出的 installed 标签不代表验证了安装器。冻结 API 和 Desktop exe 的 SHA-256 分别为 `4aa8af6a8e4b9a44a3e148a129163a9189b4e68c6cbb14f819f0bea1517c5484`、`c631e7d49a0ec601b3a91a965edc547fa5db71d1545323fc1c701ad8de15a154`。

### 历史本地门禁（2026-09-05，非本轮结果）

以下来自 2026-09-05 的本地实跑，不代表远端 CI 或已发布安装包。总门禁运行时包含未提交修复，随后本轮代码按确认分批提交；其他原有未提交工作仍保留。`pnpm.cmd verify` 全部通过；Linux 补验使用 `5eea3765` 的已提交源码及冻结依赖，文件工具定向和 packaged 验证保留同日上一项任务的结果。

| 验证项 | 结果 | 边界 |
| --- | --- | --- |
| API 全量 pytest | 1581 passed / 7 skipped | 已修复 13 项既有失败；包含新增的 4 项当前文档事实源测试。 |
| Desktop frontend | 90 files / 582 passed | lint、类型检查通过；包含 3 项新增拆书报告状态回归。 |
| project-core / Shared | 7 passed / 契约类型检查通过 | 已纳入本地核心总门禁。 |
| 文件工具定向与源码门禁 | 63 passed / 3 skipped | 普通符号链接创建受权限限制；Windows junction 真链接通过。 |
| Linux 文件工具补验 | 56 passed / 1 skipped | 无网络容器运行原有 6 份测试；三个文件边界符号链接用例及 Project Knowledge 越界链接用例均通过，仅跳过 Windows junction。 |
| 共享扫描调用方 | 244 passed / 1 skipped | 一致性、canon、知识、拆书等集合。 |
| 工具失败反馈与跨章 | 16 passed | 预算错误反馈模型；章序遍历失败不被吞掉。 |
| API 全量 Ruff | 通过 | `uv run ruff check .`。 |
| OpenAPI 漂移 | 无漂移 | 文件工具修复没有改变 API 契约。 |
| 冻结 sidecar | 重建及 packaged smoke 通过 | 实际 exe 经本地模拟 provider 完成普通搜索并拒绝高回溯正则；非真实 LLM 或 GUI 验收。 |
| `pnpm.cmd verify` | 通过 | 本地核心门禁全部通过，含 daily sidecar 冒烟与 OpenAPI 刷新及漂移检查。 |
| 当前 GUI / 真实 LLM / 远端 CI | 本轮未验证 | 不继承旧版本通过结论。 |

## 历史质量与 GUI 证据

- 真实 LLM 1/3/10 章 smoke 有历史记录，10 章 smoke 已通过人工通读；一次 30 章真实长程运行链路可达并导出制品，但人工通读退回重跑。证据：`.codex/real-llm-30ch-mimo25pro-20260611-192356`。
- 30 章曾出现测试痕迹残留、模板化、称谓混乱和 17/18 章时间线冲突；recap 膨胀、reasoning token 泄漏等工程修复不能证明质量问题消失。Q9 16 章历史通过也不替代新长程验收。
- 历史记录报告 2026-07-07 G.1、2026-07-12 A6/A7 的真实 Tauri 桌面端到端及“安全可日更”验收通过。该历史场景本轮未重跑；当前隔离 fixture GUI 的新结果也不能扩展为全部权限档位和真实模型链路验收完成。
- 远端 E2E run `26944063055` 仅为历史证据，本轮没有查询最新远端状态。

## 仍未完成的验收项

1. Windows 原生符号链接仍受用户权限限制；通用链接规则已在 Linux 实际验证，Windows junction 已通过。拟发布版本可在具备权限的 Windows 环境补跑原生符号链接；resolve 校验不是抵抗恶意本地并发路径替换的 OS 沙箱。
2. 当前 release 的隔离 GUI fixture 已验保存、拒绝、漂移拒写、diff 确认和快照；拟发布版本仍需补全权限档位、真实模型交互及安装器验收，不能由该合成场景外推。
3. 文风基线共享语料枚举仍缺逐文件 resolved containment/链接拒绝及目录遍历预算；本轮只修有界 read，不可借用其他 fs 工具的边界测试称已解决，应单列安全切片。
4. 用固定写作任务比较时间、改稿保留率、返工和人工偏好。质量实验室 PRD 的 benchmark 和晋级门槛仍需收敛；没有新的真实长程质量通过结论。

## 禁止宣称范围

- 不能宣称真实 3-5 万字长程质量验收通过。
- 不能宣称稳定生产级长篇生产闭环。
- 不能把自动审计、golden gate 或模型自评等同于人工通读通过。
- 不能把历史 GUI 通过、单 provider headless 证据或本地模拟 provider 探针当作当前全部真机写回链路已验收。
- 不能把本地未提交修复描述成已经合并或已经发布。
