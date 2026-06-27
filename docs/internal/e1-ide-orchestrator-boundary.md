# E1 · legacy `ide/orchestrator.py` 边界审计

> 生成时间：2026-06-27
> 对应 backlog：`docs/internal/refactor-elegance-plan.md` 第 E 区 E1。
> 定位：画出 `apps/api/app/domains/ide/orchestrator.py`（1389 行 / 53KB）内部「live 被引用」与「仅 legacy 兜底分支可达」的边界，作为 E2 迁移/收缩的前提。**本条目零代码行为变更，只产出边界图与证据。**

## 1. 结论摘要（TL;DR）

1. **只有两个符号跨边界进入 live 代码**：`AgentOrchestrationError`（恒被引用）与 `orchestrate_agent_message`（仅 fallback 时触发）。其余全部是 orchestrator 内部实现，外部 live 代码不直接 import。
2. **只有 `chapter.review` 与 `chapter.repair` 两个 intent 会真正落到 legacy 兜底**。live runtime 已直接接管 `chat.explain` / `file.review` / `file.revise` / `bookrun.start`，它们经 live 路径**恒不可达** legacy。
3. **orchestrator.py 是 Agent 流水线的一份完整冻结副本**：intent 识别、file review/revise、multi-agent 审稿、bookrun 预检、revise-scope 解析在 A 区都已被搬进 `agent_runs/` 下的薄模块，但 orchestrator 里的这份原地未动，已与 live 副本**出现行为漂移**（见 §5）。

## 2. 跨边界符号表（live ← orchestrator）

| 符号 | 定义 | live 引用点 | 触发时机 |
|------|------|------------|----------|
| `AgentOrchestrationError`（异常类型） | orchestrator.py:46 | runtime.py:63、service.py:41、intent.py:7、review_report.py:8、tooling.py:12 | **每条 Agent 消息**都在 raise/except 这个类型，与 fallback 无关 |
| `orchestrate_agent_message`（入口函数） | orchestrator.py:79 | runtime.py:63 import；runtime.py:745 在 `_legacy_orchestrator` 内调用 | **仅 fallback**：intent 落到 else 分支时 |

> 其余被 live 侧同名持有的 `AgentToolTrace` / `SUPPORTED_INTENTS` **不跨边界**：live 用的是 `agent_runs/trace.py`、`agent_runs/intent.py` 各自的副本；orchestrator.py:51 / :34 的那两份是 legacy 自用。

测试侧额外引用（非 live 运行路径）：`test_ide_agent_orchestrator.py:20` 直接 import `SUPPORTED_INTENTS, _detect_intent`；`test_agent_runs.py:296` monkeypatch `orchestrate_agent_message`；`:709/724/758` import `AgentOrchestrationError`。

## 3. 路由边界（live runtime → legacy 的唯一缝）

live `AgentRuntime.run_user_message()`（runtime.py）按 intent 分流：

| intent | 落点 | 是否进 legacy |
|--------|------|--------------|
| `chat.explain` | live `_run_chat_explain` | 否 |
| `file.review` / `file.revise` | live `_run_chapter_polish` | 否 |
| `bookrun.start` | live `_run_bookrun_generation` | 否 |
| **其余**（`chapter.review` / `chapter.repair`） | `else` → `_execute_tool("legacy.orchestrator", …)` | **是** |

`legacy.orchestrator` 工具锚点（全部在 runtime.py）：注册 :558、handler `_legacy_orchestrator` :743、approval 豁免名单 :500、结果标记 `runtime_mode="legacy_adapter"` :160。handler 内唯一动作是 `orchestrate_agent_message(...)`（:745），再把结果包成 `ToolResult`。

> 注：`orchestrate_agent_message` 内部会用 orchestrator **自己的** `_detect_intent` 对同一条消息**二次判定**。已核实：即便两份 `_detect_intent` 已漂移（§5），对 live 委派进来的输入，legacy 二次判定仍恒落到 `chapter.review` / `chapter.repair`，不会改变可达集。

## 4. 函数级分区

### 4.1 live 可达子集（经 `chapter.review` / `chapter.repair` fallback）

- 调度链：`orchestrate_agent_message`(79)、`_message_text`(846)、`_message_args`(854)、`_detect_intent`(773) 及其判定 helper `_is_confirm_writeback_request`(831) / `_is_file_review_request`(799) / `_is_file_revise_request`(806) / `_has_positive_int` / `_optional_string`、`_resolve_assistant_session`(154)
- 两个入口：`_orchestrate_chapter_review`(402)、`_orchestrate_chapter_repair`(469)
- 执行与装配：`_execute_command_with_tool_audit`(686)、`_judge_run_args_from_scene_packet`(748)、`_base_response`(180)、`_plan_step`(859)、`_safe_summary`(1309)
- 数据 helper：`_required_int`(1278)、`_required_string`(1271)、`_payload_list`(1325)、`_can_repair_issue`(1357)、`_first_patch_payload`(1369)、`_proposed_patch_from_repair_patch`(1377)、`_string_list`(1331)、`_style_rules`(1343)、`_dict_list`(1337)
- legacy 自用类型：`AgentToolTrace`(51)、`SUPPORTED_INTENTS`(34)

