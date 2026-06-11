"""Incremental registry for narrative names and aliases."""

from __future__ import annotations

from dataclasses import dataclass, field

from storyforge_workflow.narrative.verdict import GateVerdict, issue


@dataclass
class _NameRecord:
    identity_id: str
    display_name: str
    chapters: set[int] = field(default_factory=set)
    role: str = ""
    aliases: set[str] = field(default_factory=set)


class NameRegistry:
    def __init__(self) -> None:
        self._by_display: dict[str, str] = {}
        self._by_alias: dict[str, str] = {}
        self._records: dict[str, _NameRecord] = {}

    def record(
        self,
        *,
        identity_id: str,
        display_name: str,
        chapter: int,
        aliases: list[str] | tuple[str, ...] = (),
        role: str = "",
    ) -> GateVerdict:
        clean_name = display_name.strip()
        clean_identity = identity_id.strip()
        if clean_name in self._by_display and self._by_display[clean_name] != clean_identity:
            return GateVerdict(
                status="fail",
                issues=[
                    issue(
                        "名称注册",
                        f"同一显示名指向不同身份: {clean_name}",
                        snippet=clean_name,
                    )
                ],
            )
        for alias in aliases:
            clean_alias = alias.strip()
            if clean_alias in self._by_alias and self._by_alias[clean_alias] != clean_identity:
                return GateVerdict(
                    status="fail",
                    issues=[
                        issue(
                            "名称注册",
                            f"同一别名指向不同身份: {clean_alias}",
                            snippet=clean_alias,
                        )
                    ],
                )
        self._by_display[clean_name] = clean_identity
        record = self._records.setdefault(
            clean_identity,
            _NameRecord(identity_id=clean_identity, display_name=clean_name, role=role),
        )
        record.chapters.add(chapter)
        if role:
            record.role = role
        for alias in aliases:
            clean_alias = alias.strip()
            if clean_alias:
                self._by_alias[clean_alias] = clean_identity
                record.aliases.add(clean_alias)
        return GateVerdict(status="pass", issues=[])

    def audit(self) -> GateVerdict:
        issues = [
            issue(
                "名称注册",
                f"single-use clue-only character: {record.display_name}",
                severity="中",
                snippet=record.display_name,
                suggestion="合并为既有人物、物件线索，或补足后续功能。",
                revision_strategy="scene_patch",
            )
            for record in self._records.values()
            if record.role == "clue_only" and len(record.chapters) == 1
        ]
        if issues:
            return GateVerdict(status="warn", issues=issues)
        return GateVerdict(status="pass", issues=[])
