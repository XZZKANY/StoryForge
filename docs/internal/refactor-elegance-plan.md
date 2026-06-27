# StoryForge 架构优雅化整改计划

> 生成时间：2026-06-27
> 定位：把底层架构与技术实现「全方位打磨更优雅」拆成**可独立小步执行、零行为变更、带证据链**的整改条目。
> 上位约束见 `AGENTS.md`；模块健康现状见 `module-isolation-scorecard.md`；本文件是优雅化整改的专项 backlog。

## 0. 执行原则（每一条都必须遵守）

1. **小步推进**：一次只落一个明确条目，禁止顺手重构无关代码。
2. **零行为变更优先**：结构拆分类条目必须保持纯文件级移动，逻辑、签名、对外契约不变。
3. **证据链**：每条改动跑相关门禁（ruff / pytest / typecheck / 对应单测），结果回填 `.codex/verification-report.md`。
4. **不碰 web**：`apps/web` 已退场，任何条目都不新增其代码、脚本或测试。
5. **行尾纪律**：仓库以 LF 为主，编辑时保持目标文件原有行尾，避免 CRLF↔LF 噪声污染 diff。
6. **先审计后动刀**：标注「需先做范围审计」的大文件，先产出函数清单与依赖图，再决定切分边界。

## 1. 已完成

| # | 条目 | 证据 |
|---|------|------|
| ✅ | 从 `agent_runs/runtime.py` 抽出 `revise_scope.py` + `_text.py`（revise 范围/指令解析纯函数） | PR #19，runtime.py 1696→1412 行，60+16 测试通过，ruff 全绿 |
| ✅ | A 区全部（A3/A1/A2/A4）：`bookrun_summary.py` / `intent.py` / `review_report.py`+`trace.py` / `tooling.py` 从 runtime 外移，runtime 退为 facade + tool 注册 | PR #23，runtime.py 1412→约 920 行，59 测试通过，ruff 全绿，零行为变更 |
| ✅ | E1：legacy `ide/orchestrator.py` 边界审计（审计型，零代码改动） | `docs/internal/e1-ide-orchestrator-boundary.md`；import smoke + 59 测试佐证；结论：跨边界 live 符号仅 `AgentOrchestrationError` + `orchestrate_agent_message` 两个 |

## 2. 分级 backlog

优先级排序口径：**价值/风险**比 + 是否已有测试护栏 + 工时（S<2h / M 半天-1天 / L 多天）。

### A. `agent_runs/runtime.py` 继续解耦（当前 1412 行，仍是 live Agent 路径上最大的单文件）

延续 PR #19 的同款手法，把剩余的内聚函数簇逐个外移，目标把 runtime.py 收敛为「Runtime facade + tool 注册」骨架。

| # | 条目 | 证据（file:line） | 工时 | 风险 |
|---|------|------|------|------|
| A1 | 抽出 **意图识别**簇 → `agent_runs/intent.py`：`_detect_intent` / `_is_*_request` / `_message_text` / `_message_args` / `_role_hints` / `_role_mentions` / `_resolve_role_mention` | runtime.py:1061-1150 | S-M | 低（纯函数，`test_ide_agent_orchestrator` 已覆盖 `_detect_intent` 同族逻辑） |
| A2 | 抽出 **多视角审稿报告构建**簇 → `agent_runs/review_report.py`：`_build_multi_agent_review_report_with_executor` / `_review_subagent_handler` / `_continuity_subagent_handler` / `_review_report_mode` / `_agent_finding` / `_subagent_output_summary` / `_review_report_summary` / `_agent_issue_count` / `_degraded_review_agents` | runtime.py:887-1014, 1201-1328 | M | 中（与 SubagentExecutor 协作，需确认 import 边界不成环） |
| A3 | 抽出 **bookrun 预检摘要**簇 → `agent_runs/bookrun_summary.py`：`_bookrun_chapter_plan_summary` / `_bookrun_budget_summary` / `_bookrun_budget_details` / `_bookrun_risk_summary` | runtime.py:1330-1359 | S | 低（自包含，仅 `_run_bookrun_generation` 调用） |
| A4 | 把 tool/permission 脚手架（`ToolDefinition` / `ToolResult` / `ToolRegistry` / `PermissionGate` / `SubagentExecutor`）下沉到 `agent_runs/tooling.py` | runtime.py:95-205 | M | 中（dataclass + 协议，注意被 service/测试引用的符号要保持可 import） |

> 顺序建议：A3 → A1 → A2 → A4（按风险递增、护栏递减）。

### B. API 其他 god-file（需先做范围审计）

这些是后端真相源里最大的单文件，**不可凭体积盲切**，每个先产出函数清单 + 调用图，再按职责切分。

