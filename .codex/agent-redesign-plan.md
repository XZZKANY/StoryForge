# IDE Agent 重构实施计划（可执行）

> 目标读者：自己照着做。每个阶段都给了 **改动文件 / 做法 / 接口签名 / 测试点 / 验收标准**。
> 设计立场见对话结论：**确定性外壳 + 可注入推理缝 + 真子代理**，不接 LangGraph、不上自由 tool-calling 循环。
> 核心红线（来自 CLAUDE.md + `project_gen_quality_truth`）：**标签不许跑在能力前面；LLM 不可用就降级并明说，不静默伪造。**

---

## 0. 现状基线（动手前确认这些还成立）

- 编排入口：`apps/api/app/domains/ide/orchestrator.py:78` `orchestrate_agent_message`，单轮同步。
- 伪子代理：`apps/api/app/domains/ide/review_skills.py:62-152`，纯关键词启发式。
- 评审组装：`orchestrator.py:677` `_build_multi_agent_review_report` + `:310` `_orchestrate_file_review` + tool_trace 块 `:334-368`（贴 `subagent.*` 标签）。
- 真 LLM 缝样板：`apps/api/app/domains/assistant/service.py:189` `revise_file_content` →
  `_call_llm(source, *, system_prompt, user_prompt)`（`book_generation.py:692`，timeout 默认 300s，失败抛 `BookGenerationError`，**无 JSON mode**）。
- env 门禁：`missing_book_generation_env()` / `resolved_llm_env()`（`book_generation.py:137,188`）。
- WebSocket：`router.py:184-200`，`send_json(result)` 一次性返回，无流式。
- 被钉死的测试：`tests/test_ide_agent_orchestrator.py:52-110` 硬断言 `subagent.*` 名单与 plan step。

---

## 不做什么（范围闸门）

- **不接 LangGraph**（`project_gen_quality_truth`：零消费者、周级高风险、已搁置）。推理缝要为它留位，但本次不接。
- **不上自由 LLM tool-calling 循环**。意图→计划→派发保持确定性。
- **不动批准闸门 / 审计链**：写操作继续走 `proposed_patch` + 用户确认 + `judge.approve` + `audit_event_id`。
- **不重构 `book_generation.py`**：只 import 复用 `_call_llm` / env 函数，和 revise 一样。

---

## 阶段 1（核心）：抽推理缝 + 真 LLM 评审子代理 + 启发式降级

这是最该先做、风险最低、还债最直接的一步。Layer 2（缝）和 Layer 3（真子代理）一起落，因为它们互相定义。

### 1.1 新增推理缝模块

**新文件** `apps/api/app/domains/ide/review_reasoning.py`

```python
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Protocol

@dataclass(frozen=True)
class ReviewSubagentResult:
    agent: str            # "plot-agent" / "character-agent" / "prose-agent"
    mode: str             # "llm" | "heuristic"
    issues: list[dict[str, str]]   # 每项 {agent, severity, code, message, evidence}
    model: str | None = None
    latency_ms: int | None = None
    degraded_reason: str | None = None   # 从 llm 跌回 heuristic 时填，用于诚实标注

class ReviewReasoner(Protocol):
    def review_all(
        self, *, content: str, paragraphs: list[str], context_bundle: dict[str, Any] | None
    ) -> list[ReviewSubagentResult]: ...
```

两个实现，同一接口：

- `HeuristicReviewReasoner`：直接包当前 `review_skills.py` 的 `plot_agent_issues / character_agent_issues / prose_agent_issues`，`mode="heuristic"`。**保留 review_skills.py，不删**——它现在的诚实身份是「LLM 不可用时的快速预扫 / 单项降级兜底」。
- `LlmReviewReasoner(source)`：对 plot/character/prose 各发一次 `_call_llm`，**用 ThreadPoolExecutor(max_workers=3) 并发**（`_call_llm` 纯 HTTP、不碰 Session，安全）。单项失败/解析失败 → 该项就地跌回对应 heuristic 函数，`mode="heuristic"` + `degraded_reason`。

每个 LLM 子代理的契约：

- system prompt = `REVIEW_SKILLS[key].focus` 改写成「你是 X 审稿代理，只看 <focus>」。
- user prompt = 截断正文（按 ~3000 字预算）+ 相关 context 摘录 + 强约束：
  「只输出 JSON 数组，每项 `{"severity":"high|medium|low","code":"...","message":"...","evidence":"原文片段"}`，不要解释、不要代码块标记。」
