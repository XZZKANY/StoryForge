# StoryForge × opencode v2 对标差距分析

- 日期:2026-09-30
- 基线:StoryForge `master @ df109344`;opencode `v2.0.19 @ a565ea8`(2026-09-29,源码克隆于 `.cache/opencode-v2`,不入库)
- 方法:五路只读源码调研(StoryForge 两路、opencode 三路),覆盖 Agent 运行时与工具系统、整体架构、产品功能矩阵、工程与分发四个维度
- 口径提醒:opencode v2 自身处于功能回退窗口——LSP 已实质移除、`doom_loop` 只剩 v1 兼容配置键、session share 走自家云端。对标时不要把 "v1 有" 当成 "v2 现状"。

## 一页结论

StoryForge 在**写回安全与契约纪律**上不低于 opencode,部分更严:写前快照失败即阻断落盘、整文漂移拒写、项目边界双保险(后端 `scoped_target` + Rust canonicalize)、证据提交失败拒绝交付模型结果、OpenAPI/Agent 帧双契约 + drift 门禁。这套「guarded writeback + evidence」链路是 StoryForge 的差异化资产,opencode 的权限系统没有这个强度。

真正的差距集中在五处:

1. **Agent 体系是"单 agent"**——无真 subagent 运行时(8 个目录角色里 4 个无可执行定义,review "子代理"只是并行 LLM 调用)、无运行时 agent 切换、无委托工具;opencode 的 subagent 是有独立上下文、可后台、完成回流父会话的真实子 session。
2. **权限粒度粗**——opencode 是 `action × resource glob` 规则 + `allow/deny/ask` + 批准三态(once/always/reject,always 项目级持久化、reject 可带反馈回模型);StoryForge 只有「项目 × 四档 × 风险级」,批准二元,且档位存 localStorage,换机即失效。
3. **无 token 级流式**——opencode 100ms 批量 delta 事件流;StoryForge 的回答在 loop 结束后整段交付,长文场景体感差距明显。
4. **外部工具扩展是空壳**——MCP 只有静态 DTO 声明,无 client、无配置面、无 dispatch;opencode 是全套 MCP(local/remote/OAuth/运行时管理 API)。
5. **工程分发近乎空白**——无 CI、无自动更新、版本 tag 与 `tauri.conf.json` 已脱节(v0.1.5 vs 0.1.10)、发布手动;opencode 是矩阵构建 + 签名公证 + 多渠道全自动发布。

---

## A. Agent 运行时与工具系统

