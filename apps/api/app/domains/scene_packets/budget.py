from __future__ import annotations

from typing import Any

from app.domains.assets.models import Asset
from app.domains.continuity.models import ContinuityRecord
from app.domains.scene_packets.packet_contract import ScenePacketBody
from app.domains.scene_packets.schemas import BudgetStatistics, EvidenceLinkRead, ScenePacketCreate


def estimate_tokens(value: Any) -> int:
    """用轻量字符近似估算预算，避免引入额外分词依赖。"""

    text = str(value)
    return max(1, (len(text) + 5) // 6)


def build_packet(
    payload: ScenePacketCreate,
    chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    evidence_links: list[EvidenceLinkRead],
) -> tuple[ScenePacketBody, BudgetStatistics]:
    """按优先级构造固定槽位，并控制检索片段的预算占用。"""

    characters = [asset_summary(asset) for asset in assets if asset.asset_type == "character"]
    foreshadowing = [asset_summary(asset) for asset in assets if asset.asset_type == "foreshadowing"]
    style_rules = [style_rule(asset) for asset in assets if asset.asset_type == "style_rule"]
    include_facts = collect_payload_values(assets, "必须包含事实") + continuity_constraints(continuity_records)
    avoid_facts = collect_payload_values(assets, "必须规避事实")
    packet: ScenePacketBody = {
        "章节目标": payload.scene_goal,
        "活跃角色": characters,
        "关系状态": relationship_states(assets),
        "未回收伏笔": foreshadowing,
        "风格规则": style_rules,
        "必须包含事实": include_facts,
        "必须规避事实": avoid_facts,
        "用户意图": payload.user_intent,
        "证据链接": [link.model_dump() for link in evidence_links],
        "上一章摘要": continuity_values(continuity_records, "previous_chapter_summary"),
        "章节摘要": chapter.summary,
    }
    budget_packet = dict(packet)
    budget_packet["证据链接"] = []
    reserved_tokens = estimate_tokens(budget_packet)
    snippets, retrieval_tokens, truncated = fit_retrieval_snippets(payload.retrieval_snippets, payload.token_budget, reserved_tokens)
    packet["检索片段"] = snippets
    used_tokens = min(reserved_tokens + retrieval_tokens, payload.token_budget)
    statistics = BudgetStatistics(
        token_budget=payload.token_budget,
        used_tokens=used_tokens,
        reserved_tokens=reserved_tokens,
        retrieval_tokens=retrieval_tokens,
        truncated=truncated or reserved_tokens + retrieval_tokens > payload.token_budget,
    )
    return packet, statistics


def asset_summary(asset: Asset) -> dict[str, Any]:
    """输出资产摘要，保留类型、名称和结构化载荷。"""

    return {"id": asset.id, "type": asset.asset_type, "name": asset.name, "payload": asset.payload}


def style_rule(asset: Asset) -> dict[str, Any]:
    """风格规则槽位优先展示规则文本，同时保留来源资产。"""

    return {"id": asset.id, "name": asset.name, "rule": asset.payload.get("规则", asset.payload)}


def relationship_states(assets: list[Asset]) -> list[dict[str, Any]]:
    """从角色资产载荷中提取关系状态。"""

    return [
        {"asset_id": asset.id, "name": asset.name, "state": asset.payload["关系"]}
        for asset in assets
        if asset.asset_type == "character" and "关系" in asset.payload
    ]


def collect_payload_values(assets: list[Asset], key: str) -> list[Any]:
    """从资产载荷收集硬约束列表，保持输入顺序。"""

    values: list[Any] = []
    for asset in assets:
        raw_value = asset.payload.get(key)
        if isinstance(raw_value, list):
            values.extend(raw_value)
        elif raw_value is not None:
            values.append(raw_value)
    return values


def continuity_values(records: list[ContinuityRecord], record_type: str) -> list[Any]:
    """读取指定类型的连续性载荷。"""

    return [record.payload.get("value") for record in records if record.record_type == record_type]


def continuity_constraints(records: list[ContinuityRecord]) -> list[Any]:
    """下一章继承约束属于硬约束，预算不足时也必须保留。"""

    values: list[Any] = []
    for raw_value in continuity_values(records, "next_chapter_constraints"):
        if isinstance(raw_value, list):
            values.extend(raw_value)
        elif raw_value is not None:
            values.append(raw_value)
    return values


def fit_retrieval_snippets(
    snippets: list[str],
    token_budget: int,
    reserved_tokens: int,
) -> tuple[list[str], int, bool]:
    """只在剩余预算允许时加入检索片段，避免覆盖硬约束。"""

    remaining = max(token_budget - reserved_tokens, 0)
    selected: list[str] = []
    used = 0
    truncated = False
    for snippet in snippets:
        snippet_tokens = estimate_tokens(snippet)
        if used + snippet_tokens <= remaining:
            selected.append(snippet)
            used += snippet_tokens
        else:
            truncated = True
    return selected, used, truncated
