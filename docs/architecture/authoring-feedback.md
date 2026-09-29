# 写作能力的阶段测量与回归入口

本页描述持续迭代的反馈接缝，不代表发布、真实模型质量或桌面写回已经验收。当前产品主链仍是 Desktop → Agent SSE → 对话工具循环 → proposed patch；显式 intent 是另一适配入口，后端不写原稿。

## 真实路径与职责地图

当前分档以 `apps/api/app/domains/DOMAINS.md` 为准，不把目录存在等同于产品可达。下表 API 域路径相对 `apps/api/app/domains/`。

| 路径 / 分档 | 所有者与调用链 | 改动边界 |
| --- | --- | --- |
| 自由对话 / live | Desktop Chat → `ide` SSE → `agent_runs/service.py` / `runtime.py` → `loop_runtime.py` chat adapter → `loop/sdk_adapters.py` / `app/platform/ai_sdk` → 已有工具能力 | `role_catalog` 是 metadata/工具权限，不是独立 LLM 子代理；不新建第二套 runtime |
| 显式 intent / live | `adapters/intent_fixed_pipeline_adapter.py` → 现有 plan/tool 执行路径 | 按钮/显式流程和自由对话有不同 adapter，但复用工具、业务能力和状态/证据 |
| 单文件修订 / live capability | `assistant/revision.py` 值输入、注入生成器；`assistant/service.py` 会话 facade；HTTP、chat、intent/工具调用 | 替换生成/质量规则不重写权限或传输；独立能力无 Session/Message 写入 |
| 受控润色 / live capability | `agent_runs/patches/polishing_service.py` → parser/gate/线上或本地候选 → proposed patch | 第二真实功能复用测量/验证，不复制普通修订流程；降级仍强制确认 |
| 项目知识 / live | `fs` 受控采集 → `knowledge_context.py` / `fs/knowledge_retrieval.py` 纯选择 → `llm_context.py` 快照 | 同一已采集输入可以重放；空输入不偷偷再读盘；新采集仍需版本/权限/文件边界 |
| 工具能力 / live | `tooling.py` ToolSpec → registry/ToolDefinition → schema/可信输入与 trace 策略 | 同类工具优先声明策略；有新语义则明确扩展 seam，不承诺所有功能只改一处 |
| 运行控制与证据 / live | `service_store.py` 状态 + `event_sink.py` / `events` 持久事件，control/resume/permission adapter | 终态与可重建事件原子结算；callback 在提交后；SSE 断流不等于停止，SQLite 故障/重试测试不证明 exactly-once 或全部 PostgreSQL 并发 |
| Provider / shared backing | `common/llm_client.py` 唯一模型 HTTP 出口；`common/llm_protocol.py`；`assistant/provider_health.py` | 原配置/adapter 保留；诊断读取一次有效配置、脱敏后输出；真实付费模型单独验收 |
| 协议与交付 / live seam | OpenAPI → shared types；`agent_runs/ws_schema.py` → Agent 帧 JSON/schema/TS；Desktop diff → guarded writeback | API 只产 proposed patch；四份生成物、golden、冻结 exe 和真实 WebView 各自验证；禁止手写镜像 |
| 后台重引擎 / backing | managed BookRun 与 judge/retrieval/memory 等被进程内调用的公共服务 | BookRun 不再是 Agent 主产品入口，保留兼容和模型；不要用其 prompt 修改来推断 chat 已变化 |
| 历史域 / frozen | `DOMAINS.md` 指定的 models-only 与卸载 router | 不复活 web/workflow，不凭无 HTTP 路由就删除仍被建表/ORM 引用的模型 |

Desktop 仍拥有本地项目、编辑器导航、权限确认与写回。`useEditorNavigation` 只组合展示/打开/定位；打开 Promise 未完成时仍即时发定位事件，Editor 等模型就绪后消费，不在 UI 发明业务判断。

## 改哪里、看什么

