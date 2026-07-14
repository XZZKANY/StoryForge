from __future__ import annotations

from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec, LoopToolSchema, ToolCatalogReferences

HOOK_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="project.hooks_delta",
        description=(
            "hooks 差量提案：把模型从正文观察到的叙事承诺（伏笔）与既有 hooks 做确定性归并、去重，"
            "并在证据文本上跑正则模式辅助检测。不写 hooks.json，仅输出提案供作者审阅。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("new_hook_count", "duplicate_count", "pattern_hit_count"),
        references=ToolCatalogReferences(
            workflow_nodes=("agent_runtime.project_hooks_delta",),
        ),
        loop_schema=LoopToolSchema(
            description=(
                "叙事承诺钩子差量提案（确定性去重 + 正则辅助，无额外 LLM）：读完章节后，"
                "把观察到的叙事承诺钩子作为 observed_hooks 传入。可同时传入 evidence_text 正文片段，"
                "工具会在其上跑正则模式检测作为辅助信号。工具只归并去重、不写 hooks.json；"
                "新钩子列表需作者确认后再调用 canon_store.write_hooks 写入。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "observed_hooks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "description": {
                                    "type": "string",
                                    "description": "钩子描述（如「青岩欠陆沉一把刀的情」），必填。",
                                },
                                "verification": {
                                    "type": "string",
                                    "description": "验证条件——读者读到什么就知道伏笔收了。",
                                },
                                "category": {
                                    "type": "string",
                                    "description": "钩子类型：conditional_promise / countdown / threshold / oath / mystery / taboo / hidden_info",
                                },
                                "note": {
                                    "type": "string",
                                    "description": "备注（如建议回收章序、召回条件）。",
                                },
                            },
                            "required": ["description"],
                        },
                        "description": "本章观察到的叙事承诺钩子。",
                    },
                    "evidence_text": {
                        "type": "string",
                        "description": "正文片段（可选），工具会在其上跑正则模式检测辅助信号。",
                    },
                },
            },
        ),
    ),
)
