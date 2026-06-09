"""LLM 连续性结构边抽取器（第四刀）。

把已批准章节正文用 LLM 解析为 relationship/timeline_order/status 三类结构边，
喂给第三刀的 submit_continuity 端口 → API 结构门禁。

设计立场：**fail-soft**。解析失败、格式错、模型异常一律返回 []（记 warning），
绝不 abort 整个生成 run——单章抽取质量不可控，不应拖垮整本书。
解析逻辑（parse_continuity_edges）是纯函数，与 LLM 调用分离，可脱离模型全覆盖测试。
"""

from __future__ import annotations

import json
from collections.abc import Callable

from storyforge_workflow.orchestrators.novel_loop import NovelLoopRequest
from storyforge_workflow.prompts import build_continuity_edges_prompt
from storyforge_workflow.prompts.models import NarrativeContext
from storyforge_workflow.provider_client import generate_text, planning_model, planning_temperature
from storyforge_workflow.storyforge_api_client import post_chapter_approval
from storyforge_workflow.utils.logging import get_logger

log = get_logger("storyforge_workflow.nodes.continuity_extractor")

_VALID_EDGE_KINDS = {"relationship", "timeline_order", "status"}
# 对齐 API ContinuityEdgeInput 的列宽，超长截断而非丢弃，避免越界写入。
_MAX_REF = 160
_MAX_PREDICATE = 80


def parse_continuity_edges(raw: str) -> list[dict]:
    """把模型输出解析为合法边列表（纯函数，fail-soft）。

    剥代码围栏 → json.loads → 逐项校验，跳过坏项，任何异常都返回 []。
    """

    text = _strip_code_fences(raw)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        log.warning("continuity_edges_json_parse_failed", preview=text[:120])
        return []
    if not isinstance(parsed, list):
        log.warning("continuity_edges_not_a_list")
        return []

    edges: list[dict] = []
    for item in parsed:
        edge = _coerce_edge(item)
        if edge is not None:
            edges.append(edge)
    return edges


def _coerce_edge(item: object) -> dict | None:
    """把单个候选对象规整为合法边；任一必填字段缺失或非法则跳过（返回 None）。"""

    if not isinstance(item, dict):
        return None
    edge_kind = item.get("edge_kind")
    if edge_kind not in _VALID_EDGE_KINDS:
        return None
    subject_ref = _non_empty_str(item.get("subject_ref"))
    predicate = _non_empty_str(item.get("predicate"))
    object_ref = _non_empty_str(item.get("object_ref"))
    if not (subject_ref and predicate and object_ref):
        return None
    edge: dict = {
        "edge_kind": edge_kind,
        "subject_ref": subject_ref[:_MAX_REF],
        "predicate": predicate[:_MAX_PREDICATE],
        "object_ref": object_ref[:_MAX_REF],
    }
    valid_from = _positive_int(item.get("valid_from_chapter"))
    if valid_from is not None:
        edge["valid_from_chapter"] = valid_from
    valid_to = _positive_int(item.get("valid_to_chapter"))
    if valid_to is not None:
        edge["valid_to_chapter"] = valid_to
    return edge


def extract_continuity_edges(
    draft: str,
    *,
    context: NarrativeContext | None = None,
    chapter_ordinal: int | None = None,
) -> list[dict]:
    """调 LLM 把草稿抽成结构边；空草稿/模型异常/坏格式一律返回 []（fail-soft）。"""

    if not draft or not draft.strip():
        return []
    ctx = context if context is not None else NarrativeContext()
    prompt = build_continuity_edges_prompt(ctx, draft)
    try:
        raw = generate_text(prompt, temperature=planning_temperature(), model=planning_model())
    except Exception as exc:  # noqa: BLE001 — fail-soft：抽取失败不拖垮生成 run
        log.warning("continuity_edges_llm_failed", error=str(exc))
        return []
    edges = parse_continuity_edges(raw)
    if chapter_ordinal is not None and chapter_ordinal > 0:
        for edge in edges:
            edge.setdefault("valid_from_chapter", chapter_ordinal)
    return edges


def build_llm_continuity_submitter(
    approval_fields: Callable[[NovelLoopRequest, str], dict],
    *,
    context_for: Callable[[NovelLoopRequest], NarrativeContext] | None = None,
) -> Callable[[NovelLoopRequest, str, int], dict]:
    """组合 LLM 抽取器 + 第三刀 API 客户端，产出可注入的 submit_continuity 端口。

    approval_fields 提供批准端点要求的非边字段（previous_chapter_summary/style_drift 等），
    这些是调用方真相源数据，绝不由抽取器编造。无边时不发空批准（返回 {} 跳过 POST）。
    ContinuityGateRejected 不在此吞——按第三刀语义冒泡为章节失败。
    """

    def submit(request: NovelLoopRequest, draft: str, approved_scene_id: int) -> dict:
        context = context_for(request) if context_for is not None else None
        edges = extract_continuity_edges(draft, context=context, chapter_ordinal=request.chapter_index)
        if not edges:
            return {}
        payload = dict(approval_fields(request, draft))
        payload["chapter_id"] = request.chapter_id
        payload["continuity_edges"] = edges
        return post_chapter_approval(payload)

    return submit


def _strip_code_fences(raw: object) -> str:
    if not isinstance(raw, str):
        return ""
    text = raw.strip()
    if not text.startswith("```"):
        return text
    # 去掉首行 ``` 或 ```json，以及末行 ```
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _non_empty_str(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    return None
