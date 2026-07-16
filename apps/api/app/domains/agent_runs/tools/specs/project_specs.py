from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, LoopToolSchema, ToolCatalogReferences

PROJECT_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="project.consistency",
        description="项目级一致性观察扫描：词条出现分布、时间标记、跨文件重复子句（path-scoped 只读，不下结论）。",
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("scanned_files", "term_count", "time_marker_count", "repeated_clause_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_consistency",)),
        loop_schema=LoopToolSchema(
            description=(
                "项目级一致性观察扫描：给定人物名 / 称谓 / 设定词条，返回各文件出现分布（含从未出现的缺席词条）、"
                "全书时间标记罗列和跨文件重复子句。只报机械观察不下结论，用于称谓 / 时间线 / 重复表达检查。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "terms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要追踪的人物名 / 称谓 / 设定词条，最多 30 个；可先读设定文件再决定。",
                    },
                    "subpath": {"type": "string", "description": "限定扫描的子目录，相对项目根。"},
                    "glob": {"type": "string", "description": "文件名过滤，默认 *.md。"},
                },
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.deep_consistency",
        description="深度一致性评审：语义 judge 对照本地人物 / 设定文件检查单个稿件，产出 advisory issue 信号（不写盘、不落 DB）。",
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        risk_level="analyze",
        # 虽是纯读无副作用，但每次调用真实烧 LLM token 且输出非严格确定：
        # 有意禁自动重试——瞬时失败作为工具错误反馈进循环，由模型/作者决定是否再试。
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        required_capabilities=("llm",),
        evidence_fields=("path", "issue_count", "bible_file_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_deep_consistency",)),
        loop_schema=LoopToolSchema(
            description=(
                "深度一致性评审（语义）：把单个稿件对照项目内人物 / 设定文件交给语义评审模型，"
                "返回结构化 issue（类别 / 严重度 / 行号 / 摘要）。比 project_consistency 更贵更慢，"
                "适合先用机械观察或检索定位疑点、再对目标章节深查；结果是参考信号，须抽读原文核实。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径（要评审的正文）。"},
                    "bible_paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "作为约束的人物 / 设定文件路径；省略则自动取 人物/ 与 设定/ 下的 md 文件。",
                    },
                    "facts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "已核实的必含事实（如「左臂受伤」「地点：灯塔港」），正文与之矛盾会被标出；最多 40 条。",
                    },
                },
                "required": ["path"],
            },
        ),
    ),
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
            "确定性 canon 提案：把模型从正文观察到的实体、持有、退场和时间线声明与既有 canon 做归并、"
            "别名冲突与不变量差量检查，草稿只写派生 proposals.json；不写 canon.json 或手稿。"
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
                "canon 事实差量提案（确定性，无额外 LLM）：读完章节后，把观察到的实体、唯一持有、退场和"
                "时间线先后作为结构化参数传入。字段未传表示该类不提议；全空会诚实返回无提议。工具会归并"
                "既有实体、提示同名 / 别名身份冲突，并只报告提案新增的 canon 闸问题。合并草稿写入派生缓存 "
                "proposals.json，绝不修改 canon.json 或正文；作者审阅后再决定是否走待确认补丁。"
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
    AgentRuntimeToolSpec(
        name="project.prose_check",
        description=(
            "文笔气味静态检查：对单个稿件做确定性坏味道扫描（陈词套话 / 说明腔 / 情绪直述 / "
            "解释性旁白 / 对白密度 / 句长 / 重复表达 / 静态节奏 / 机械过渡 / 公式化设问 / "
            "二元对比 / 空泛总结），产出 advisory issue（无 LLM，不写盘）。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "issue_count", "dimension_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_prose_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "文笔气味静态检查（确定性，无需 LLM、不烧 token）：对项目内单个稿件扫描常见坏味道——"
                "陈词套话、直述情绪的说明腔、解释性旁白、对白密度失衡、超长句 / 短句堆叠、短窗口重复、"
                "缺少行动 beat 的静态节奏，以及机械过渡、公式化设问、二元对比和空泛总结，返回带维度 / "
                "严重度的 issue 列表。比 file_review 便宜得多，"
                "适合修订前先快速定位文笔问题；结果是参考信号，结合原文判断后再决定是否修改。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径（要检查文笔的正文）。"},
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.collapse_check",
        description=(
            "场景承重静态检查：结合正文与模型抽取的结构化观察值，确定性标记 process-only、"
            "情绪零变化、无不可逆后果、可删除和调查模板风险；仅供 advisory 参考，不是质量判定。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "verdict", "issue_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_collapse_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "场景承重静态检查（确定性，无需额外 LLM、不写盘）：先读完正文，再把你从正文观察到的 beats、"
                "场景前后情绪、不可逆后果、是否可删除填入可选参数。未传字段会跳过对应规则；显式空串 / "
                "空数组表示观察结果为无。工具还会扫描正文调查模板，返回 pass / warn advisory 信号。"
                "结果只是辅助判断，不是场景质量结论。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的正文文件路径。"},
                    "beats": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "读完正文后提取的场景动作 beats；显式空数组表示没有 beats。",
                    },
                    "emotion_before": {
                        "type": "string",
                        "description": "场景开始时的情绪；显式空串表示没有可识别情绪。",
                    },
                    "emotion_after": {
                        "type": "string",
                        "description": "场景结束时的情绪；显式空串表示没有可识别情绪。",
                    },
                    "irreversible_consequence": {
                        "type": "string",
                        "description": "本场造成的不可逆后果；显式空串表示没有。",
                    },
                    "deletable": {
                        "type": "boolean",
                        "description": "删除本场后主线是否仍成立。",
                    },
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.entity_budget_check",
        description=(
            "长篇实体预算静态检查：结合章节序号与模型从正文抽取的新增实体，确定性标记后期新增地点 / "
            "谜题 / 设备证据及关键人物、核心地点、核心证据、重大反转数量超预算；仅供 advisory 参考，"
            "不是质量判定。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "chapter", "verdict", "issue_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_entity_budget_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "长篇实体预算检查（确定性，无需额外 LLM、不写盘）：先读完正文，再把本章观察到的新增关键人物、"
                "核心地点、核心证据、重大反转、谜题和装备填入可选数组。字段未传会跳过对应规则，显式空数组"
                "表示本章无该类新增。chapter 未传时按项目文件阅读序推断。返回 pass / warn advisory 信号，"
                "仅供结构规划参考，不是质量判定。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的正文文件路径。"},
                    "chapter": {
                        "type": "integer",
                        "description": "可选章节序号；未传时按项目文件阅读序推断。",
                    },
                    "new_key_characters": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增关键人物；显式空数组表示无新增。",
                    },
                    "new_core_locations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增核心地点；显式空数组表示无新增。",
                    },
                    "new_core_evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增核心证据；显式空数组表示无新增。",
                    },
                    "new_major_reversals": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增重大反转；显式空数组表示无新增。",
                    },
                    "new_mysteries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增谜题；显式空数组表示无新增。",
                    },
                    "new_equipment": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增装备或设备型号；显式空数组表示无新增。",
                    },
                    "budget_key_characters": {
                        "type": "integer",
                        "description": "关键人物数量预算覆盖，默认 5。",
                    },
                    "budget_core_locations": {
                        "type": "integer",
                        "description": "核心地点数量预算覆盖，默认 3。",
                    },
                    "budget_core_evidence": {
                        "type": "integer",
                        "description": "核心证据数量预算覆盖，默认 3。",
                    },
                    "budget_major_reversals": {
                        "type": "integer",
                        "description": "重大反转数量预算覆盖，默认 2。",
                    },
                    "budget_new_core_entities_after_chapter_20": {
                        "type": "integer",
                        "description": "第 20 章后新增核心实体预算覆盖，默认 0。",
                    },
                    "budget_new_mysteries_after_chapter_25": {
                        "type": "integer",
                        "description": "第 25 章后新增谜题预算覆盖，默认 0。",
                    },
                },
                "required": ["path"],
            },
        ),
    ),
)
