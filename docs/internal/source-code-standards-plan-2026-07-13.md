# StoryForge 源码标准专窗计划（2026-07-13）

> 性质：规划文档，本文件本身不改代码。
> 触发：对照高标准开源源码（如 opencode 级）评估后，用户拍板做**专窗集中治理**。
> 范围拍板：**live 主链 + 历史双轨一并治理**。
> 验收拍板：**硬指标门禁**（非“感觉更干净”）。
> 节奏拍板：**专窗集中推进**；与 Phase B 写作 dogfood 错开，专窗内原则上不插新功能。
> Trellis 任务：`.trellis/tasks/07-13-source-code-standards/`

---

## 0. 一句话目标

把 StoryForge 从「有纪律的复杂工作台源码」推到「窄核心、硬边界、可被外人长期改」的源码标准：主路径可装进一次会话，跨面私有依赖归零，循环关键结果 typed，双轨只经 adapter，测试按行为面可演进。

## 1. 非目标

- 不做产品功能新增（发行 cockpit、新 agent 工具、UI 观感等另任务）。
- 不做大爆炸删域 / 重写 BookRun 质量语义（**定向删死码是允许且优先的**，见 §5.5；此处否的是一次性铲域重写）。
- 不宣称达到 opencode 社区运营面（license/CI/stars 另轨）。
- 不把「机械拆文件」当完成；完成以硬门禁为准。
- 不碰 `apps/web`。

## 2. 基线（2026-07-13 实测）

> S0 冻结分支：`refactor/source-code-standards-s0`，基点 `baf57933`。创建 worktree 时未提交 publish WIP 未带入本分支。
> 下表已在隔离 worktree 重测；机器基线见 `apps/api/tests/fixtures/source_code_standards_baseline.json`。

| 对象 | 行数（实测） | 门禁上限 | 问题 |
| --- | ---: | ---: | --- |
| `agent_runs/runtime.py` | 2677 | ≤400 | 主路径 god file + 大量 `_` 符号出口 |
| `agent_runs/tooling.py` | 1061 | ≤500 | ToolSpec 注册与实现同文件过重 |
| `agent_runs/service.py` | 964 | ≤500 | 生命周期 + 查询 + 桥接仍肥 |
| `agent_runs/loop_runtime.py` | 552 | ≤500 | **已越界**：需 S3 外移 prompt/history/budget 后缩回，非仅「防膨胀」 |
| `ChatWindow.tsx` | 1492 | ≤500 | 前端主交互 god component |
| `App.tsx` | 848 | ≤400 | shell 编排过重 |
| `book_runs/book_generation.py` | 947 | ≤500 | 历史双轨重文件 |
| `tests/test_agent_runs.py` | 2827 | ≤800 | 超大测试文件 |
| `tests/test_book_generation.py` | 1767 | ≤800 | 超大测试文件 |

`usePublishCockpit.ts`（984 行）**明确移出本专窗范围**：它是当前分支正在开发的发行 cockpit（Phase B 功能线），触碰即违反「一波一主题 / 专窗前隔离 WIP」。发行侧瘦身另任务，待 publish 合并后再评。

S0 全量扫描补出启动表遗漏的既有超限文件。它们一并进入「只减不增」基线；终态拆分归对应波次，不允许因启动表漏列而继续膨胀。

| 对象 | S0 冻结行数 | 后续归属 |
| --- | ---: | --- |
| `agent_runs/llm_context.py` | 601 | S3 loop context 外移 |
| `agent_runs/save_points.py` | 577 | S1/S3 主链归面时处理 |
| `book_runs/book_context.py` | 524 | S5 book_runs 边界治理 |
| `book_runs/book_generation_judge.py` | 722 | S5 book_runs 边界治理 |
| `book_runs/book_generation_parallel.py` | 601 | S5；已先删 13 行零引用 `_chapter_request` |
| `tests/test_agent_canon.py` | 1056 | S7 |
| `tests/test_agent_loop_runtime.py` | 1254 | S7 |
| `tests/test_book_runs.py` | 965 | S7 |
| `tests/test_ide_agent_orchestrator.py` | 1106 | S7 |

**封装泄漏基线（跨模块私有依赖，精确口径见 §3.2.2）**：