- 解析：`json.loads(content)`；非 list 或解析失败 → 视为该子代理失败 → heuristic 降级。
- 每代理 issues 截断上限（如 6 条），`severity` 非法值归一到 `medium`。

> 延迟预算：单次 `_call_llm` 实测 24–70s（见 `project_gen_quality_truth` / `project_desktop_assistant`）。并发后整轮 ≈ 单次。若仍嫌慢，**备选 Option B**：合并成 1 次调用返回三段式 JSON（`{"plot":[...],"character":[...],"prose":[...]}`），更省更快，但标注必须改成「单模型多视角」而非「三个子代理」——诚实优先，按 UI 现有「多视角」话术，默认走并发三调用的 Option A。

### 1.2 orchestrator 改为调用缝

**改 `orchestrator.py`**

- `_build_multi_agent_review_report`：选择 reasoner——
  `reasoner = LlmReviewReasoner(resolved_llm_env()) if not missing_book_generation_env() else HeuristicReviewReasoner()`。
  env 全缺 → 整轮 heuristic，`review_report["mode"]="heuristic_only"`。
- report 增加诚实字段：顶层 `"mode"`（`llm` / `mixed` / `heuristic_only`），每个 `agent_findings[key]` 增 `"mode"` 与（若降级）`"degraded_reason"`。
- `_orchestrate_file_review` 的 summary（`_review_report_summary`）：heuristic_only 时显式写「**未配置 LLM，本轮为启发式预扫，非模型审稿**」；mixed 时标出哪几项降级。
- tool_trace（`:334-368`）：`subagent.plot/character/prose` 的 `output_summary` 增 `{"mode","model","latency_ms"}`；`subagent.synthesizer` 诚实改语义——它现在仍是确定性合并（`suggested_actions_for_review`），把 tool_name 留作 `subagent.synthesizer` 但 `output_summary` 标 `{"strategy":"deterministic_merge"}`，**不谎称它在推理**。

### 1.3 测试

**改 `tests/test_ide_agent_orchestrator.py`**

- `test_agent_user_message_file_review_returns_multi_agent_report`：测试 client 无 LLM env，断言 `report["mode"]=="heuristic_only"`，每项 `agent_findings[*]["mode"]=="heuristic"`，summary 含「启发式预扫」字样。tool_trace 名单可保留。
- **新增** `test_file_review_uses_llm_when_configured`：`monkeypatch` `review_reasoning.missing_book_generation_env -> []` 且 `review_reasoning._call_llm` 返回固定 JSON（仿 revise 测试 `:119-122`），断言 `report["mode"]=="llm"`、issues 来自 LLM、tool_trace 带 `model`。
- **新增** `test_file_review_degrades_per_subagent_on_llm_error`：让 `_call_llm` 对其中一个 prompt 抛 `BookGenerationError`，断言该项 `mode=="heuristic"` + 有 `degraded_reason`，其余仍 `llm`，整轮不报错。

### 1.4 验收

