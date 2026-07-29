"""canon 写回三条红线：提案不被覆盖、伏笔有写入口、别名推得到模型和检索。

背景（2026-07-29 诊断）：

1. **提案被下次调用抹掉。** `canon_delta` 每次都从 canon.json 起头重建草稿再整文件覆盖
   `proposals.json`。提案不是从正文确定性重扫出来的（实体与声明由模型按**本轮**读到的
   章节传入），所以上一轮作者没点「并入」的提案在第二次调用后永久消失，不会自愈。

2. **伏笔账没有写入口。** `promise_check` 只读 `canon.json` 的 `invariants.promises`，
   而提案管线只覆盖 single_holder / lifespan / timeline_order——promises 永远进不了
   观测镜的「并入」按钮，作者除了手改 JSON 别无他法。长篇最容易失守的一环没有入口。

3. **别名推不到模型。** aliases 在 canon 里是一等字段（presence 重建、退场闸、dossier、
   前端联动全吃它），唯独两处把它丢了：硬约束头只推 canonical_name，`project.consistency`
   的 terms 完全靠模型自己列。于是作者手稿里管陈默叫「老陈」时，「「玄铁令」唯一持有者
   = 陈默」这条约束对全程称「老陈」的正文毫无约束力。
"""

from __future__ import annotations

import json
from pathlib import Path

from app.domains.agent_runs import canon_store
from app.domains.agent_runs.canon_context import build_scene_constraint_block
from app.domains.agent_runs.canon_delta import canon_delta, read_pending_proposals
from app.domains.agent_runs.promise_scan import promise_check
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.tools.project_checks_runtime import _with_canon_surface_forms