| 精确 AST 口径 | agent_runs | book_runs | 两域合计（治理目标） |
| --- | ---: | ---: | ---: |
| `from … import _name`（括号 import 逐符号） | 77 | 159 | 236 |
| 已解析导入模块的 `module._name` 属性访问 | 1 | 19 | 20 |
| **治理目标点位合计** | **78** | **178** | **256** |

> S0 纠错：启动前「≈66」把多行括号 import 按行而不是按符号计数，因此仍显著低估；更早的「~279」又把 snake_case 中段下划线误算。二者均作废。机器基线按消费文件 + 来源模块 + 私有符号 + 次数做 SHA-256 指纹，现存债务可减少，新增或重复点位立即报红。

已有资产可复用：W0–W7 结构收口、ToolSpec/`loop_schema` 单点、权限派生、LLM 单通道、DOMAINS live/backing/frozen、历史 `refactor-elegance-plan` / `refactor-master-plan` 手法。

## 3. 硬指标门禁（专窗 DoD）

### 3.1 体积门禁

| 文件 / 类 | 专窗后硬上限 | 备注 |
| --- | ---: | --- |
| `agent_runs/runtime.py` | ≤ 400 | 仅 facade + 编排入口 + 必要 re-export |
| `agent_runs/tooling.py` | ≤ 500 | registry/spec 面；handler 实现外移 |
| `agent_runs/service.py` | ≤ 500 | 生命周期 seam；编码/payload 保持外置 |
| `agent_runs/loop_runtime.py` | ≤ 500 | **当前 552 已越界**；S3 外移 prompt/history/budget 后缩回 |
| `ChatWindow.tsx` | ≤ 500 | hooks + 子组件；容器只编排 |
| `App.tsx` | ≤ 400 | shell 接线；业务 state 下沉 hooks |
| 任意新增 live 模块文件 | ≤ 500 | 例外需在 PR 写明理由 + 拆除计划 |
| 单测文件（live 相关） | ≤ 800 | 按行为面拆；共享 fixture 抽出 |

### 3.2 边界门禁

1. **公共模块面 6 个，禁止跨面 `_private` import**
   `loop` · `tools` · `fs` · `events` · `permission` · `patches`
   - 面内 `_` 允许；跨面只能 import 无下划线公共符号。
   - 护栏：静态测试扫描 `apps/api/app/domains/agent_runs`（及约定 backing 触点）失败即红。
2. **跨模块私有依赖清零（agent_runs 内先 0；book_runs 内同规则）**
   **精确口径（S0 掃描器实现依此，可测）**：统计两类点位——
   (a) 前导下划线 import：`from <module> import _name`（含相对 import；`_name` 首字符为下划线；多行括号 import 逐名计）；
   (b) 跨模块私有属性访问：`module._name`（排除 `self._` / `cls._`，并要求 `module` 可静态解析为仓库内导入模块；Python dunder 不计）。
   仅统计 **agent_runs + book_runs** live/backing 主链（S0 基线 256，见 §2）。专窗末目标：主链 **0**；面内 `_`、frozen 目录内部允许，但 frozen 私有符号不得被 live 新引用。
3. **双轨只经 adapter**
   - live 默认入口 = chat tool loop。
   - 固定 intent / BookRun managed path 只能经明确 adapter（命名 `*_adapter.py` 或已有 facade），**禁止** loop 与 fixed pipeline 互相直接吃对方私有 helper。
   - 新能力只进 ToolSpec + loop；fixed pipeline 不再长业务。
4. **typed seam**
   循环关键结果至少类型化：`ToolResult` / `LoopRoundResult` / `PatchProposal` / 终态事件 payload（Pydantic 或 frozen dataclass）。
   禁止在 loop 主路径新增裸 `dict[str, Any]` 业务字段读取；存量按波次收敛。
5. **行为门禁**
   每波：**零意图行为变更**（结构刀）或**仅契约/类型收紧且测试显式更新**。
   必跑：相关 pytest + 前端相关 vitest + `pnpm openapi`（若触契约）+ `ruff`。
   专窗结束：`pnpm verify` 绿。

### 3.3 文档 / 导航门禁