| 变化 | 业务所有者 / 稳定接缝 | 最小验证入口（`apps/api/tests/`） |
| --- | --- | --- |
| 普通修订策略、提示词、标点与可选质量门禁 | `assistant/revision.py` 的值输入 + 注入生成器；`assistant/service.py` 保留会话与证据时序 | `test_revision_capability.py`、`test_assistant_revision_lifecycle.py`、`test_revision_callers.py` |
| 润色在线/本地候选选择 | `agent_runs/patches/polishing_service.py`；不能硬塞进普通 revise | `test_agent_polishing_service.py`、`test_agent_polishing.py`、`test_agent_polishing_tool.py`、`test_agent_polish_end_to_end.py` |
| 上下文采集与固定输入选择 | `knowledge_context.py` / `fs/knowledge_retrieval.py` 的采集、纯选择；`llm_context.py` 的 from-collected 入口 | `test_context_selection.py`、`test_agent_llm_context.py`、`test_agent_loop_writing_context.py` 及 filesystem 边界 |
| 工具可信输入 / trace 策略 | 现有 `ToolSpec` → `ToolDefinition` → chat adapter | `test_loop_tool_policy.py`、loop schema/golden、权限测试 |
| 状态与终态证据 | `agent_runs/service_store.py`、控制/事件 adapter；复用事件 writer 的事务 | `test_agent_settlement_atomicity.py`、resume/cancellation/save-point/WS golden |
| Provider 诊断或协议 | `common/llm_client.py` 唯一传输出口，`llm_protocol.py` 有限协议，`assistant/provider_health.py` 安全诊断 | `test_provider_diagnostics_safety.py`、原 health/provider 测试 |
| 性能记录 / 两条能力接线 | `common/performance.py`、`performance_logging.py`、`ide/stream_measurement.py` | `test_performance_measurement.py`、`test_authoring_measurement.py`、`test_agent_measurement_transport.py`、`test_authoring_experiment.py` |

表中是快速选择，不替代全量 API、Ruff、源码架构护栏与合同门禁。改路由/DTO 后仍运行 OpenAPI 生成，并解释漂移；存在用户未提交的生成文件时先核对差异。

## 观测与业务分离

- `RunMeasurement` 只记录固定阶段、span/parent、相对起点、耗时和有限状态。没有正文、prompt、项目路径、provider 配置或异常消息槽位。
- `measurement_scope` 绑定 ContextVar；`measured` 只修饰同步操作，生成器/async 生命周期显式包围。无 scope 的独立能力不产生日志。
- 默认一次记录至多 128 个 span，实验可指定有上限的容量；溢出计 `dropped_observations`。时钟无效记 null，不把缺失时间伪造为零。
- 业务异常照常传播；时钟/sink 故障隔离。`rejected` / `degraded` / `noop` 是策略结果，不等于异常；未执行的在线模型可标 `skipped`。
- `store.*` 是现有持久化操作整体耗时，包含序列重试/commit 等，不是纯 SQL 时间。没有扩张事务、把模型等待放进事务或改变 C1 提交顺序。
- 父子阶段会重叠，**不能把所有 duration 相加**。模型阶段包含对应现有 provider 调用的耗时，不修改原有 `latency_ms`、usage 或 cost 业务字段。
- `run_key` 是服务取得实际 public ID 后的 SHA-256；不记录客户端可自选 ID 原文。`run_status` 仅使用已有 ORM 内存值；缺失为 null，观测不得触发 refresh/SQL，也不是独立读库证明。

## SSE 时间的准确含义

同一 measurement ID 下有独立的 `worker_finished` 与 `transport_finished` 快照；两者不保证固定先后，包含 `pending_spans`。worker 的观测收尾不依赖消费者/队列仍存在，transport 结束也不封闭 recorder。

`sse.queue_wait`、`sse.first_yield`、`sse.first_readable_yield`、`sse.end` 均是**服务端**边界。第一帧通常是 started，而非回答；readable 标记只观察现有结果/补丁帧。它们不等于 ASGI send 完成、客户端到达或网络 TTFT。

断流不是 stop_run。没有为观测新增 shield、自动停止、线程强杀或修改原 `await worker` 行为。ASGI 2.3 取消消费者后同步线程仍可继续；ASGI 2.4 发送错误也不保证 generator 立刻关闭，不能推导一定有即时 transport 快照。

## 可重跑的共同实验

在仓库根目录运行：

```powershell
uv run --no-sync --project apps/api python scripts/measure-authoring.py --samples 5 --warmup 1 --lines 10 100 --output .trellis/tasks/<task>/research/baseline.json
```

需要现有 API 开发依赖；不安装新包。fixture 来自 `apps/api/tests/authoring_measurement_support.py`，包含独立能力和真实 in-process SSE chat → SDK tool → 能力 → 权限/证据。模型替身只注入生成/provider 边界；原处理、门禁、编排和持久化保持真实。主应用启动/middleware、真实网络、真实模型、GUI 不在该实验范围。

报告记录：代码 commit/dirty/source hash、Python/平台、fixture 版本/hash/规模、规则/快照/门禁版本、全部样本、结果类别、质量原因码计数、计时阶段、模型次数和可测 SQL/commit 次数。

- 暖机不混入样本；失败/降级/拒绝/noop 不丢弃，成功分布与全体分布分开。
- 本地模型替身成本是 `not_applicable`，不是免费真实调用；未测成本/用量/计数为 null/unavailable，不补 0。内存能力无 DB 计数器，也不假装采到了零 SQL。
- 原文不写回由实际文件对照验证；没有 patch 的预期失败不算验收失败。意外实验错误保留固定错误码并令正确性检查失败，不泄漏异常文本。
- 不与全量测试/构建同时运行正式基准；相同代码版本、输入规模、模式、机器条件下才做单变量比较。保留原始样本，不只给中位数。

