from app.domains.book_runs.phase9c_narrative_smoke import (
    _auto_gate_results_from_book_export,
    _chapter_template_fact,
)

REQUIRED_FIELDS = [
    "cost",
    "relationship_delta",
    "irreversible_consequence",
    "existing_clues_reinterpreted",
]


def test_phase9c_auto_gate_results_include_contract_evidence_fields() -> None:
    book_export = """
## 第 1 章
林岚来到档案室，询问管理员，查看记录，把登记表收进口袋，转身前往旧港。
## 第 2 章
林岚走进冷库，询问守门人，翻看册子，收好金属片，离开冷库。
## 第 3 章
林岚回到灯塔，问完话，查看日志，把纸页收进内袋，朝码头走去。
"""

    results = _auto_gate_results_from_book_export(book_export)

    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    assert collapse["revision_type"] == "structure_revision"
    assert collapse["contract_evidence"]["template_chapters"] == [1, 2, 3]
    assert collapse["contract_evidence"]["source"] == "narrative_fact_heuristic"


def test_phase9c_auto_gate_results_parse_title_bearing_chapter_headings() -> None:
    book_export = """
## 第 4 章 旧伤
林岚抵达档案室，询问管理员，查看日志，收好纸页，转身离开。
## 第 7 章 冷港
林岚进入旧港，盘问船员，翻看记录，把金属片收进口袋，朝灯塔走去。
"""

    results = _auto_gate_results_from_book_export(book_export)

    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    assert collapse["contract_evidence"]["template_chapters"] == [4, 7]


def test_phase9c_auto_gate_results_fail_when_no_chapters_are_parsed() -> None:
    results = _auto_gate_results_from_book_export("not a chapter\n# 第 一 章")

    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    assert collapse["status"] != "pass"
    assert collapse["reason"] == "no_chapters_parsed"
    assert collapse["contract_evidence"]["source"] == "narrative_fact_heuristic"
    assert collapse["contract_evidence"]["template_chapters"] == []
    assert collapse["contract_evidence"]["required_fields"] == REQUIRED_FIELDS


def test_phase9c_auto_gate_results_pass_valid_non_template_chapters_with_evidence() -> None:
    book_export = """
## 第 1 章 安静早晨
林岚在窗边整理书架，给朋友写信，随后坐下喝茶。
"""

    results = _auto_gate_results_from_book_export(book_export)

    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    assert collapse["status"] == "pass"
    assert collapse["contract_evidence"]["source"] == "narrative_fact_heuristic"
    assert collapse["contract_evidence"]["template_chapters"] == []
    assert collapse["contract_evidence"]["required_fields"] == REQUIRED_FIELDS


def test_phase9c_auto_gate_results_do_not_flag_conflict_cost_and_reinterpretation_as_template() -> None:
    chapter = (
        "林岚走进冷库，把旧航图摊在桌上。账房问她为什么还查第五区。\n"
        "她没有收新物证，只把黑盒里已有的失真曲线和旧航图空白处重新对上。\n"
        "账房当场撤回维修窗口，陈伯也拒绝再替她作证。\n"
        "她把纸袋按回桌面，意识到自己误判了旧盟约的效力。\n"
    )
    book_export = "\n".join(f"## 第 {index} 章\n{chapter}" for index in range(1, 7))

    results = _auto_gate_results_from_book_export(book_export)
    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    fact = _chapter_template_fact(chapter)

    assert collapse["status"] == "pass"
    assert collapse["contract_evidence"]["template_chapters"] == []
    assert fact["is_template"] is False
    assert fact["cost"]
    assert fact["relationship_delta"]
    assert fact["existing_clues_reinterpreted"]


def test_phase9c_auto_gate_results_include_raw_bucket_evidence_for_template_chapters() -> None:
    book_export = "\n".join(
        f"## 第 {index} 章\n林岚到了码头。她问完人，查看登记表，把纸页收进内袋，转去下一处。"
        for index in range(1, 4)
    )

    results = _auto_gate_results_from_book_export(book_export)
    collapse = next(item for item in results if item["gate"] == "collapse_judge")
    evidence = collapse["contract_evidence"]

    assert collapse["template_chapters"] == [1, 2, 3]
    assert evidence["template_chapters"] == [1, 2, 3]
    assert set(evidence["chapter_facts"]) == {"1", "2", "3"}
    first_fact = evidence["chapter_facts"]["1"]
    assert first_fact["bucket_hit_count"] >= 3
    assert first_fact["is_template"] is True
    assert "arrival" in first_fact["bucket_hits"]
    assert "inquiry" in first_fact["bucket_hits"]
    assert first_fact["raw_evidence"]["arrival"]


def test_phase9c_auto_gate_results_required_fields_are_fresh_per_call() -> None:
    first = _auto_gate_results_from_book_export("## 第 1 章\n林岚整理书架。")
    second = _auto_gate_results_from_book_export("## 第 2 章\n林岚整理书架。")

    first_collapse = next(item for item in first if item["gate"] == "collapse_judge")
    second_collapse = next(item for item in second if item["gate"] == "collapse_judge")

    first_collapse["contract_evidence"]["required_fields"].append("mutated")

    assert second_collapse["contract_evidence"]["required_fields"] == REQUIRED_FIELDS