- LLM 配好：review 三项走真模型、并发、有 model/latency 痕迹。
- LLM 没配：明确退化为启发式且 summary 说人话，不伪造。
- 单项 LLM 失败：只降那一项，整轮不挂。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` 全绿；`uv run ruff check .` 干净。

---

## 阶段 2：砍掉前端双重意图识别

`ChatWindow.tsx:195` `detectConversationIntent` 与后端 `_detect_intent`（`orchestrator.py:635`）是两套关键词路由，会打架。

- **做法**：后端为准。前端 `sendAgentUserMessage` 不再本地判 intent，传原文 + args + context_bundle，由后端 `_detect_intent` 决定。前端只保留「导出/审稿/修订」这类需要本地副作用（如 `emitExportCurrentFile`）的最小分流，且以后端返回的 `response.intent` 为准回填 UI。
- **改文件**：`apps/desktop/frontend/src/components/ChatWindow.tsx`、`apps/desktop/frontend/src/lib/api-client.ts`、`tests/command-palette.test.tsx` / `project-context.test.ts` 相应断言。
- **验收**：同一句话前后端判定一致；`pnpm --filter @storyforge/desktop-frontend test`（按实际 filter 名）通过。
- **注意**：此阶段可独立于阶段 1，但建议排在其后，避免同时动前后端。

---

## 阶段 3（可选，UX 高价值）：WebSocket 流式

让「agent 在干活」变真：边做边发 `plan_step` / `tool_trace` 事件，删掉 `ChatWindow.tsx:370-381` 预造 5 个假步骤的编舞。

- **后端**：`orchestrate_agent_message` 增可选 `emit: Callable[[dict], None] | None`，在 context/各子代理/合并完成时 `emit({"type":"agent_event", ...})`；`router.py:196` 把 `websocket.send_json` 包成 emit 回调，最后再发 `agent_result` 收口。保持 `emit=None` 时行为与现在完全一致（向后兼容）。
- **前端**：`ChatWindow` 按收到的 `agent_event` 增量更新步骤，不再凭空造步骤；最终 `agent_result` 收口。
- **验收**：审稿过程中步骤逐条点亮，且每步对应真实后端事件；断网/出错时步骤停在真实位置而非全部假完成。
- **风险**：改了 WebSocket 消息协议，前后端要同版本发布；测试需覆盖「中途事件 + 末尾结果」两类消息。

---

## 阶段 4（可选，按需）：评审合并升级为 LLM 综合

把确定性的 `suggested_actions_for_review` 换成 1 次 LLM 综合调用（吃三子代理 issues，产优先级排序的修订建议）。仅在阶段 1 稳定后再做，且同样要 env 降级 + 诚实标注。非必须。

---

## 阶段 5：对话化范围控制（对话主导 revise）

> 来源：设计稿「对话主导的 Subagent + Skill 编排」。立场不变：**一个助手、一条对话流、subagent 只做内部 trace、不加主流程按钮、不搞多 Agent 会议 UI**。
> 依赖：阶段 1（结构化 review_report 已落地）+ 阶段 2 的决策（**后端为意图与范围解析的唯一权威**）。
> 红线同前：**标签不跑在能力前面**——这一阶段的「确认写回」绝不能静默改写用户想保留的内容。

### 5.0 一条必须先想清的边界（解决「双重解释」之争）

设计稿想把引用解析放前端，会重蹈阶段 2 要砍的 split-brain。但写回 apply 是 **Tauri 客户端动作**，后端碰不到本地文件。所以正确切分不是「全后端」，而是按**状态持有方**分：

- **意图分类 + 范围解析**（哪几条 issue / 哪些类别 / 什么约束）→ **后端**。它持有 review_report，是 issue id 的唯一真相源。
- **客户端动词**（导出、写回确认）→ **前端**。它持有 pending diff、调 Tauri apply。这与阶段 2 明确保留的 `emitExportCurrentFile` 同类，是合法的本地副作用分流，不是第二个意图路由。

判据：前端**不再对同一句话二次分类 intent**；它只识别「作用于客户端自持工件的动词」。范围/约束一律由后端对着自己产出的报告解析并回报。

### 5.1 v2a（地基，先做）：给 issue 加稳定 id + category

「第二条」「selected_issue_ids」需要可寻址的 issue。报告是绑定在会话态(`lastReviewReport`)上的**不可变工件**，所以 id 只需**在该报告实例内稳定**，无需内容哈希。

**改 `orchestrator.py:725-730`**：

```python
plot_issues = _assign_issue_ids("plot", results_by_key["plot"].issues)
character_issues = _assign_issue_ids("character", results_by_key["character"].issues)
prose_issues = _assign_issue_ids("prose", results_by_key["prose"].issues)
```

新增：

```python
def _assign_issue_ids(category: str, issues: list[dict[str, str]]) -> list[dict[str, str]]:
    # id 在本报告实例内稳定即可（报告是绑会话的不可变工件）；重审=新报告=新 id。
    return [{**issue, "id": f"{category}-{n}", "category": category} for n, issue in enumerate(issues, start=1)]
