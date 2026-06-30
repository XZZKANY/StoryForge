from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.domains.character_bible.service import list_character_bible_entries
from app.domains.story_state.models import StoryStateLedger
from app.domains.story_state.schemas import StateChangeInput

_CHANGES_BLOCK_RE = re.compile(
    r"\n?\s*【STORY_STATE_CHANGES】\s*(?P<json>\[.*?\])\s*【/STORY_STATE_CHANGES】\s*",
    re.DOTALL,
)
STORY_STATE_CHANGES_TOOL_NAME = "record_story_state_changes"


@dataclass(frozen=True)
class StoryStateRosterEntry:
    """Writer 可引用的故事状态实体花名册条目。"""

    entity_kind: str
    entity_id: str
    canonical_name: str
    aliases: tuple[str, ...] = ()

    @property
    def surface_forms(self) -> tuple[str, ...]:
        return tuple(_clean_strings([self.canonical_name, *self.aliases]))


def append_story_state_changes_instruction(
    prompt: str,
    *,
    roster: Sequence[StoryStateRosterEntry] | None = None,
) -> str:
    """给 Writer 一个可被后端剥离的章末 CHANGES JSON 通道。"""

    roster_section = _story_state_roster_prompt(roster or [])
    instruction = (
        """

【章末状态变化】
正文写完后，如本章产生人物状态、地点状态、物品流转、伏笔、秘密、关系或时间线变化，
请在正文之后追加一个可选区块。无明确变化时返回空数组。
"""
        + roster_section
        + """

【STORY_STATE_CHANGES】
[
  {
    "change_type": "character.status",
    "entity_kind": "character",
    "entity_id": "人物或稳定ID",
    "canonical_name": "正文中的名称",
    "surface_forms": ["正文中确实出现的表面词"],
    "payload": {"status": "一句可接地的状态变化"}
  }
]
【/STORY_STATE_CHANGES】

区块必须是 JSON 数组；所有 surface_forms 必须能在正文中找到。花名册已有实体必须使用其 entity_id；新实体用正文名称声明 canonical_name，后端会铸造稳定 ID。不要把这个区块写入正文叙事内部。
"""
    )
    return prompt + instruction


def extract_story_state_changes_from_content(content: str) -> tuple[str, list[dict[str, object]]]:
    """从模型正文里剥离可选 CHANGES 区块；解析失败时保留正文并返回空 changes。"""

    match = _CHANGES_BLOCK_RE.search(content)
    if match is None:
        return content, []
    raw_json = match.group("json")
    try:
        decoded = json.loads(raw_json)
    except json.JSONDecodeError:
        return content, []
    if not isinstance(decoded, list):
        return content, []
    changes = [item for item in decoded if _is_mapping_dict(item)]
    cleaned = (content[: match.start()] + content[match.end() :]).strip()
    return cleaned, changes


def story_state_changes_tools() -> list[dict[str, object]]:
    """OpenAI-compatible tool schema for structured StoryState CHANGES."""

    change_schema: dict[str, object] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "change_type": {"type": "string", "description": "例如 character.status / item.transfer / foreshadow.plant"},
            "entity_kind": {"type": "string", "description": "character / location / item / foreshadow / world_rule 等"},
            "entity_id": {"type": "string", "description": "优先使用花名册里的稳定 entity_id"},
            "object_id": {"type": "string", "description": "可选：关系或物品流转的另一端稳定 ID"},
            "canonical_name": {"type": "string", "description": "正文中可读名称"},
            "surface_forms": {
                "type": "array",
                "items": {"type": "string"},
                "description": "必须能在正文中找到的表面词",
            },
            "aliases": {"type": "array", "items": {"type": "string"}},
            "payload": {"type": "object", "additionalProperties": True},
        },
        "required": ["change_type", "entity_kind", "entity_id", "surface_forms", "payload"],
    }
    return [
        {
            "type": "function",
            "function": {
                "name": STORY_STATE_CHANGES_TOOL_NAME,
                "description": "记录本章正文已经明确发生的故事状态变化；无变化时不要调用。",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"changes": {"type": "array", "items": change_schema}},
                    "required": ["changes"],
                },
            },
        }
    ]


def extract_story_state_changes_from_tool_calls(tool_calls: object) -> list[dict[str, object]]:
    """从 OpenAI-compatible tool_calls 中读取 StoryState CHANGES。"""

    if not isinstance(tool_calls, list):
        return []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        function = call.get("function")
        if not isinstance(function, dict) or function.get("name") != STORY_STATE_CHANGES_TOOL_NAME:
            continue
        arguments = _decode_tool_arguments(function.get("arguments"))
        if not isinstance(arguments, dict):
            continue
        changes = arguments.get("changes")
        if not isinstance(changes, list):
            continue
        return [item for item in changes if _is_mapping_dict(item)]
    return []