> 这两个入口都只经 IDE command registry 跑 `judge.run` / `judge.repair`，**不触** multi-agent 审稿、revise-scope、bookrun 摘要任何一簇。

### 4.2 死集（经 live 路径恒不可达——对应 intent 已被 live 接管）

| 入口（dead） | 独占 helper 簇 |
|--------------|----------------|
| `_orchestrate_chat_explain`(204) | 仅 `_compact_text` 等公共 helper |
| `_orchestrate_file_review`(318) | **multi-agent 审稿簇**：`_build_multi_agent_review_report`(863)、`_review_report_summary`(1232)、`_subagent_output_summary`(972)、`_assign_issue_ids`(906)、`_issue_suggested_action`(918)、`_select_review_reasoner`(937)、`_review_report_mode`(944)、`_agent_finding`(956)、`_agent_issue_count`(1256)、`_degraded_review_agents`(1262) |
| `_orchestrate_file_revise`(234) | **revise-scope 解析簇**：`_resolve_revise_scope`(1034)、`_scoped_revise_instruction`(984)、`_public_revise_scope`(1089)、`_scope_issues`(1098)、`_scope_string_list`(1103)、`_string_arg_list`(1107)、`_valid_categories`(1113)、`_issue_category`(1118)、`_selected_issue_ids_from_instruction`(1130)、`_parse_ordinal`(1146)、`_included_categories_from_instruction`(1162)、`_excluded_categories_from_instruction`(1175)、`_revision_constraints_from_instruction`(1188)、`_ordered_unique`(1197)、`_revise_summary_with_scope`(1207)、`_review_report_issue_count`(1214)、`_review_report_issues`(1218)、`_review_report_actions`(1225) |
| `_orchestrate_bookrun_start`(511) | **bookrun 预检摘要簇**：`_bookrun_chapter_plan_summary`(636)、`_bookrun_budget_summary`(643)、`_bookrun_budget_details`(654)、`_bookrun_risk_summary`(667) |

> 「死集」指**经 live 运行路径**不可达。它们仍可被测试或未来直接调用方触达，因此不能无条件删除，须随 E2 一并评估。

## 5. 关键发现与风险

1. **`_detect_intent` 已漂移**：live `intent.py:32` 比 legacy `orchestrator.py:773` 多一条 `has_file_context and _has_reviewer_role_hint(args) → file.review` 分支。对 live 委派进来的输入不改变可达集（§3 注），但意味着**两份判定逻辑已不再等价**——若 E2 想直接复用 legacy 入口或把 live 切到 legacy，会引入分类差异。
2. **整条流水线双副本**：§4.2 的三簇 + intent 识别 + `_text` 原语在 `agent_runs/`（intent.py / review_report.py / revise_scope.py / bookrun_summary.py / _text.py）已有 live 版本。orchestrator 这份是历史冻结副本，是 53KB 体积的主要来源，也是后续维护双写风险点。
3. **真正的 legacy 净资产很小**：去掉死集后，legacy 实际仍在服务的只有 `chapter.review` / `chapter.repair` 两条 `judge.run`/`judge.repair` 编排（§4.1）。这是 E2 真正要迁移/保留的核心。

## 6. 对 E2 的落点建议（仅建议，不在本条目执行）

1. **先迁稳定符号**：把 `AgentOrchestrationError` 迁到 `agent_runs/` 下稳定模块（如 `agent_runs/errors.py`），解除 5 处 live import 对 `ide.orchestrator` 的依赖——这是收缩 legacy 的第一刀，风险最低。
2. **再收缩 fallback**：将 `chapter.review` / `chapter.repair` 两条编排（§4.1）按 A 区手法迁入 live `agent_runs/`，让 `else` 分支直接走 live，`legacy.orchestrator` 工具与 `orchestrate_agent_message` 随之可下线。
3. **死集随迁随删**：§4.2 三簇在 live 已有等价实现，迁移完成后可整簇删除；删除前用 `rg` 复核无测试/外部引用。
4. **漂移对账**：迁移 `chapter.*` 前，先对账 live 与 legacy `_detect_intent` 的差异（§5.1），避免行为回退。

## 7. 验证（佐证本边界结论）

- `cd apps/api && uv run python -c "import app.main"` → `import ok`（orchestrator 与 agent_runs 无 import 环，文件可载）。
- `cd apps/api && uv run pytest tests/test_agent_runs.py tests/test_ide_agent_orchestrator.py -q` → **59 passed**（覆盖 live runtime 分流、`legacy.orchestrator` fallback monkeypatch、legacy `_detect_intent` 语义）。
- 全仓 `rg 'ide\.orchestrator|orchestrate_agent_message'`：live 引用仅 `agent_runs/{runtime,service,intent,review_report,tooling}.py` + 测试；`ide/router.py`、`ide/service.py` **不引用** orchestrator。
