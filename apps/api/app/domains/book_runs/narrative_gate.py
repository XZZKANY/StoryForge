from __future__ import annotations

import re

_CHAPTER_HEADING_RE = re.compile(r"^\s*##\s*第\s*(\d+)\s*章(?:\s+.*)?\s*$")

_REQUIRED_CONTRACT_FIELDS = [
    "cost",
    "relationship_delta",
    "irreversible_consequence",
    "existing_clues_reinterpreted",
]


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

    chapter_facts = {
        chapter_number: _chapter_template_fact(chapter_text)
        for chapter_number, chapter_text in chapters
    }
    template_chapters = [
        chapter_number
        for chapter_number, fact in chapter_facts.items()
        if fact["is_template"]
    ]

    return [
        {
            "gate": "collapse_judge",
            "status": "fail" if template_chapters else "pass",
            "revision_type": "structure_revision",
            "template_chapters": template_chapters,
            "contract_evidence": _contract_evidence(template_chapters, chapter_facts),
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


def _chapter_template_fact(chapter_text: str) -> dict[str, object]:
    bucket_patterns = {
        "arrival": ("来到", "走进", "回到", "进入", "抵达", "推开", "到了"),
        "inquiry": ("询问", "问完话", "问完", "盘问", "追问", "打听", "查问", "问她", "问他", "问起"),
        "inspection": ("查看", "翻看", "比对", "核对", "记录", "日志", "登记表", "收据", "笔记本", "册子", "金属片", "纸页", "纽扣"),
        "stash": ("收进口袋", "收入口袋", "收进内袋", "放进内袋", "装进口袋", "揣进", "塞进", "收好"),
        "transition": ("转去下一处", "转向下一处", "去下一处", "往下一处", "赶往下一处", "前往旧港", "朝灯塔走去", "朝码头走去", "转身离开"),
    }
    raw_evidence = {
        bucket: _literal_hits(chapter_text, patterns)
        for bucket, patterns in bucket_patterns.items()
    }
    bucket_hits = [bucket for bucket, hits in raw_evidence.items() if hits]
    cost = _literal_hits(
        chapter_text,
        ("错过", "失去", "失效", "撤回", "撤销", "收回", "拒绝", "不再", "放弃", "被迫", "无法", "代价", "推迟", "暂缓"),
    )
    relationship_delta = _literal_hits(
        chapter_text,
        ("关系", "信任", "防备", "决裂", "同盟", "合作", "互相试探", "替她作证", "拒绝再替", "不再提供"),
    )
    irreversible_consequence = _literal_hits(
        chapter_text,
        ("确认", "锁定", "公开事实", "正式", "永久", "不可逆", "改写", "重写", "公开", "封存", "被撤销", "意识到"),
    )
    existing_clues_reinterpreted = _existing_clue_reinterpretation_hits(chapter_text)
    has_structural_protection = bool(
        cost
        or relationship_delta
        or irreversible_consequence
        or existing_clues_reinterpreted
    )
    concrete_detail = _concrete_detail_signals(chapter_text)
    return {
        "bucket_hits": bucket_hits,
        "bucket_hit_count": len(bucket_hits),
        "raw_evidence": raw_evidence,
        "cost": cost,
        "relationship_delta": relationship_delta,
        "irreversible_consequence": irreversible_consequence,
        "existing_clues_reinterpreted": existing_clues_reinterpreted,
        "concrete_detail": concrete_detail,
        # 套路化的真信号是「流程骨架重复且空洞」。命中≥3 动作桶只是骨架嫌疑；
        # 但含具体锚点（多个数字证据 / 时间戳 / 直接对话）的章节是不可互换的实写正文，
        # 仅因含「回到/查看/转身离开」这类高频动词就判套路会系统性误报真章（30 章长跑 CH3/4 即此）。
        # 故判套路要求：动作桶≥3 且 无剧情推进 且 无具体锚点。
        "is_template": (
            len(bucket_hits) >= 3
            and not has_structural_protection
            and not concrete_detail
        ),
    }


def _concrete_detail_signals(text: str) -> list[str]:
    """检测「章节独有的具体事实锚点」——区分实写正文与可互换的流程占位骨架。

    占位骨架（如「林岚来到X，询问Y，查看Z，收好W，转去下一处」）抽象、无数字、无对话；
    实写正文含具体数字证据、时间戳、直接引语。任一信号命中即视为有具体内容，不判套路。
    """

    signals: list[str] = []
    if len(re.findall(r"\d+", text)) >= 3:
        signals.append("multiple_numeric_evidence")
    if re.search(r"\d{1,2}[:：]\d{2}", text):
        signals.append("timestamp")
    if len(re.findall(r"[“”「」]", text)) >= 2:
        signals.append("direct_dialogue")
    return signals


def _literal_hits(text: str, needles: tuple[str, ...]) -> list[str]:
    return [needle for needle in needles if needle and needle in text]


def _existing_clue_reinterpretation_hits(text: str) -> list[str]:
    clue_terms = ("已有", "既有", "旧航图", "黑盒", "盐蚀芯片", "旧线索", "旧判断")
    reinterpret_terms = ("重新", "重释", "解释", "对上", "误判", "意识到", "改写", "确认", "指向")
    if not any(term in text for term in clue_terms) or not any(term in text for term in reinterpret_terms):
        return []
    hits = [term for term in (*clue_terms, *reinterpret_terms) if term in text]
    if re.search(r"(已有|既有|旧航图|黑盒|盐蚀芯片|旧线索|旧判断).{0,40}(重新|重释|解释|对上|误判|意识到|改写|确认|指向)", text):
        hits.append("clue_reinterpreted_within_40_chars")
    return hits


def _contract_evidence(
    template_chapters: list[int],
    chapter_facts: dict[int, dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "source": "narrative_fact_heuristic",
        "template_chapters": list(template_chapters),
        "required_fields": list(_REQUIRED_CONTRACT_FIELDS),
        "beat_fulfillment": "unknown",
        "chapter_facts": {
            str(chapter_number): fact
            for chapter_number, fact in (chapter_facts or {}).items()
        },
    }