def _decode_tool_arguments(arguments: object) -> object:
    if isinstance(arguments, dict):
        return arguments
    if not isinstance(arguments, str) or not arguments.strip():
        return None
    try:
        return json.loads(arguments)
    except json.JSONDecodeError:
        return None


def build_story_state_roster(
    session: Session,
    *,
    book_id: int,
    book_run_id: int | None,
    chapter_pov: str | None = None,
    chapter_location: str | None = None,
    max_entries: int = 30,
) -> list[StoryStateRosterEntry]:
    """从当前态、Character Bible 与本章上下文构建稳定 ID 花名册。"""

    entries: list[StoryStateRosterEntry] = []
    ledgers = session.scalars(
        select(StoryStateLedger)
        .where(StoryStateLedger.book_id == book_id)
        .where(
            StoryStateLedger.book_run_id == book_run_id
            if book_run_id is not None
            else StoryStateLedger.book_run_id.is_(None)
        )
        .order_by(StoryStateLedger.last_chapter.desc(), StoryStateLedger.id)
    ).all()
    for ledger in ledgers:
        entries.append(
            StoryStateRosterEntry(
                entity_kind=ledger.entity_kind,
                entity_id=ledger.entity_id,
                canonical_name=ledger.canonical_name,
                aliases=tuple(_clean_strings(ledger.aliases)),
            )
        )

    # Global ledgers can seed new runs; run-scoped ledgers above still win on dedupe.
    if book_run_id is not None:
        global_ledgers = session.scalars(
            select(StoryStateLedger)
            .where(StoryStateLedger.book_id == book_id)
            .where(or_(StoryStateLedger.book_run_id.is_(None), StoryStateLedger.book_run_id == book_run_id))
            .order_by(StoryStateLedger.last_chapter.desc(), StoryStateLedger.id)
        ).all()
        for ledger in global_ledgers:
            entries.append(
                StoryStateRosterEntry(
                    entity_kind=ledger.entity_kind,
                    entity_id=ledger.entity_id,
                    canonical_name=ledger.canonical_name,
                    aliases=tuple(_clean_strings(ledger.aliases)),
                )
            )

    for entry in list_character_bible_entries(session, book_id=book_id):
        entries.append(
            StoryStateRosterEntry(
                entity_kind="character",
                entity_id=stable_story_state_entity_id("character", entry.canonical_name),
                canonical_name=entry.canonical_name,
                aliases=tuple(_clean_strings(entry.aliases)),
            )
        )
    if chapter_pov:
        entries.append(
            StoryStateRosterEntry(
                entity_kind="character",
                entity_id=stable_story_state_entity_id("character", chapter_pov),
                canonical_name=chapter_pov,
            )
        )
    if chapter_location:
        entries.append(
            StoryStateRosterEntry(
                entity_kind="location",
                entity_id=stable_story_state_entity_id("location", chapter_location),
                canonical_name=chapter_location,
            )
        )
    return _dedupe_roster(entries)[:max_entries]


def normalize_story_state_changes_with_roster(
    changes: Sequence[Mapping[str, object]],
    roster: Sequence[StoryStateRosterEntry],
) -> list[dict[str, object]]:
    """把模型自由名 CHANGES 归一到花名册稳定 ID；新实体幂等铸造 ID。"""

    normalized: list[dict[str, object]] = []
    for change in changes:
        item = dict(change)
        entity_kind = _text_value(item.get("entity_kind"))
        if entity_kind is None:
            normalized.append(item)
            continue
        entry = _match_roster_entry(item, roster)
        if entry is not None:
            item["entity_id"] = entry.entity_id
            item["canonical_name"] = entry.canonical_name
            item["aliases"] = _clean_strings([*entry.aliases, *(_text_list(item.get("aliases")))])
        else:
            canonical_name = _text_value(item.get("canonical_name")) or _text_value(item.get("entity_id"))
            if canonical_name:
                item["entity_id"] = stable_story_state_entity_id(entity_kind, canonical_name)
                item["canonical_name"] = canonical_name
        object_id = _text_value(item.get("object_id"))
        if object_id:
            object_entry = _match_roster_text(object_id, roster)
            if object_entry is not None:
                item["object_id"] = object_entry.entity_id
        normalized.append(item)
    return normalized