| 维度 | opencode v2 | StoryForge | 判定 |
|---|---|---|---|
| 多 agent | `build`/`plan` 两个 primary + `general`/`explore` subagent + hidden(title/compaction/summary);用户可用 markdown frontmatter 自定义;shift+tab 切换,plan 模式 = 权限规则组合(deny edit + 放行 `~/.opencode/plan`) | `role_catalog` 9 角色,字段齐(aliases/read_only/allowed_tools/default_permission_profile),但只读暴露 REST;无切换、无 markdown 自定义 | **差距大,但有地基** |
| Subagent | `subagent` 工具创建 `parentID` 链接的真实子 session:独立上下文、独立工具集(权限规则过滤)、支持 `model` 覆盖、`background` 异步、完成后 synthetic 消息回流父会话、嵌套深度默认 1 | `SubagentExecutor` 是「role→进程内 handler + 白名单校验」分派器,不 spawn LLM agent;4 个 review 角色实为同一 prompt 的并行 LLM 调用;synthesizer/context_explorer/external_scout/bookrun_agent 无 executor definition | **差距大** |
| 工具系统 | `Tool.Info` input/output 双 schema;内置/插件/MCP 三源统一经 `State.Transformable` 重放注册,后注册覆盖先注册、dispose 回显;命名空间压平;shell 输出落盘只回尾部 | ToolSpec frozen dataclass 字段面更细(risk_level/execution_mode/artifact_kinds/evidence_fields/loop_schema),`requires_confirmation` 由风险+执行模式单点派生;29 spec、22 个对 LLM 可见;派生链 spec→catalog→loop_schema→SDK registry→handler 齐整且 golden 可测 | **运行结构对齐;差距在扩展机制(只能改代码)** |
| 权限 | `Rule{action, resource, effect}` + 后写优先 + glob 匹配;来源叠加 agent/session/项目已存规则/插件钩子;ask → 挂起 Deferred,客户端回 `once/always/reject`,always 落盘项目级、reject 级联同会话挂起请求并可带反馈转 ToolFailure 让模型改正 | `read/ask/auto/full` 四档 × 风险级映射,`PermissionPolicy` 单点事实源,`requires_confirmation` 唯一出口字段;批准二元(approve/deny);**写回守卫显著更硬**:快照失败阻断、漂移拒写、边界双保险、receipt 审计 | **各有胜负:授权粒度 opencode 胜,写回守卫 StoryForge 胜** |
| 流式 | 100ms 批量 delta 事件,token 级 | SSE 帧是 step/trace/artifact 级,回答整段交付;token 流只在 `/api/assistant/continue` 旁路存在 | **差距中** |
| 会话韧性 | 事件溯源 + projector 读模型;inbox 与执行分离;fork/revert/share/move;execution claim 崩溃恢复;steer(运行中追加输入) | `AgentRunEvent` 持久化 + 唯一索引并发护栏 + save points + checkpoint/pending_call 双锚点 + 守卫式状态转移 + 启动 reap 僵尸 run | **差距中**(fork/steer 缺失) |
| 上下文压缩 | auto(buffer 触发)/overflow(0.7/0.5/0.35 逐级缩减)/manual 三档 + provider 原生压缩选路;结构化 SUMMARY_TEMPLATE | `compaction_job` 隐藏 job,发布前校验来源漂移否则标 `source_drift` 不发布 | **接近**,StoryForge 的漂移校验是特色 |
| 模型接入 | 几十个 provider 插件 + models.dev 能力目录(cost/limit/modalities/variants)+ 模型自查工具 + variant 思考档切换 | 三族(openai 兼容/anthropic/gemini)+ 配置链 env→settings→json 槽位 + 润色专用槽 + token/人民币成本估算 + provider 健康诊断 | **宽度差距**;深度(成本、证据)StoryForge 有自己的东西 |
| 停止/限幅 | `agent.steps` 上限触发 toolChoice:none + 注入提示(保缓存前缀);工具输出限幅落盘 | 8 轮/32 调用/60k 字符预算 + 900s deadline + 单次对话单补丁规则 + 边界中断检查 + 模型不支持 tools 时静默回落单轮 | **对齐**,思路一致 |

## B. 整体架构

| 维度 | opencode v2 | StoryForge | 判定 |
|---|---|---|---|
| 进程拓扑 | server 独立进程(default/service/stdio 三模式),CLI/TUI/Electron desktop/PWA 浏览器多前端全走同一 HTTP API + SSE;支持 SSH/WSL 远端 server;managed background service 自动发现与版本不匹配替换 | Tauri 主进程拉起 PyInstaller 冻结 FastAPI sidecar,ServiceManager 管生命周期 + 孤儿 sidecar 清理; React 前端唯一客户端 | **定位不同**:StoryForge 单机桌面场景当前架构够用;opencode 的「一后端多客户端 + 远端」是结构性优势,桌面单机不是必须追 |
| 契约与 SDK | Effect HttpApi 一处定义 → openapi.json → 自研 codegen 出 promise/effect/solid 三味 client,生成物入库 + CI drift 门禁;公开 npm SDK(`@opencode/client`/`@opencode/sdk`,进程内跑同一 router) | FastAPI → openapi.json → openapi-typescript 前端消费 + drift 门禁;Agent 帧同理 ws_messages → schema → 生成 TS | **契约纪律对齐**;StoryForge 当前无对外 SDK 需求,不算差距 |
| 事件一致性 | SSE 刻意 volatile(慢消费者即断),一致性放在持久事件 + projector 读模型 | SSE + DB 持久事件 + 断线 REST 重放 + 前端轮询兜底 | **对齐** |
| 侧边能力 | 文件 watcher、formatter、worktree、persist PTY、CDP 浏览器面板 | 影子 Git 版本树(内置 mingit)、写回回执、`.storyforge/versions` 元数据 | 各有侧重 |