def _project(tmp_path: Path) -> Path:
    manuscript = tmp_path / "正文"
    manuscript.mkdir()
    (manuscript / "第001章.md").write_text("老陈把玄铁令收进怀里。", encoding="utf-8")
    (manuscript / "第002章.md").write_text("默哥站在雨里。", encoding="utf-8")
    canon_dir = tmp_path / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    (canon_dir / "canon.json").write_text(
        json.dumps(
            {
                "version": 1,
                "entities": [
                    {
                        "id": "chen-mo",
                        "canonical_name": "陈默",
                        "aliases": ["老陈", "默哥"],
                    }
                ],
                "invariants": {"single_holder": [{"item": "玄铁令", "holder": "chen-mo"}]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return tmp_path


def test_pending_proposals_survive_the_next_call(tmp_path: Path) -> None:
    """第二次调用绝不能把第一次留下的、作者还没并入的提案抹掉。"""

    root = _project(tmp_path)

    canon_delta(str(root), entities=[{"name": "林岚", "aliases": ["小林"]}])
    first = read_pending_proposals(str(root))
    assert [entity["canonical_name"] for entity in first["new_entities"]] == ["林岚"]

    # 作者一条都没并入，agent 读完下一章又提了个别的。
    canon_delta(str(root), entities=[{"name": "沈舟"}])
    second = read_pending_proposals(str(root))

    names = sorted(entity["canonical_name"] for entity in second["new_entities"])
    assert names == ["林岚", "沈舟"], "上一轮提案被本轮覆盖了"

    # 重复观察同一条不该攒出两份。
    canon_delta(str(root), entities=[{"name": "沈舟"}])
    third = read_pending_proposals(str(root))
    assert sorted(e["canonical_name"] for e in third["new_entities"]) == ["林岚", "沈舟"]


def test_merged_proposals_drop_out_by_diff(tmp_path: Path) -> None:
    """作者并入后差集自愈，不该因为「留着上一轮」而重复冒出来。"""

    root = _project(tmp_path)
    canon_delta(str(root), entities=[{"name": "林岚"}])
    pending = read_pending_proposals(str(root))
    merged_entity = pending["new_entities"][0]

    canon = canon_store.read_canon(str(root))
    canon["entities"].append(merged_entity)
    (root / ".storyforge" / "canon" / "canon.json").write_text(
        json.dumps(canon, ensure_ascii=False), encoding="utf-8"
    )

    canon_delta(str(root), entities=[{"name": "沈舟"}])
    after = read_pending_proposals(str(root))
    assert [e["canonical_name"] for e in after["new_entities"]] == ["沈舟"]


def test_promises_have_a_write_path_into_canon(tmp_path: Path) -> None:
    """伏笔账此前只读：`promise_check` 读 canon.json，而没有任何路径能写进去。"""

    root = _project(tmp_path)

    canon_delta(
        str(root),
        promise_claims=[
            {"title": "老陈答应过要还刀", "planted_chapter": 1, "due_chapter": 5},
            {"title": "地窖里的第二具尸体", "planted_chapter": 2, "due_chapter": None},
        ],
    )
    pending = read_pending_proposals(str(root))

    promises = pending["new_invariants"]["promises"]
    assert sorted(item["title"] for item in promises) == ["地窖里的第二具尸体", "老陈答应过要还刀"]
    assert all(item["id"].startswith("promise_") for item in promises), "id 须确定性派生"
    assert all(item["status"] == "planted" for item in promises)
    # 显式 null 的开放窗口必须原样保留，否则 promise_check 会把它当没设到期反复问。
    open_window = next(item for item in promises if item["title"] == "地窖里的第二具尸体")
    assert open_window["due_chapter"] is None

    # 并入 canon.json 后 promise_check 立刻记得上账（模拟前端「并入」按钮写回）。
    canon = canon_store.read_canon(str(root))
    canon.setdefault("invariants", {})["promises"] = promises
    (root / ".storyforge" / "canon" / "canon.json").write_text(
        json.dumps(canon, ensure_ascii=False), encoding="utf-8"
    )
    assert promise_check(str(root))["promise_count"] == 2


def test_promise_claims_reject_a_due_chapter_before_it_was_planted(tmp_path: Path) -> None:
    root = _project(tmp_path)

    try:
        canon_delta(
            str(root),
            promise_claims=[{"title": "倒着走的伏笔", "planted_chapter": 9, "due_chapter": 2}],
        )
    except Exception as exc:  # noqa: BLE001 - 断言的就是它必须拒绝
        assert "due_chapter" in str(exc)
    else:
        raise AssertionError("due_chapter 早于 planted_chapter 必须拒绝")


def test_hard_constraints_name_the_aliases(tmp_path: Path) -> None:
    """只推本名时，模型不知道正文里的「老陈」就是约束说的「陈默」。"""

    root = _project(tmp_path)

    block = build_scene_constraint_block(str(root), str(root / "正文" / "第002章.md"))

    assert block is not None
    assert "陈默" in block
    assert "老陈" in block, "别名必须一起推给模型"
    assert "默哥" in block


def test_consistency_terms_expand_from_canon(tmp_path: Path) -> None:
    """称谓一致性正是这把工具该抓的，而别名只存在于 canon.json 里。"""

    root = _project(tmp_path)

    expanded = _with_canon_surface_forms(str(root), ["玄铁令"])

    assert expanded[0] == "玄铁令", "作者传入的词序在前（30 词上限先来先得）"
    assert {"陈默", "老陈", "默哥"} <= set(expanded)

    # canon 缺失时原样返回，不得因此炸掉一致性扫描。
    assert _with_canon_surface_forms(str(tmp_path / "无此项目"), ["玄铁令"]) == ["玄铁令"]


def test_consistency_handler_actually_uses_the_expanded_terms(tmp_path: Path) -> None:
    """光有函数不算数——本轮反复抓的就是「写好了但没接线」。

    这一条走真正的工具 handler：模型只传了「玄铁令」，扫描结果里仍须出现别名词条，
    否则说明 `_with_canon_surface_forms` 没被接进 `_project_consistency`。
    """

    root = _project(tmp_path)
    runtime = AgentRuntime.__new__(AgentRuntime)

    result = runtime._project_consistency(None, {"project_root": str(root), "terms": ["玄铁令"]})

    scanned_terms = {item["term"] for item in result.output["term_occurrences"]}
    assert "玄铁令" in scanned_terms
    assert {"陈默", "老陈", "默哥"} <= scanned_terms, "canon 别名没被接进一致性扫描"