def validate_story_state_change_dicts(changes: Sequence[Mapping[str, object]]) -> tuple[list[dict[str, object]], list[str]]:
    """校验 CHANGES schema，返回可提交 dict 与供模型重试的错误摘要。"""

    valid: list[dict[str, object]] = []
    errors: list[str] = []
    for index, change in enumerate(changes, start=1):
        try:
            item = StateChangeInput.model_validate(change)
        except ValidationError as exc:
            first_error = exc.errors()[0] if exc.errors() else {"msg": str(exc)}
            location = ".".join(str(part) for part in first_error.get("loc", ())) or "root"
            errors.append(f"第 {index} 条 {location}: {first_error.get('msg')}")
            continue
        valid.append(item.model_dump(exclude_none=True))
    return valid, errors


def stable_story_state_entity_id(entity_kind: str, canonical_name: str) -> str:
    """按实体类型与名称幂等生成稳定 ID，避免 Writer 自由名漂移。"""

    kind = _normalized_key(entity_kind) or "entity"
    name = " ".join(canonical_name.split()).strip()
    digest = hashlib.sha1(f"{kind}:{name}".encode()).hexdigest()[:10]
    return f"{kind}:{digest}"


def _is_mapping_dict(value: object) -> bool:
    return isinstance(value, dict) and all(isinstance(key, str) for key in value)


def _story_state_roster_prompt(roster: Sequence[StoryStateRosterEntry]) -> str:
    if not roster:
        return ""
    lines = ["", "【故事状态花名册】", "已有实体请直接使用下列 entity_id："]
    for entry in roster[:30]:
        aliases = "、".join(entry.aliases) if entry.aliases else "无"
        lines.append(
            f"- {entry.entity_kind} | entity_id={entry.entity_id} | canonical_name={entry.canonical_name} | aliases={aliases}"
        )
    return "\n".join(lines)


def _dedupe_roster(entries: Sequence[StoryStateRosterEntry]) -> list[StoryStateRosterEntry]:
    result: list[StoryStateRosterEntry] = []
    for entry in entries:
        if not entry.entity_kind or not entry.entity_id or not entry.canonical_name:
            continue
        match_index = _find_roster_match_index(result, entry)
        if match_index is None:
            result.append(entry)
            continue
        current = result[match_index]
        result[match_index] = StoryStateRosterEntry(
            entity_kind=current.entity_kind,
            entity_id=current.entity_id,
            canonical_name=current.canonical_name,
            aliases=tuple(_clean_strings([*current.aliases, *entry.aliases, entry.canonical_name])),
        )
    return result


def _find_roster_match_index(
    entries: Sequence[StoryStateRosterEntry],
    target: StoryStateRosterEntry,
) -> int | None:
    target_surfaces = {_normalized_key(item) for item in target.surface_forms}
    for index, entry in enumerate(entries):
        if entry.entity_kind != target.entity_kind:
            continue
        if entry.entity_id == target.entity_id:
            return index
        if target_surfaces & {_normalized_key(item) for item in entry.surface_forms}:
            return index
    return None


def _match_roster_entry(
    change: Mapping[str, object],
    roster: Sequence[StoryStateRosterEntry],
) -> StoryStateRosterEntry | None:
    entity_kind = _text_value(change.get("entity_kind"))
    if entity_kind is None:
        return None
    candidates = _clean_strings(
        [
            change.get("entity_id"),
            change.get("canonical_name"),
            *_text_list(change.get("surface_forms")),
            *_text_list(change.get("aliases")),
        ]
    )
    for candidate in candidates:
        entry = _match_roster_text(candidate, roster, entity_kind=entity_kind)
        if entry is not None:
            return entry
    return None


def _match_roster_text(
    value: str,
    roster: Sequence[StoryStateRosterEntry],
    *,
    entity_kind: str | None = None,
) -> StoryStateRosterEntry | None:
    normalized = _normalized_key(value)
    for entry in roster:
        if entity_kind is not None and entry.entity_kind != entity_kind:
            continue
        if normalized == _normalized_key(entry.entity_id):
            return entry
        if normalized in {_normalized_key(item) for item in entry.surface_forms}:
            return entry
    return None


def _text_value(value: object) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        if normalized:
            return normalized
    return None


def _text_list(value: object) -> list[str]:
    if isinstance(value, str):
        return _clean_strings([value])
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        return _clean_strings(value)
    return []


def _clean_strings(values: Sequence[object]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _normalized_key(value: str) -> str:
    return value.strip().lower()