- `apps/api/app/domains/agent_runs/STRUCTURE.md`：主链读序 ≤ 8 文件。
- `apps/desktop/frontend/src/components/STRUCTURE.md`（或 shell 下）：Chat/App 拆分图。
- `DOMAINS.md` 增补「源码公共面与双轨 adapter 规则」指针。
- 本计划状态区每波回填。

## 4. 目标架构（专窗终态草图）

```text
Desktop shell (App thin)
  └─ Chat container (thin)
       ├─ hooks: session / stream / patch / permission
       └─ presentational children

API live surface
  assistant / agent_runs / ide / health

agent_runs public faces
  loop/        # loop_runtime + typed round/result
  tools/       # ToolSpec registry + handlers (no private cross-face)
  fs/          # path-scoped fs tools only
  events/      # encode/sink/types
  permission/  # confirm gates derived from spec
  patches/     # propose-patch artifacts only (never write disk)

adapters (explicit)
  intent_fixed_pipeline_adapter.py   # 旧按钮/intent 管线
  bookrun_managed_run_adapter.py     # BookRun 后台能力入口

backing (process-internal)
  book_runs / judge / retrieval / ...  # 仅经 adapter 或公共 service API

frozen
  models-only residual               # do-not-touch; no new live imports
```

## 5. 波次（专窗执行顺序）

原则：先护栏后搬家；先主链后历史；先 API 后 Desktop；测试跟随每波拆，不攒到最后。

| 波次 | 名称 | 产出 | 预估 |
| --- | --- | --- | --- |
| **S0** | 护栏与基线冻结 | import 扫描测试；行数基线表；STRUCTURE 草稿；「禁止跨面 `_`」规则入 trellis/spec 或测试 | 0.5–1 天 |
| **S1** | agent_runs 公共面切分 | 目录/命名落 6 面；runtime 退 facade；跨面 `_` import → 0（agent_runs） | 2–3 天 |
| **S2** | ToolSpec / handlers 瘦身 | tooling 只留 registry+schema 派生；handlers 按 domain 文件；加工具=1 spec + 1 handler 文件 | 1–2 天 |
| **S3** | loop typed seam | ToolResult/Loop 事件/补丁提案类型化；loop 主路径去裸 dict 业务读；外移 prompt/history/budget 使 `loop_runtime.py` 缩回 ≤500 | 1–2 天 |
| **S4** | 双轨 adapter 化 | fixed intent 与 BookRun 入口收敛为 adapter；禁 loop↔pipeline 私有互食；新能力只进 loop | 1–2 天 |
| **S5** | book_runs 边界治理 | 清 book_runs 内跨模块 `_`；generation 主文件 ≤500 或明确 facade+子模块；与 live 只经公共 API/adapter | 2–3 天 |
| **S6** | Desktop 主路径瘦身 | ChatWindow/App 达上限；stream/patch/session hooks；零行为 | 2–3 天 |
| **S7** | 测试矩阵模块化 | test_agent_runs / loop / canon / ide orchestrator / book_generation / book_runs 全部按行为面 ≤800 行；共享 fixture 抽出 | 2–3 天 |
| **S8** | frozen/导航收口 + 专窗验收 | frozen do-not-touch 护栏；读序文档；硬指标全绿；verification-report | 0.5–1 天 |

**专窗总预估：约 12–20 个工作日**（单人 + AI 辅助、每波可合并；含 S7 测试拆分上调后的合计）。
若专窗只能开 1 周：完成 **S0–S3 + S6 起点**，S4/S5/S7 列为专窗二期硬排期，不降级为“有空再做”。

## 5.5 删除轨（先删后搬，优先于整理）

> 立场：**这仓库最响的 slop 信号不是大文件，是坟场**——冻结死域、双轨平行实现、SSE 换代后残留的 WS 命名壳、workflow/api 双存 prompt。给一个不用的东西做 typed seam / 拆文件，是**给 slop 描边**。因此每个搬家目标动手前先问一句「能不能删」；能删的先删，删掉的代码不必再整理，S1–S7 的搬运面随之缩小。
>
> 纪律不变：**定向删除，不做大爆炸**。每次删除独立提交、连带删测、可单独 revert；有存量数据 / 契约 / 装机链依赖的一律不删，降级到 T3 记录。

