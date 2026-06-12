from app.domains.book_runs.phase9c_narrative_smoke import (
    _auto_gate_results_from_book_export,
)


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
