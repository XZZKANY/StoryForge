"""canon 账本三把：不变量闸 / 事实差量提案 / 伏笔承诺记账。"""

from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, LoopToolSchema, ToolCatalogReferences

PROJECT_CANON_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="project.canon",
        description=(
            "项目 canon 闸：从正文重建实体在场缓存 + 校验作者在 .storyforge/canon/canon.json "
            "声明的薄不变量（唯一持有 / 时间线先后 / 退场一致性），产出硬矛盾与 advisory 信号。"
            "会更新 .storyforge/canon/ 派生缓存（非手稿正文），不落 DB。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("entity_count", "checked_invariants", "conflict_count", "advisory_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_canon",)),
        loop_schema=LoopToolSchema(
            description=(
                "项目 canon 闸（确定性，无需 LLM）：从正文重建实体在场分布缓存，再校验作者声明的薄不变量——"
                "唯一持有（同一物件章节窗口内只能一个持有者）、时间线先后（声明不能成环）、"
                "退场一致性（声明退场后不应再出场）。返回硬矛盾（blocking，声明内部结构冲突）与 advisory "
                "（退场后仍出场，可能是回忆 / 提及 / 同名，须抽读核实）。它随书累积、比无状态深查更能抓跨章累积漂移。"
                "同时把每实体事实（身份 / 别名 / 出场跨度 / 绑定声明 / provenance）投影成人可读 dossier.md 缓存。"
                "调用会更新 .storyforge/canon/ 下的派生缓存（不改手稿）。作者尚未在 canon.json 声明不变量时，"
                "会建立空格式骨架并如实说明无可校验项。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "refresh": {
                        "type": "boolean",
                        "description": "是否强制从正文重建在场缓存，默认 true。",
                    },
                    "glob": {"type": "string", "description": "正文文件名过滤，默认 *.md。"},
                },
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.canon_delta",
        description=(
            "确定性 canon 提案：把模型从正文观察到的实体、持有、退场、时间线与伏笔声明与既有 canon "
            "做归并、别名冲突与不变量差量检查，草稿只写派生 proposals.json；不写 canon.json 或手稿。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=(
            "new_entity_count",
            "known_entity_count",
            "alias_conflict_count",
            "new_conflict_count",
            "new_advisory_count",
        ),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_canon_delta",)),
        loop_schema=LoopToolSchema(
            description=(
                "canon 事实差量提案（确定性，无额外 LLM）：读完章节后，把观察到的实体、唯一持有、退场、"
                "时间线先后与新埋的伏笔作为结构化参数传入。伏笔走 promise_claims——它是**唯一**能把新"
                "伏笔写进账本的通道，project_promise_check 只读不写。"
                "字段未传表示该类不提议；全空会诚实返回无提议。工具会归并"
                "既有实体、提示同名 / 别名身份冲突，并只报告提案新增的 canon 闸问题。合并草稿写入派生缓存 "
                "proposals.json（上一轮作者还没并入的提案会一并留着，不会被本轮覆盖），"
                "绝不修改 canon.json 或正文；作者审阅后再决定是否走待确认补丁。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "entities": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "aliases": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                            "required": ["name"],
                        },
                        "description": "本章观察到的实体；name 为主表面形，aliases 为可选别名。",
                    },
                    "holder_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item": {"type": "string"},
                                "holder": {"type": "string"},
                                "from_chapter": {"type": "integer"},
                                "to_chapter": {"type": "integer"},
                            },
                            "required": ["item", "holder"],
                        },
                        "description": "本章观察到的唯一持有声明。",
                    },
                    "exit_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "entity": {"type": "string"},
                                "exits_after_chapter": {"type": "integer"},
                                "reason": {"type": "string"},
                            },
                            "required": ["entity", "exits_after_chapter"],
                        },
                        "description": "本章观察到的实体退场声明。",
                    },
                    "timeline_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "before": {"type": "string"},
                                "after": {"type": "string"},
                            },
                            "required": ["before", "after"],
                        },
                        "description": "本章观察到的时间线先后声明。",
                    },
                    "promise_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "planted_chapter": {"type": "integer"},
                                "due_chapter": {"type": ["integer", "null"]},
                                "status": {
                                    "type": "string",
                                    "enum": ["planted", "advancing", "resolved"],
                                },
                                "kind": {"type": "string"},
                                "resolved_chapter": {"type": "integer"},
                                "cadence_chapters": {"type": "integer"},
                            },
                            "required": ["title", "planted_chapter"],
                        },
                        "description": (
                            "本章观察到的叙事承诺（伏笔 / 倒计时 / 誓约 / 悬念 / 禁忌）。"
                            "due_chapter 传 null 表示开放窗口、不设到期；不确定第几章兑现就传 null，"
                            "不要瞎猜一个章号——那会让 promise_check 报假逾期。"
                            "id 会按标题确定性派生，重复观察同一条不会攒出多份。"
                        ),
                    },
                },
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.promise_check",
        description=(
            "伏笔承诺记账：只读 canon.json 的作者 promises 声明，确定性检查声明矛盾、超窗未兑现、"
            "长期停滞与 recurring 断供；无 LLM、不写 canon、缓存或手稿。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("current_chapter", "promise_count", "conflict_count", "advisory_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_promise_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "伏笔承诺记账（确定性，无需 LLM、纯只读）：读取 .storyforge/canon/canon.json 中作者声明的 "
                "invariants.promises，检查 resolved / 埋设 / 截止章的结构矛盾、重复 id，以及超窗未兑现、"
                "开放窗口长期停滞和 recurring cadence 断供。只返回 blocking 与 advisory 证据，绝不修改 "
                "canon.json、派生缓存或手稿；advisory 仍需结合原文核实。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "stale_after_chapters": {
                        "type": "integer",
                        "description": "开放窗口 planted 承诺的停滞章数阈值，默认 30。",
                    },
                },
            },
        ),
    ),
)
