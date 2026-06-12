from __future__ import annotations

import re

_CHAPTER_HEADING_RE = re.compile(r"^\s*##\s*第\s*(\d+)\s*章(?:\s+.*)?\s*$")

_REQUIRED_CONTRACT_FIELDS = [
    "cost",
    "relationship_delta",
    "irreversible_consequence",
    "existing_clues_reinterpreted",
]

_INVESTIGATION_TEMPLATE_BUCKETS = (
    ("来到", "走进", "回到", "进入", "抵达"),
    ("询问", "问完话", "问话", "盘问"),
    ("查看", "翻看", "记录", "日志", "登记表", "金属片", "纸页"),
    ("收进口袋", "收好", "收进内袋"),
    ("转身", "前往", "离开", "朝", "走去"),
)


def _auto_gate_results_from_book_export(book_export: str) -> list[dict[str, object]]:
    chapters = _parse_markdown_chapters(book_export)
    if not chapters:
        return [
            {
                "gate": "collapse_judge",
                "status": "fail",
                "reason": "no_chapters_parsed",
                "message": "No markdown chapter headings were parsed from book export.",
                "revision_type": "structure_revision",
                "contract_evidence": _contract_evidence([]),
            }
        ]

    template_chapters = [
        chapter_number
        for chapter_number, chapter_text in chapters
        if _investigation_template_score(chapter_text) >= 3
    ]

    return [
        {
            "gate": "collapse_judge",
            "status": "fail" if template_chapters else "pass",
            "revision_type": "structure_revision",
            "contract_evidence": _contract_evidence(template_chapters),
        }
    ]


def _parse_markdown_chapters(book_export: str) -> list[tuple[int, str]]:
    chapters: list[tuple[int, list[str]]] = []
    current_chapter: tuple[int, list[str]] | None = None

    for line in book_export.splitlines():
        heading_match = _CHAPTER_HEADING_RE.match(line)
        if heading_match:
            current_chapter = (int(heading_match.group(1)), [])
            chapters.append(current_chapter)
            continue

        if current_chapter is not None:
            current_chapter[1].append(line)

    return [
        (chapter_number, "\n".join(lines).strip())
        for chapter_number, lines in chapters
    ]


def _investigation_template_score(chapter_text: str) -> int:
    return sum(
        1
        for terms in _INVESTIGATION_TEMPLATE_BUCKETS
        if any(term in chapter_text for term in terms)
    )


def _contract_evidence(template_chapters: list[int]) -> dict[str, object]:
    return {
        "source": "narrative_fact_heuristic",
        "template_chapters": list(template_chapters),
        "required_fields": list(_REQUIRED_CONTRACT_FIELDS),
    }