## 第二能力与中断交付回归

`test_agent_polish_end_to_end.py` 通过主 FastAPI 应用的真实 SSE、chat/intent、ToolSpec/SDK、受控润色 parser/gate、权限与事件/补丁 artifact REST 重放验证第二能力；只替换 provider 出口，使用临时小说与文件 SQLite/WAL/独立物理连接。

覆盖 protected Markdown 不进可编辑 segments、可信实体/人物/时间线/记忆/章节目标进入实际模型请求、实体漂移 gate、伪造模型参数不可替代上下文；accepted/noop/双拒绝、provider/JSON/截断降级、read/ask/auto/full。auto/full 的降级仍需确认，后端不写原稿。

中断有两层，不能只做其中一个：
- `events/runtime_support.runtime_interrupted_response` 撤销顶层 proposed_patch 和未提交 `_tool_artifacts`；保留只读报告、Brief/恢复信息及内部路由标记。
- runtime 消费内部 `_events_recorded` / `_runtime_interrupted` 后，必须在返回外部前 `pop_runtime_internal_markers`。fixed after_plan 和 after_tool 两个早返也适用。

Chapter Brief 的正常等待确认同样调用该 helper，随后恢复 requires_user_confirmation；不能清空 agent_result 或提前删除内部标记。仅在 SSE JSON 编码器丢弃对象会掩盖缺陷，control resume 的 resumed_result 仍可能泄漏。

生成途中独立连接 stop/pause，以及公开 on_event 工具 trace 提交后 stop/pause，均要求：原稿不变、状态保持、没有迟到补丁/artifact/permission/completed，响应没有内部对象。已有工具 trace/usage 可以保留；停止交付不等于取消已经进行的 provider HTTP 请求，也不承诺消除了所有时间窗口的竞态。

单项实测资源优化见下方 S3；本地门禁、packaged 与 GUI 的当前分档结果见 [当前阶段](../internal/current-phase.md)。本页不是发布或长篇质量验收记录。

## 文风基线：可回归的读量预算（S3）

`common/style_baseline.py` 负责本地文风采样，经过 `author_voice.build_generation_system_prompt` 到普通修订/续写/新稿；独立受控 chapter.polish 不走此链。既有相对路径排序后十个候选、短章过滤、UTF-8 replace、换行与strip、置信区间及作者指令优先级不变。

- 每候选raw read最多200,000字节，最多10候选；语料读取上界2,000,000字节，不含目录枚举与其他项目文件读取。
- 历史 `MAX_TOTAL_BYTES=800000` 实际限制处理后的字符数，不能按名字改为字节。ASCII/中文同字节规模的入选章数不同；超额那章先读再丢弃，不补取较早章节。
- 不缓存，编辑后立即重算。截断UTF-8保留U+FFFD；不要用另一种decoder偷偷改变prompt。
- 快回归：`test_style_read_bounds.py`、`test_style_baseline_reach.py`、`test_manuscript_chapter_ordinals.py`；行为预算是读取请求/返回字节、入选章节与精确prompt，不在CI写不可靠的机器耗时阈值。

可重跑离线对照：

```powershell
uv run --no-sync --project apps/api python scripts/measure-style-read.py --baseline-source <saved-style-baseline.py> --samples 5 --warmup 1 --output <report.json>
```

不传baseline-source时测当前实现；传入参数会执行该**本地可信Python快照**，不要使用未知下载代码。runner复用S0阶段helper和已有loop/provider替身，全部临时合成数据，真实Agent facade→SDK→修订→权限/SQLite；不声称SSE或GUI证据。对照保留首次/暖机/全部成功失败、代码和fixture hash、完整prompt/patch hash、应用层读量、Python分配、各阶段耗时、SQL/commit/模型次数和成本可用性。读量/分配探针不混入耗时取样。

2026-09-27实测：3份8MiB后缀夹具，语料read 25,165,824→600,000字节，Python分配峰值中位8,872,341→1,083,863字节；96条记录结果/prompt一致。正常小章瞬时分配41,175→221,612字节，不能说每个场景都省内存；Agent总耗时没有稳定改善，不能把局部阶段改善宣传为整体提速。原始报告与before源码在 `.trellis/tasks/09-27-style-read-bounds/research/`，保留秒级长尾。

已知独立缺口：该语料枚举没有逐文件resolved containment/链接拒绝和目录遍历预算。有限read不等于项目链接边界安全；不要把其他fs工具的测试算作它已验收。它们需要独立安全行为变更，不能混在本次语义等价优化里。