```

- id 形如 `plot-1` / `character-2`，字符串。**与 chapter.repair 路径的 int 型 `issue.get("id")`（`orchestrator.py:416,644`）不冲突**，那是另一套结构。
- `category` 直接落 `plot/character/prose`，类别筛选 join 这个字段，不要再从 `"plot-agent"` 反解。
- UI 显示用 1-based 序号（报告内顺序），「第二条」= 显示列表第 2 项 → 取其 `id`。
- `suggested_actions_for_review` 仍收原三段（多带 id/category 键无害）。

**测试**：`test_review_report_issues_have_stable_ids`——断言每条有 `id`、全局唯一、`category` ∈ {plot,character,prose}。

### 5.2 v2b：`file.revise` 字段扩展 + 后端范围解析 + 约束进 prompt + 回报已应用范围

**`file.revise` args 扩展**（`_orchestrate_file_revise:240-244` 一带）：

```
review_report:        dict        # 既有
selected_issue_ids:   list[str]   # 新增，如 ["character-1","plot-2"]
included_categories:  list[str]   # 新增，如 ["character"]
excluded_categories:  list[str]   # 新增，如 ["prose"]
revision_constraints: list[str]   # 新增，如 ["保留结尾","不动对白"]
```

> 不要 `writeback_policy`——写回是独立客户端动词（见 5.3），挂在 revise 上会把 propose/apply 搅浑、有让 revise 直接写文件的风险。

**后端解析（唯一权威，校验真实存在）**，新增 `_resolve_revise_scope(review_report, args) -> dict`：

1. 从报告收所有合法 id；`selected = [i for i in selected_issue_ids if i in valid]`，**被丢弃的未知 id 记进 `dropped_unknown_ids`，不静默吞**。
2. 优先级：有 selected → 用 selected；否则有 `included_categories` → 按 category 过滤；否则全量。
3. 再减去 `excluded_categories`。
4. 返回 `{issue_ids, categories, constraints, dropped_unknown_ids}`。

把 `_instruction_with_review_report`(`:800`) 泛化为 `_scoped_revise_instruction(instruction, review_report, scope)`：只列**有效 issue 集**（替换现在的 `issues[:8]` 全量编号），并把 `revision_constraints` 作为**硬约束**追加：「硬约束（必须遵守）：1. 保留结尾 …」。

**回报已应用范围（echo，使误解析可见）**：在 `agent_result` / `tool_trace` 加 `applied_scope: {issue_ids, categories, constraints, dropped_unknown_ids}`；`dropped_unknown_ids` 非空时 summary 明说「忽略了不存在的条目 X」。这就是「复述确认」的后端落点——把误解析从静默错误变成可见信息。

**测试**：
- `test_revise_scope_selected_ids_only_lists_those`：capture `user_prompt`，断言只含选中 issue、其余 absent。
- `test_revise_constraints_reach_prompt`：断言「保留结尾」出现在 `captured["user_prompt"]`（仿现有 `test_agent_file_revise_can_use_previous_review_report`）。
- `test_revise_unknown_issue_id_is_reported`：传 `["plot-99"]`，断言 `applied_scope.dropped_unknown_ids` 含它且不崩。

### 5.3 v2c：「确认写回」是客户端动词，不是一次 revise

**先修坑**：`_is_file_revise_request`(`orchestrator.py:675`) 含关键词「写回」，使「确认写回」误判为 `file.revise` → 重新生成。必须区分。

- **前端**：识别「确认写回 / 接受这版 / 就这版写回」为客户端动词 → 对**会话态里持有的 pending diff** 调既有 `desktop.confirm_file_writeback`（apply 用户**已经看过的那个 patch**，不重新生成）。无 pending diff → 助手只回「当前没有待写回的修订」**不写文件**。
- **后端防御**：`_detect_intent` 在 revise 分类前加一道——纯确认类话术（「确认写回」且无改写诉求）**不路由到 `file.revise`**；真收到就返回 chat 解释「写回请在 diff 面板确认」，绝不借机生成+写。
- **proposed_patch 加 `id`**（`:298` 一带）作为不可变工件；前端按 id apply。文件若在确认前已变 → 重新 diff 再确认（v2c stretch，可后置）。

**测试**：
- `test_confirm_writeback_phrase_not_classified_as_revise`：`_detect_intent("确认写回", …)` 不得返回 `file.revise`。
- `test_confirm_writeback_without_pending_patch_does_not_write`：无 pending → 无 proposed_patch、只回话。

### 5.4 不做（范围闸门）

- **不上 LLM 意图/引用解析器**：v1 纯确定性规则 + 后端校验。叫它确定性路由，**别叫 Supervisor**（暗示 LLM 自主就是标签跑在能力前，同 subagent 标签的教训）。等真接 LLM 解析再升格。
- **不加主流程按钮、不做多 Agent 会议 UI**：subagent 名字仍只在内部 trace。
- **不动批准/审计链**：写仍走 `proposed_patch` + 用户确认 + `desktop.confirm_file_writeback`。
- **不跨重启持久化会话态**：v1 绑当前 ChatWindow/文件，重启即丢。
- **报告过期**：用户 review 后改了文件再说「只修人物」，缓存报告对不上文件——v2 至少在 summary 告警（issue evidence 不在当前正文里时提示重审），不假装范围还准确。

### 5.5 验收

- 「只修人物问题，保留结尾」→ diff 只动人物相关、prompt 含硬约束、结尾未被改。
- 引用越界（「第五条」但只有 3 条 / 未知 id）→ 明确告知忽略了什么，不静默 no-op。
- 「确认写回」无 pending → 不写、只回话；有 pending → 走既有 apply，apply 的是用户看过的那版。
- `cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q` 全绿；`uv run ruff check .` 干净。

### 5.6 建议子序

先 **v2a（稳定 id）**——它是 v2b/v2c 的共同前置，单独成可提交单元；再 v2b（范围化 revise + echo），最后 v2c（写回动词归位）。每步独立可提交。

---

## 跨阶段护栏（每个 LLM 调用都适用）

1. **超时**：沿用 `_call_llm` 的 300s 默认，别自己改小（`project_gen_quality_truth`：单次实测 47–68s，60s 会偶发超时）。
2. **失败隔离**：任一子代理抛错只降级该项，不冒泡整轮。
3. **降级即声明**：env 缺失或解析失败一律在 report `mode` + summary 里写清楚，禁止返回看起来正常的假结果（CLAUDE.md：不创建假数据兜底）。
4. **reasoning_effort 别置 low**：`project_gen_quality_truth` 实证 mimo 置 low 会空返回；保持默认。
5. **不落凭据**：和 revise 一样，只读 `resolved_llm_env()`，不在会话/工具调用里存 key。
6. **审计不变**：写命令仍走 `_execute_command_with_tool_audit`，`audit_event_id` 必须在。

---

## 验证命令（收口前全跑）

```bash
# Python 单测 + 风格
cd apps/api && uv run pytest tests/test_ide_agent_orchestrator.py -q
cd apps/api && uv run ruff check .