## C. 产品功能矩阵

| 功能 | opencode v2 | StoryForge | 备注 |
|---|---|---|---|
| MCP | ✅ local/remote/OAuth + 运行时管理 API + CLI/TUI 状态面 | ❌ 仅静态 DTO 声明,无 client/server/配置 | **最大功能缺口** |
| 用户自定义 agent | ✅ markdown frontmatter + json 配置 | ❌ role_catalog 代码内置 | 衔接 role_catalog 现成字段 |
| 自定义命令 | ✅ | ❌ | |
| Skills | ✅ skill 体系 + API | ⚠️ `skill_catalog` 内置只读计划模板,用户不可扩展 | |
| 只读审查/计划模式 | ✅ plan agent(权限规则实现) | ⚠️ role_catalog 有 `read_only` 字段且禁绑写工具,但无运行时切换入口 | **低成本高价值** |
| webfetch/websearch | ✅ | ❌ `external_scout` 角色预留名但无实现 | 创作域有真实需求(资料查证) |
| 图片输入 | ✅ read 工具读图/PDF | ❌ | 角色设定/参考图场景可用 |
| loop 内结构化提问 | ✅ `question` 工具 | ❌ | 修订意图澄清很有用 |
| undo/版本回退 | ✅ 内容寻址 snapshot + 会话 revert 两阶段 | ✅ 写前快照 + 版本记录 + 撤销 toast + 影子 Git | **对齐**,StoryForge 版本记录更贴作者心智 |
| 会话 fork/steer | ✅ | ❌ | 中优先 |
| todo 工具 | ❌(v2 显式删除) | ❌ | 都不用抄 |
| LSP | ❌(v2 移除) | ❌ | 小说域无对应物,可对标「文风/语法检查服务」远期故事 |
| VSCode/ACP 集成 | ✅ | ❌ | StoryForge 自己就是 IDE,不适用 |
| GitHub Action | ✅ | ❌ | 不适用(非代码协作产品) |
| 后台长任务 | ✅ 后台 subagent + persistent shell | ✅ Writing Run 后台 managed + SSE + 暂停/恢复/checkpoint | **对齐**(BookRun 对话不可达是刻意降级) |

## D. 工程与分发

| 维度 | opencode v2 | StoryForge | 判定 |
|---|---|---|---|
| CI | 全套 GitHub Actions:test 双矩阵 + turbo --affected、check(oxlint+typecheck)、生成物 diff 门禁、Playwright e2e、构件验证、桌面签名 | **无 CI**(2026-06-30 移除);门禁全在本地 `pnpm verify` + pre-push hook | **P0 差距** |
| 发布 | 分支触发 preview + 手动正式版;CLI 16 个二进制 target、desktop 6 target;mac 签名公证 + Windows Azure Trusted Signing;npm/Homebrew/AUR/Docker/VSCode 多渠道;Discord 公告 | 本机手动构建 NSIS;`docs/operations/release-checklist.md` 人工清单;git tag 落后于 `tauri.conf.json` | **差距大**,正式对外前必须补 |
| 自动更新 | electron-updater + 自家 update 服务(版本事实源) | 仅前端比 GitHub tags 提示,无下载替换 | P1 |
| 崩溃/遥测 | desktop Sentry(CI 注入 DSN)+ Cloudflare 数据管道 + PostHog | 仅 API 侧 `sentry_dsn` 配置位,桌面端零崩溃收集 | P1(灰度时需要) |
| 文档 | Astro 站约 55 页 + OpenAPI 参考自动生成 + `llms.txt`;README 24 语言 | 仓库内 markdown(README + docs/ 三个子目录),无文档站 | 视开源节奏,P2 |
| 社区基建 | issue/PR 模板、CONTRIBUTING、SECURITY、CODEOWNERS、triage/查重/评审全部 dogfood 自动化 | 仅 `docs/agents/` 两份流程文档 | 视开源节奏,P2 |
| 产品 i18n | app/desktop 63 locale typed 字典(含 RTL、原生菜单) | 纯中文硬编码 | **产品决策**:面向中文作者可不动 |
| 依赖治理 | `patches/` 18 个 bun patch + catalog 集中版本 + action pin SHA | pnpm + uv,无补丁机制 | 小规模暂不需要 |

