"""静态质量闸 + 连载计划；一致性与 canon 两组见同目录兄弟文件，拼接顺序即目录顺序。"""

from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, LoopToolSchema, ToolCatalogReferences
from app.domains.agent_runs.tools.specs.project_canon_specs import PROJECT_CANON_TOOL_SPECS
from app.domains.agent_runs.tools.specs.project_consistency_specs import (
    PROJECT_CONSISTENCY_TOOL_SPECS,
)

_QUALITY_AND_PLAN_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
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
    AgentRuntimeToolSpec(
        name="project.plan_update",
        description=(
            "连载计划推进：按章序 upsert 章节计划（标题 / 目标 / 状态 / 备注）与全书主线、字数区间、"
            "弧线，原子写 .storyforge/serial-plan.json。绝不碰手稿正文，不落 DB。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        # 只写 .storyforge/ 计划文件、不碰正文，故与 project.canon（写派生缓存）同档不需确认——
        # 每推进一章都要作者点一次确认，会把「一轮一章」的流打断成两步。
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("planned_total", "next_ordinal", "created_count", "updated_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_plan_update",)),
        loop_schema=LoopToolSchema(
            description=(
                "连载计划推进（确定性，无需 LLM）：维护 .storyforge/serial-plan.json——每轮对话开头你看到的"
                "「连载计划」块就是它的投影。按 ordinal upsert：已存在的章**逐字段合并**，只传 status 不会"
                "清掉作者写的 title / goal。典型用法有两种：①某章正文确已落盘 → 传 {ordinal, status:'done'} "
                "把它标掉，下一章才会正确前移；②作者给了大纲 → 一次传多章 {ordinal, title, goal} 建起计划。"
                "**正文不存在的章标 done 会被拒绝**：起草出待确认补丁不等于写完，补丁要作者点接受才落盘，"
                "此时标 done 等于让计划替作者做决定。等接受之后再标。"
                "写不下去时标 status:'blocked' 并在 note 写明卡在哪，之后不会再被当成下一章。"
                "**只写计划文件，绝不写手稿正文**——正文仍须走 file_create / file_revise 的待确认补丁。"
                "注意计划里的 status 只是声明，正文是否存在才是真相：块里报「计划与正文对不上」时，"
                "以正文为准把状态改对，不要照计划重写已有正文。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "chapters": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "ordinal": {"type": "integer", "description": "章序，正整数，作为合并主键。"},
                                "title": {"type": "string", "description": "章节标题。"},
                                "goal": {
                                    "type": "string",
                                    "description": "一句话本章目标（这一章要把故事推到哪儿）。",
                                },
                                "status": {
                                    "type": "string",
                                    "enum": ["pending", "done", "blocked"],
                                    "description": "待写 / 已完成 / 卡住；未传保留原状态。",
                                },
                                "note": {"type": "string", "description": "备注，如卡住的原因。"},
                            },
                            "required": ["ordinal"],
                        },
                        "description": "要新增或更新的章节；未传的字段保留原值。",
                    },
                    "premise": {"type": "string", "description": "全书主线一句话，写进计划头。"},
                    "chapter_word_count_min": {"type": "integer", "description": "每章目标字数下限。"},
                    "chapter_word_count_max": {"type": "integer", "description": "每章目标字数上限。"},
                    "arcs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "arc_id": {"type": "string"},
                                "title": {"type": "string"},
                                "target_chapters": {"type": "array", "items": {"type": "integer"}},
                                "payoff_chapter": {"type": "integer"},
                            },
                            "required": ["title"],
                        },
                        "description": "弧线清单（推进章 + 兑现章）；传入即整体替换，不合并。",
                    },
                    "remove_ordinals": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "要从计划里删除的章序（作者砍掉的计划章）。",
                    },
                },
            },
        ),
    ),
)

# 顺序即 catalog 顺序即 golden fixture 顺序——重排会让 golden 整体漂移。
PROJECT_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    *PROJECT_CONSISTENCY_TOOL_SPECS,
    *PROJECT_CANON_TOOL_SPECS,
    *_QUALITY_AND_PLAN_TOOL_SPECS,
)