# 真 LLM 端到端（带凭据；本机 uvloop 起服会崩，用 TestClient 探针，见 project_desktop_assistant）
#   先 export STORYFORGE_LLM_* + DATABASE_URL，再跑针对 file.review 的探针脚本

# 全链路门禁
pnpm test
pnpm lint
```

> 本机起 API 的坑（`project_desktop_assistant`）：venv uvicorn 无条件 `import uvloop`，Windows 直接崩，`--loop asyncio` 也救不了——端到端验证用 Starlette `TestClient` 挂 `app.main:app`。

---

## 已知坑 / 风险清单

- **`_call_llm` 无 JSON mode**：结构化输出全靠 prompt 约定 + 防御解析，必须有解析失败→降级路径。
- **延迟**：三子代理即使并发也 ~单次（数十秒），审稿按钮要有 loading 态；嫌慢用 Option B 单调用。
- **被钉死的测试**：阶段 1 必须同步改 `test_ide_agent_orchestrator.py:97-110`，否则红。
- **mimo 长 prompt 前科**：500/超时（`project_gen_quality_truth`）；评审 prompt 已截断正文，风险低于整章生成，但保留 300s 超时与失败隔离。
- **证据链留痕**：完成后在 `.codex/verification-report.md` 记命令 + 输出摘要 + 未联通能力（CLAUDE.md 硬要求）。

---

## 建议落地顺序

1. 阶段 1（缝 + 真子代理 + 降级 + 测试）——**核心，单独成一个可提交单元**。✅ 已落地。
2. 阶段 2（砍前端双重意图）——是阶段 5「后端为范围解析唯一权威」的前置决策，建议先于阶段 5。✅ 已落地。
3. 阶段 5（对话化范围控制：v2a 稳定 id → v2b 范围化 revise → v2c 写回动词归位）。✅ 已落地。
4. 阶段 3 / 4 按需，各自独立成单元。⏳ 可选，未执行。

> 一次只解一个明确问题，别顺手重构无关代码（CLAUDE.md：小步推进）。