| # | 文件 | 规模 | 先做什么 | 工时 |
|---|------|------|----------|------|
| B1 | `book_runs/book_generation.py` | 76KB / 65 defs / 4 类 | 范围审计：把 preflight / judge 循环 / 导出 / 预算这些子职责分到独立模块 | L |
| B2 | `book_runs/service.py` | 44KB | 审计 router-service-生成器三层边界，抽出可复用的查询/装配 | M-L |
| B3 | `judge/service.py` | 38KB | 审计评审规则与 LLM 调用边界拆分 | M |
| B4 | `story_memory/service.py` | 32KB | 审计记忆注入/检索职责拆分 | M |
| B5 | `studio/service.py` | 29KB | 审计编排步骤拆分 | M |

### C. Desktop 前端巨型组件（主产品，需先做范围审计）

| # | 文件 | 规模 | 先做什么 | 工时 |
|---|------|------|----------|------|
| C1 | `components/ChatWindow.tsx` | 2263 行 / 86 处 hook&组件 | 审计后抽 custom hooks（消息流、WS 事件、审稿/修订状态机）+ 拆子组件（消息列表、工具轨迹、patch 面板挂载） | L |
| C2 | `App.tsx` | 51KB | 抽出布局/路由与全局状态 provider，瘦身根组件 | M-L |
| C3 | `components/Editor.tsx` | 42KB | 抽出 Monaco 配置、版本/快照逻辑为 hook | M |
| C4 | `lib/api-client.ts` | 20KB | 审计 API 调用是否集中、错误模型是否统一 | M |

### D. Workflow 编排内核（需先做范围审计）

| # | 条目 | 证据 | 工时 |
|---|------|------|------|
| D1 | 审计 `orchestrators/book_loop.py`(30KB) 与 `novel_loop.py`(10KB) 职责是否重叠、可否合并公共调度 | apps/workflow/storyforge_workflow/orchestrators/ | M |
| D2 | 审计 `runtime/checkpoints.py`(26KB) + `provider_adapter.py`(24KB) 的降级/预算逻辑是否分散重复 | apps/workflow/storyforge_workflow/runtime/ | M |

### E. legacy `ide/orchestrator.py` 收口（53KB）

**重要纠偏**：该文件**不是死代码**，仍被 live `runtime.py` 引用（`orchestrate_agent_message` / `AgentOrchestrationError` / `_detect_intent` / `SUPPORTED_INTENTS`），直接删除会破坏构建。

| # | 条目 | 证据 | 工时 | 风险 |
|---|------|------|------|------|
| ✅ E1 | 画出 `ide/orchestrator.py` 内部「live 被引用」vs「仅 `legacy.orchestrator` 兜底分支可达」的边界 | 已完成 → `docs/internal/e1-ide-orchestrator-boundary.md`（2026-06-27） | M | 中 |
| E2 | 基于 E1，把仍被 live 引用的少量符号迁到稳定位置，再逐步收缩 legacy 分支；最终评估 `legacy.orchestrator` 工具能否下线 | 见 E1 边界图 §6 落点建议 | L | 高（涉及对外行为，需单独评审） |

### F. 横切一致性（审计为主，输出规则而非大改）

| # | 条目 | 工时 |
|---|------|------|
| F1 | 抽样 ~40 domain，核对错误处理是否统一、有无违反「不创建假数据兜底」的空对象兜底 | M |
| F2 | 核对 OpenAPI 契约漂移纪律：路由签名变更是否都跑了 `pnpm openapi` | S |
| F3 | 盘点 API/Workflow/Desktop 三侧重复逻辑（prompt 构建、provider 调用、错误模型） | M |

## 3. 推荐执行顺序

1. **先清 A 区**（A3→A1→A2→A4）：同款低风险手法、护栏足、直接把 live 路径最大文件收敛到骨架。
2. **再做 E1 审计**：厘清 legacy 边界，是后续很多判断的前提。
3. **C1 ChatWindow 审计+拆分**：主产品体验、收益最直观。
4. **B1 book_generation 审计+拆分**：后端最大单文件。
5. D、F 区按需穿插，作为审计型条目随手回填规则。

## 4. 每条目通用验证门禁

```bash
# Python 侧（A/B/E/F）
cd apps/api && uv run ruff check <改动路径>
cd apps/api && uv run pytest <相关测试> -q
# 前端侧（C）
npm --prefix apps/desktop/frontend run typecheck
npm --prefix apps/desktop/frontend run test
# Workflow 侧（D）
cd apps/workflow && uv run pytest -q
```

结果摘要回填 `.codex/verification-report.md`，并在 PR 描述里说明「零行为变更」或「行为变更点 + 评审依据」。
