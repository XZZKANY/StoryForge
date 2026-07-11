"""Hook 差量提案：把模型观察到的叙事承诺与既有 hooks 做确定性归并。

LLM 调用本工具时传入结构化观测项；本模块不读正文、不调 LLM，只做：
1. 参数字段校验
2. 对证据文本做正则模式检测（叙事承诺信号）
3. 与 hooks.json 既有钩子去重合并
4. 输出新增与重复钩子清单（不写盘，提案由作者/agent 审阅后调用 write_hooks）
"""

from __future__ import annotations

import re
from typing import Any

from app.domains.agent_runs.canon_store import read_hooks
from app.domains.agent_runs.fs_tools import FsToolError

# 叙事承诺信号的确定性正则规则：匹配成功 ≈ 潜在钩子（低精度高召回，用于提示而非判决）。
_NARRATIVE_PROMISE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # "如果...就..." 条件承诺
    (re.compile(r"(?:如果|只要|一旦).{1,60}(?:就|便|则|一定|必然|必定)"), "conditional_promise"),
    # 倒计时
    (re.compile(r"(?:还剩|仅剩|还有|只有).{0,20}(?:天|日|小时|分钟|秒|年|月)"), "countdown"),
    # 里程碑 / 阈值
    (re.compile(r"(?:达到|突破|升到|攒够|达到|触发).{0,20}(?:触发|开启|解锁|激活|便会|即可)"), "threshold"),
    # 约定 / 誓言
    (re.compile(r"(?:答应|承诺|发誓|保证|约定|立誓|许诺).{0,50}(?:一定|会|要|必)"), "oath"),
    # 悬疑引入
    (re.compile(r"(?:有个.{0,15}(?:秘密|谜团|真相|隐情)|有.{0,10}人.{0,8}(?:身份|来历|目的|秘密))"), "mystery"),
    # 禁忌 / 规则
    (re.compile(r"(?:绝不能|严禁|切勿|千万不能).{0,40}(?:否则|一旦|不然|后果)"), "taboo"),
    # 角色未知信息
    (re.compile(r"(?:不知道的是|殊不知|无人知晓|没有人知道|只有.*知道)"), "hidden_info"),
]


def _find_pattern_matches(text: str) -> list[dict[str, Any]]:
    """对文本跑正则模式，返回检测到的潜在叙事承诺信号。"""
    matches: list[dict[str, Any]] = []
    for pattern, category in _NARRATIVE_PROMISE_PATTERNS:
        for m in pattern.finditer(text):
            matched = m.group().strip()
            if len(matched) < 4:
                continue  # 太短的不可能是语义钩子
            matches.append({
                "evidence": matched[:80],
                "category": category,
                "position": m.start(),
            })
    return matches


def _is_similar_to_existing(desc: str, existing_hooks: list[dict[str, Any]]) -> bool:
    """简单的描述去重：检查 desc 是否与某个既有 hook 的描述核心词重叠明显。"""
    desc_lower = desc.lower().strip()
    if not desc_lower:
        return True  # 空描述视为重复（不应提交）
    for existing in existing_hooks:
        existing_desc = (existing.get("description") or "").lower().strip()
        if not existing_desc:
            continue
        # 一方是另一方的子串
        if desc_lower in existing_desc or existing_desc in desc_lower:
            return True
        # 共享超过 60% 的中文字符（通过交集长度判断）
        desc_chars = {c for c in desc_lower if "一" <= c <= "鿿"}
        existing_chars = {c for c in existing_desc if "一" <= c <= "鿿"}
        if desc_chars and existing_chars:
            overlap = len(desc_chars & existing_chars)
            if overlap / max(len(desc_chars), len(existing_chars)) > 0.6:
                return True
    return False


def _validate_observed_hooks(observed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """校验并规范化观测钩子列表（纯函数，无副作用）。"""
    validated: list[dict[str, Any]] = []
    for index, entry in enumerate(observed):
        if not isinstance(entry, dict):
            raise FsToolError(f"observed_hooks[{index}] 必须是对象。")
        desc = entry.get("description")
        if not isinstance(desc, str) or not desc.strip():
            raise FsToolError(f"observed_hooks[{index}].description 必须是非空字符串。")
        verified = {
            "description": desc.strip(),
            "status": "active",
        }
        verification = entry.get("verification")
        if isinstance(verification, str) and verification.strip():
            verified["verification"] = verification.strip()
        category = entry.get("category")
        if isinstance(category, str) and category.strip():
            verified["category"] = category.strip()
        note = entry.get("note")
        if isinstance(note, str) and note.strip():
            verified["note"] = note.strip()
        validated.append(verified)
    return validated


def hooks_delta(
    project_root: str,
    *,
    observed_hooks: list[dict[str, Any]] | None = None,
    evidence_text: str | None = None,
) -> dict[str, Any]:
    """把 LLM 观测的叙事承诺钩子与既有 hooks 做确定性归并。

    observed_hooks: LLM 从正文读到的钩子（非壳全部使用正则，而是 LLM 判断 + 本模块辅助）。
    evidence_text: 可选的正文片段，本模块会在其上跑正则模式检测辅助信号。

    返回：new_hooks（新钩子清单）、duplicates（已有钩子被重复观测）、
          pattern_hits（正则模式命中的辅助信号，无 LLM），及 summary 消息。
    """
    try:
        existing = read_hooks(project_root)
    except FsToolError:
        existing = {"version": 1, "hooks": []}

    existing_hooks: list[dict[str, Any]] = existing.get("hooks") or []
    if not isinstance(existing_hooks, list):
        existing_hooks = []

    pattern_hits: list[dict[str, Any]] = []

    # 正则检测（辅助信号，不主导决策）
    if isinstance(evidence_text, str) and evidence_text.strip():
        pattern_hits = _find_pattern_matches(evidence_text)

    # 去重合并
    new_hooks: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    if observed_hooks:
        validated = _validate_observed_hooks(observed_hooks)
        for hook in validated:
            if _is_similar_to_existing(hook["description"], existing_hooks + new_hooks):
                duplicates.append(hook)
            else:
                new_hooks.append(hook)

    summary_parts: list[str] = []
    if new_hooks:
        summary_parts.append(f"检测到 {len(new_hooks)} 条新钩子")
    if duplicates:
        summary_parts.append(f"{len(duplicates)} 条已存在于 hooks.json")
    if pattern_hits:
        summary_parts.append(f"正则模式命中 {len(pattern_hits)} 处（辅助参考）")
    if not new_hooks and not pattern_hits:
        summary_parts.append("本章未发现新的叙事承诺信号")

    return {
        "new_hooks": new_hooks,
        "duplicates": duplicates,
        "pattern_hits": pattern_hits,
        "summary": "；".join(summary_parts) + "；确认后使用 canon_store.write_hooks 写入 hooks.json。",
    }