| 层 | 对象 | 处置 | 依据 / 阻塞 |
| --- | --- | --- | --- |
| **T2 小迁移后删** | SSE 换代后的 `websocket_*` 命名壳 | S0 已审：先引入 transport-neutral 公共名，再迁 SSE/REST/golden 调用方并删旧名 | `websocket_stream_events_from_agent_event` 被 live SSE pump 调用；`websocket_control_event` 被 REST control 调用；不是死码 |
| **T1 已删** | 其它 grep/AST 确认零 live import 的 legacy helper | S0 删除 `book_generation_parallel._chapter_request` 与无用 `NovelLoopRequest` 绑定 | 全仓唯一命中为定义；无 decorator/注册/反射/测试依赖；并发生成定向测试兜底 |
| **T2 小迁移后删** | 专窗自产的 facade re-export | 调用方迁完后，保留一个合并周期即删 | §6.3；不留长期兼容壳 |
| **T3 卡产品决定** | `apps/workflow` 物理删 + 第 7 LLM 客户端 + workflow/api prompt 双存 | **本专窗不删**，只记阻塞与解锁条件 | 阻塞：`book_generation_parallel.py` 用 `importlib` 按路径加载 workflow 跑 managed 生成，受质量轨红线保护。解锁：D1 翻案或 n=1 稳定后 |
| **T3 卡产品决定** | frozen models-only 7 域（assets / collaboration / commercial / evaluations / jobs / prompt_packs / series / workspaces + books.lineage） | **本专窗不删表**，只加「frozen 不被 live 新引用」护栏 | 阻塞：`models.py` 经 `create_all` 建表，删表需 alembic drop 迁移 + 确认无存量数据；物理删表另任务 |

**明确不是删除目标（防误伤）**：`ide/orchestrator.py` 仍被 `runtime.py:92` import，是 **S1 吸收进 6 面 / adapter** 的对象，不是死码。凡「仍有 live import」的一律走搬运轨，不进删除轨。

删除轨落点：T1 在 **S0（审计）→ S1（随公共面切分执行）**；T2 facade 在各波「第二波删 facade」；T3 只在本计划记录并在 §9 状态板留行，不占专窗工期。

## 6. 每波统一手法（强制）

0. **删 > 搬 > 改**：动任何搬家目标前先问「能不能删」（见 §5.5）。能删的先删，删掉的不必再整理；只有确有 live 依赖才进搬运轨。
1. **先审计后动刀**：目标文件函数清单 + 调用方（至少 3 处相似模式）。
2. **纯移动优先**：签名与对外 re-export 保持，旧路径可 facade 一波。
3. **第二波再删 facade**（可选）：仅当无外部/测试依赖或已改完调用方。
4. **一波一主题**：禁止顺手改发行/新工具/产品文案。
5. **验证最小集 → 相关全量**：改 agent_runs 先跑定向 pytest，合并前补相关面。
6. **回填**：`.codex/verification-report.md` + 本计划状态表。

## 7. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 平行实现再现（历史两次学费） | 只允许 adapter，不允许第三套 runtime |
| 大文件搬家引入隐性行为差 | 零逻辑改动提交；行为改必须独立 PR/波次 |
| 测试拆分导致覆盖空洞 | 先搬测再删旧文件；覆盖清单对照 |
| 与未提交工作树冲突 | 专窗前清/隔离 publish 等 WIP；不碰无关脏文件 |
| 专窗中途被功能插入 | 默认拒绝；阻断级 bug 可插，插完回到当前波次 |

回滚：每波独立可 revert；facade re-export 保留至少一个合并周期。

## 8. 与既有计划关系

- **取代关系**：本计划是「源码标准专窗」执行入口；不取代 `current-phase.md` 产品阶段事实。
- **继承**：`refactor-elegance-plan` / `refactor-master-plan` 的小步零行为手法；W6 ToolSpec/权限成果。
- **不重开**：已完成合理边界的纯拆分（见 refactor-master-plan 完成表）不再机械重拆。
- **质量轨 / BookRun 语义重评**：仍等 n=1 稳定后；本专窗只做边界与可读性，不改生成质量策略。