---

## 优先级路线图(建议)

### P0 — Agent 内核体验(产品主线)

1. **真 subagent 运行时**:子 AgentRun 独立上下文 + 权限过滤的工具集 + 完成回流父会话。复用现有 `AgentRunEvent`/`SubagentRun` 表与权限体系,切入点现成:先把 4 个 review 角色从"并行 LLM 调用"升级成真子 run,再点亮 synthesizer/context_explorer。
2. **Agent 模式切换(对标 plan)**:用 `role_catalog` 已有的 `read_only` + `default_permission_profile` 实现「只读审稿 ↔ 可执行修订」运行时切换;前端快捷键 + 切换时注入 system reminder(opencode 的 plan 就是规则组合 + reminder,不是硬模式)。
3. **权限三态批准**:approve/deny 之外增加 `always`(项目级持久化规则——注意不可写入项目目录随 git 传播,存 API DB 或 app-local 存储,沿用现档位不写入 `.storyforge/` 的决策)与「reject 带反馈回模型」。保留现有更硬的写回守卫不动。
4. **Token 级增量流**:在 `ws_messages.py` 帧契约里补 delta 帧,loop 侧按 100ms 批量泵出,前端增量渲染。长文审稿/修订的体感差距主要在这里。

### P1 — 平台能力

5. **MCP client 落地**:先兑现已声明的 `mcp.project.search`/`mcp.context.inspect`,再加配置面与外部 server 接入。
6. **用户自定义 agent / 命令**:项目级 `.storyforge/agents/*.md`(frontmatter = 现有 Agent 字段子集)衔接 `role_catalog` `/roles` REST;命令走同类发现机制。
7. **webfetch/websearch 工具**:点亮 `external_scout`,作者查证资料的真实场景。
8. **question 工具**:loop 内结构化澄清(修订目标/尺度/保留项),对齐已有 SSE 帧契约加一个交互帧。
9. **恢复 CI**:GitHub Actions 最小集 = lint + typecheck + pytest + openapi drift + sidecar smoke,先守门再谈矩阵。

### P2 — 工程与分发(随发布节奏)

10. 自动更新:`tauri-plugin-updater` + GitHub Releases(不要学 opencode 自建 update 服务,小团队运维负担)。
11. 版本一致性门禁:tag ↔ `tauri.conf.json` 校验脚本进 verify(当前 v0.1.5 tag vs 0.1.10 已脱节)。
12. Desktop 崩溃上报:把 Sentry 从配置位接到真链路。
13. Windows/mac 签名:正式对外发版前(Azure Trusted Signing 路径可抄)。
14. 文档站 + 社区基建:决定对外开源/公测时再做;到时候可把 triage/翻译自动化 dogfood 自己。

### 不对标清单(明确不抄)

- **Effect 栈/事件溯源整体重写**:异构 Python+TS 技术栈不搬范式;现有 `AgentRunEvent` 重放够用,增量补 fork/steer 即可。
- **CodeMode(工具藏进代码执行)**:StoryForge 对 LLM 可见工具仅 22 个,无 token 压力;对非代码域模型风险高。
- **TUI/CLI、Electron、多前端**:桌面 IDE 单前端是选型,不是差距。
- **自建 update 服务/CDN 分发**:运维负担不成比例。
- **V2_HTTP_API_AUDIT 的做法值得学**(对自家 OpenAPI 做一次端点级 Keep/Change/Remove 审计台账),不是其中的结论。
- opencode v2 的回退项(doom_loop、LSP、本地 share)不要当成"它也有"去追。

### 可直接借鉴的工程巧思

- **生成物入库 + CI drift 校验**:StoryForge 已有同等纪律,保持。
- **`specs/v2/` 架构决策记录**:5 篇 spec 管协议/会话/工具层决策,StoryForge 的 `docs/architecture/` 可以参考这个粒度沉淀。
- **OPENCODE 式 API 审计台账**:契约是硬 seam,值得对 `storyforge.openapi.json` 做一次同类审计并固化进 docs。
- **turbo --affected 影响面跑测**:StoryForge 测试规模增长后可用对应思路(当前 verify 已分层,尚不急)。
