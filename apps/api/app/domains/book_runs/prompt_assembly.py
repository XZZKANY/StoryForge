"""读 DB → 填注入键的装配层。

把 Character Bible / Style Pack / Blueprint / 活跃 Memory Atom 编译成
workflow prompts.context.narrative_context_from_state 可消费的注入键字典。
本层只读数据库、产出纯 dict，不 import workflow（API venv 无 langgraph），
真正的分层 prompt 渲染由 workflow_prompt_bridge 跨进程边界完成。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domains.blueprints.models import BookBlueprint
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.character_bible.service import list_character_bible_entries
from app.domains.judge.service import compute_book_style_baseline
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import get_active_memory_atoms
from app.domains.style_packs.service import list_style_packs

_STYLE_PACK_TONE_KEYS = ("语气", "tone")
_STYLE_PACK_POV_KEYS = ("视角", "pov")
_STYLE_PACK_TENSE_KEYS = ("时态", "tense")
_STYLE_PACK_RULE_KEYS = ("规则", "rules")
_STYLE_PACK_FORBIDDEN_KEYS = ("禁用表达", "forbidden_phrases")
_STYLE_PACK_EXAMPLE_KEYS = ("示例句", "example_sentences")


def assemble_prompt_injection(
    session: Session,
    *,
    book_id: int,
    chapter_id: int | None = None,
    chapter_title: str | None = None,
    chapter_goal: str | None = None,
) -> dict[str, Any]:
    """读取作品级一致性数据，产出 narrative_context_from_state 注入键字典。

    缺失的源（无 Character Bible / Style Pack / Blueprint / Memory Atom）直接省略对应键，
    交由 context 适配层退化处理，绝不伪造空对象。
    """

    state: dict[str, Any] = {}

    blueprint = _latest_blueprint(session, book_id)
    if blueprint is not None:
        _apply_blueprint(state, blueprint)

    characters = _character_constraints(session, book_id)
    if characters:
        state["character_constraints"] = characters

    style = _style_directive(session, book_id)
    if style:
        state["style_directive"] = style

    # 风格指纹前馈：已批准章节存在时，把基线指纹注入 style_directive，让续写主动对齐既定声音。
    fingerprint = compute_book_style_baseline(session, book_id)
    if fingerprint:
        state.setdefault("style_directive", {})["fingerprint"] = fingerprint

    continuity = _continuity_facts(session, book_id, chapter_id)
    if continuity:
        state["continuity_facts"] = continuity

    chapter_title = _clean(chapter_title)
    if chapter_title:
        state["chapter_title_ref"] = chapter_title
    chapter_goal = _clean(chapter_goal)
    if chapter_goal:
        state["chapter_goal_ref"] = chapter_goal

    return state


def _latest_blueprint(session: Session, book_id: int) -> BookBlueprint | None:
    return (
        session.query(BookBlueprint)
        .filter(BookBlueprint.book_id == book_id)
        .order_by(BookBlueprint.version.desc(), BookBlueprint.id.desc())
        .first()
    )


def _apply_blueprint(state: dict[str, Any], blueprint: BookBlueprint) -> None:
    premise = _clean(blueprint.premise)
    if premise:
        state["premise"] = premise
    tone = _clean(blueprint.tone)
    if tone:
        state["strategy_tone_ref"] = tone
    metadata = blueprint.metadata_ if isinstance(blueprint.metadata_, dict) else {}
    title_seed = _clean(metadata.get("title_seed"))
    if title_seed:
        state["strategy_title_ref"] = title_seed


def _character_constraints(session: Session, book_id: int) -> list[dict[str, Any]]:
    entries = list_character_bible_entries(session, book_id=book_id)
    constraints: list[dict[str, Any]] = []
    for entry in entries:
        constraint = _character_constraint(entry)
        if constraint:
            constraints.append(constraint)
    return constraints


def _character_constraint(entry: CharacterBibleEntry) -> dict[str, Any] | None:
    name = _clean(entry.canonical_name)
    if not name:
        return None
    constraint: dict[str, Any] = {"name": name}
    aliases = _str_list(entry.aliases)
    if aliases:
        constraint["aliases"] = aliases
    voice = _flatten_trait_values(entry.voice_traits)
    if voice:
        constraint["voice_traits"] = voice
    forbidden = _flatten_trait_values(entry.forbidden_traits)
    if forbidden:
        constraint["forbidden_traits"] = forbidden
    return constraint


def _style_directive(session: Session, book_id: int) -> dict[str, Any]:
    packs = list_style_packs(session, book_id)
    if not packs:
        return {}
    payload = packs[-1].payload if isinstance(packs[-1].payload, dict) else {}
    directive: dict[str, Any] = {}
    tone = _first_str(payload, _STYLE_PACK_TONE_KEYS)
    if tone:
        directive["tone"] = tone
    pov = _first_str(payload, _STYLE_PACK_POV_KEYS)
    if pov:
        directive["pov"] = pov
    tense = _first_str(payload, _STYLE_PACK_TENSE_KEYS)
    if tense:
        directive["tense"] = tense
    rules = _first_list(payload, _STYLE_PACK_RULE_KEYS)
    if rules:
        directive["rules"] = rules
    forbidden = _first_list(payload, _STYLE_PACK_FORBIDDEN_KEYS)
    if forbidden:
        directive["forbidden_phrases"] = forbidden
    examples = _first_list(payload, _STYLE_PACK_EXAMPLE_KEYS)
    if examples:
        directive["example_sentences"] = examples
    return directive


def _continuity_facts(session: Session, book_id: int, chapter_id: int | None) -> list[dict[str, Any]]:
    if chapter_id is None:
        return []
    atoms = get_active_memory_atoms(session, book_id=book_id, chapter_id=chapter_id)
    facts: list[dict[str, Any]] = []
    for atom in atoms:
        statement = _atom_statement(atom)
        if not statement:
            continue
        facts.append(
            {
                "statement": statement,
                "must_appear": bool(atom.immutable),
                "source_ref": _clean(atom.source_ref),
            }
        )
    return facts


def _atom_statement(atom: MemoryAtom) -> str:
    value = _clean(atom.value)
    if not value:
        return ""
    entity = _clean(atom.entity_id)
    return f"{entity}：{value}" if entity else value


def _flatten_trait_values(value: object) -> list[str]:
    """把 Character Bible 的 voice/forbidden JSON 递归拍平成短语列表（跳过替换映射）。"""

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        flat: list[str] = []
        for item in value:
            flat.extend(_flatten_trait_values(item))
        return _unique(flat)
    if isinstance(value, dict):
        flat = []
        for key, item in value.items():
            if str(key) in {"替换", "replacements", "replacement_text"}:
                continue
            flat.extend(_flatten_trait_values(item))
        return _unique(flat)
    return []


def _first_str(payload: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        text = _clean(payload.get(key))
        if text:
            return text
    return ""


def _first_list(payload: dict[str, Any], keys: tuple[str, ...]) -> list[str]:
    for key in keys:
        values = _str_list(payload.get(key))
        if values:
            return values
    return []


def _str_list(value: object) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (list, tuple)):
        return _unique([_clean(item) for item in value if _clean(item)])
    return []


def _clean(value: object) -> str:
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value).strip())


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        cleaned = value.strip() if isinstance(value, str) else str(value)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            out.append(cleaned)
    return out