## 9. 状态板

| 波次 | 状态 | 证据 |
| --- | --- | --- |
| S0 护栏 | 已完成（2026-07-13） | AST 私有依赖 256 点精确冻结；18 个超限文件只减不增；`test_source_code_standards.py`；`agent_runs/STRUCTURE.md` 8 文件读序 |
| S1 公共面 | 已完成（2026-07-14） | 六公共面可 import；`runtime.py` 265 行；agent_runs 私有跨模块依赖 78→0；旧 37 方法 + 33 helper AST 等价；142 项定向测试通过 |
| S2 tooling | 已完成（2026-07-14） | `tooling.py` 1061→59 行兼容 facade；22 条 spec 按域拆分且顺序/字段 AST 等价；handler 映射归领域文件；221 项相关测试通过 |
| S3 typed seam | 已完成（2026-07-14） | `LoopRoundResult`/`LoopToolCall`/`LoopToolFeedback`、generic `ToolResult`、`PatchProposal`、typed terminal payload；loop 主函数裸业务 `.get()`=0；`loop_runtime.py` 329、`llm_context.py` 461、`save_points.py` 125 行；267 项测试通过 |
| S4 双轨 adapter | 已完成（2026-07-14） | fixed pipeline 三组 mixin 移出 loop；typed intent dispatcher；BookRun 四命令经 managed adapter；静态 import 护栏；271 项相关测试通过 |
| S5 book_runs | 已完成（2026-07-14） | 私有跨模块依赖 178→0；live assistant/agent_runs/ide 只经 `book_generation`/`service`/`models` 公共模块；`book_generation.py` 485、judge 488、parallel 464、context facade 25 行；223 项相关测试通过 |
| S6 Desktop | 已完成（2026-07-14） | `ChatWindow.tsx` 1492→72、`App.tsx` 848→176；session/run/control/submission 与 tabs/project/preferences 分责；Desktop `STRUCTURE.md` 8 文件读序；206 项 Vitest、严格定向 tsc、ESLint、13 项源码门禁通过；全量 typecheck 仅受隔离分支缺失的 publish Phase2 类型改动阻断 |
| S7 测试拆分 | 未开始 | |
| S8 验收 | 未开始 | |
| 删除轨 T1（WS 遗留 + legacy helper） | 已审计 | WS 编码器为 SSE/REST live 依赖，转 T2；零引用 `_chapter_request` 已删 |
| 删除轨 T3（workflow / frozen 表，记录不删） | 记录在案 | 阻塞见 §5.5；解锁待 D1/n=1 |

## 10. 专窗启动清单

1. [x] 用户确认本计划（可改上限数字，不可改「硬指标」原则除非重拍板）。
2. [x] `task.py start` 激活 `.trellis/tasks/07-13-source-code-standards`。
3. [x] 创建专窗 worktree 时未带入 publish WIP；使用 `.worktrees/source-code-standards-s0` + `refactor/source-code-standards-s0`。
4. [x] S0 import 护栏、行数基线、STRUCTURE 草稿与 T1 审计完成；验证见 `.codex/verification-report.md`。

---

## 附录 A · 建议公共符号（S1 方向，实施时可微调）

- `loop`: `run_tool_loop`, `LoopConfig`, `LoopRoundResult`
- `tools`: `AgentRuntimeToolSpec`, `get_tool`, `build_loop_tool_schemas`, `execute_tool`
- `fs`: `resolve_project_file`, `list/read/search` 公共入口
- `events`: `encode_*`, `record_*`, event type constants
- `permission`: `derive_requires_confirmation`, `confirming_tool_names`, gate decide
- `patches`: `build_proposed_patch_artifact`, patch guard helpers

凡今日被跨文件 import 的 `_foo`，要么提升为公共名，要么留在面内并改调用方走公共 API。

## 附录 B · 相关路径

- 任务：`.trellis/tasks/07-13-source-code-standards/`
- 域分档：`apps/api/app/domains/DOMAINS.md`
- 历史重构：`docs/internal/refactor-master-plan.md`
- 架构蓝图：`docs/internal/arch-review-blueprint-2026-07-03.md`
- 验证回填：`.codex/verification-report.md`
