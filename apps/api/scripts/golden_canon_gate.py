"""Real canon_gate.check oracle on synthetic declarations/presence, with no domain IO."""
from __future__ import annotations

import hashlib
import json
import random
import sys

from golden_pure import pure_kernel_oracle, typed_json


def p1_canon_gate_snapshot() -> dict:
    with pure_kernel_oracle() as (api, state):
        from app.domains.agent_runs.canon_gate import check

        source = "app/domains/agent_runs/canon_gate.py"
        sources = {source: hashlib.sha256((api / source).read_bytes()).hexdigest()}
        "".encode("utf-32-le")  # Load fixture codec before execution-phase IO denial.
        state["executing"] = True
        cases = []

        def add(name, canon, presence=None, *, raw_presence=False):
            # Freeze the actual json.loads boundary, not Python-only object aliases.
            inputs = [json.dumps(canon, ensure_ascii=True), json.dumps(presence if presence is not None else {})]
            if raw_presence:
                inputs[1] = json.dumps(presence, ensure_ascii=False).encode("utf-32-le", errors="surrogatepass")
            values = [json.loads(text) for text in inputs]
            before = [typed_json(value) for value in values]
            row = {"id": name, "canon_json": inputs[0]}
            row["presence_bytes_hex" if raw_presence else "presence_json"] = inputs[1].hex() if raw_presence else inputs[1]
            try:
                row["output"] = typed_json(check(*values))
            except (TypeError, AttributeError, KeyError, UnicodeEncodeError) as error:
                row["error"] = {"type": type(error).__name__, "message": str(error)}
            assert before == [typed_json(value) for value in values], name
            cases.append(row)

        def holders(name, left, right, **fields):
            add(name, {"invariants": {"single_holder": [
                {"item": "刀", "holder": left, **fields}, {"item": "刀", "holder": right, **fields}]}})

        add("empty", {})
        add("all-three", {"invariants": {
            "single_holder": [{"item": "断魂刀", "holder": "char_b", "from_chapter": 3, "to_chapter": 10},
                              {"item": "断魂刀", "holder": "char_a", "from_chapter": 8}],
            "timeline_order": [{"before": "血月夜", "after": "登基"}, {"before": "登基", "after": "血月夜"}],
            "lifespan": [{"entity": "char_a", "exits_after_chapter": 1, "reason": " 阵亡 "}]}},
            {"entities": [{"id": "char_a", "canonical_name": "青砚", "occurrences": [
                {"path": "正文/02.md", "chapter": 2, "first_line": 3}, {"path": "正文/01.md", "chapter": 1}]}]})
        values = [None, False, True, 0, 1, 1.0, 0.5, -0.0, 9007199254740993, 9007199254740992.0,
                  float("nan"), float("inf"), "a", "𠀀", "\ue000", [1, {"x": True}], [1.0, {"x": 1}],
                  {"a": 1, "b": 2}, {"b": 2.0, "a": True}, [float("nan")]]
        for i, left in enumerate(values):
            for j, right in enumerate(values):
                holders(f"holders-{i}-{j}", left, right)
        for start in [None, True, False, 0, 1, 1.0, 3, 10**9, 10**9+1, 10**40, "3"]:
            for end in [None, False, True, 0, 1, 1.0, 3, 10**9+1, 10**40, "3"]:
                add(f"window-{start!r}-{end!r}", {"invariants": {"single_holder": [
                    {"item": "刀", "holder": "a", "from_chapter": start, "to_chapter": end},
                    {"item": "刀", "holder": "b", "from_chapter": 3, "to_chapter": 3}]}})
        for text in ["", " ", "\x1c", "\ufeff", " 刀 ", "刀", "__proto__", "𠀀", "\ud800"]:
            add(f"item-{ascii(text)}", {"invariants": {"single_holder": [{"item": text, "holder": "a"}, {"item": text, "holder": "b"}]}})
        add("pair-group-order-duplicates", {"invariants": {"single_holder": [
            {"item": item, "holder": holder} for item, holder in [("z", "c"), ("a", "b"), ("z", "a"), ("a", "a"), ("z", "b"), ("z", "c")]]}})
        holders("holder-surrogate", "\ud800", "a")
        for length in [1, 2, 3, 64, 65, 66, 67, 130]:
            edges = [{"before": str(i), "after": str((i+1) % length)} for i in range(length)]
            for order, rows in [("forward", edges), ("reverse", list(reversed(edges)))]:
                add(f"cycle-{length}-{order}", {"invariants": {"timeline_order": rows}})
            add(f"chain-{length}", {"invariants": {"timeline_order": edges[:-1]}})
        rng = random.Random(20261013)
        for i in range(80):
            edges = [{"before": rng.choice(["a", "b", "c", "d", " e ", "", "\x1c", "\ufeff", "__proto__"]),
                      "after": rng.choice(["a", "b", "c", "d", " e ", "", "\x1c", "\ufeff", "__proto__"])} for _ in range(rng.randrange(12))]
            add(f"graph-{i}", {"invariants": {"timeline_order": edges}})
        add("cycle-surrogate", {"invariants": {"timeline_order": [{"before": "\ud800", "after": "\ud800"}]}})
        for exits in [None, True, False, -1, 0, 1, 1.0, 3, 10**40, "1"]:
            for chapter in [None, True, False, -1, 0, 1, 1.0, 2, 10**40, "2"]:
                add(f"lifespan-{exits!r}-{chapter!r}", {"invariants": {"lifespan": [{"entity": "e", "exits_after_chapter": exits}]}},
                    {"entities": [{"id": "e", "occurrences": [{"path": "p", "chapter": chapter}]}]})
        rule = {"invariants": {"lifespan": [{"entity": "e", "exits_after_chapter": 1, "reason": "原因"}]}}
        for i, name in enumerate([None, "", False, 0, [], {}, "名字", "\ud800", ["x", True], {"a": 1}, float("nan")]):
            add(f"canonical-name-{i}", rule, {"entities": [{"id": "e", "canonical_name": name,
                "occurrences": [{"path": {"opaque": 9007199254740993}, "chapter": 2, "first_line": [True, 1.0]}]}]})
        add("duplicate-last-wins", rule, {"entities": [{"id": "e", "occurrences": [{"path": "p", "chapter": 2}]}, {"id": "e"}]})
        add("duplicate-last-hits", rule, {"entities": [{"id": "e"}, {"id": "e", "occurrences": [{"path": "p", "chapter": 2}]}]})
        for i, shape in enumerate([None, False, 0, 0.0, "", [], {}, True, 7, 1.5, "x", [None, 7, {}, "x"], {"x": {}}]):
            add(f"invariants-shape-{i}", {"invariants": shape})
            for key in ["single_holder", "timeline_order", "lifespan"]:
                add(f"{key}-shape-{i}", {"invariants": {key: shape}})
            add(f"entities-shape-{i}", {}, {"entities": shape})
            add(f"occurrences-shape-{i}", rule, {"entities": [{"id": "e", "occurrences": shape}]})
        for i, identity in enumerate([None, 1, True, 1.5, float("nan"), [], {}, [1], {"x": 1}]):
            add(f"presence-id-{i}", {}, {"entities": [{"id": identity}]})
        add("missing-path", rule, {"entities": [{"id": "e", "occurrences": [{"chapter": 2}]}]})
        add("earlier-missing-path", rule, {"entities": [{"id": "e", "occurrences": [{"chapter": 1}]}]})
        add("empty-id", {"invariants": {"lifespan": [{"entity": "", "exits_after_chapter": -1}]}},
            {"entities": [{"id": "", "occurrences": [{"path": "", "chapter": 0}]}]})
        for start in [10**9, 10**9+1, 10**40]:
            holders(f"open-sentinel-{start}", "a", "b", from_chapter=start)
        for start in [False, 0.0, "0", None]:
            add(f"from-type-{start!r}", {"invariants": {"single_holder": [
                {"item": "刀", "holder": "a", "from_chapter": start, "to_chapter": 0},
                {"item": "刀", "holder": "b", "from_chapter": 0, "to_chapter": 0}]}})
        holders("surrogate-run", "😀\ud800\ud800", "a")
        add("occurrence-error-before-missing-path", rule, {"entities": [{"id": "e", "occurrences": [{"chapter": 2}, None]}]})
        add("raw-pair-presence-id", {"invariants": {"lifespan": [{"entity": "😀", "exits_after_chapter": 1}]}},
            {"entities": [{"id": "\ud83d\ude00", "occurrences": [{"path": "p", "chapter": 2}]}]}, raw_presence=True)
        add("raw-pair-name-and-hit", rule, {"entities": [{"id": "e", "canonical_name": "\ud83d\ude00", "occurrences": [
            {"path": "\ud83d\ude00", "chapter": 2, "first_line": "\ud800"}]}]}, raw_presence=True)
        assert "app.common.config" not in sys.modules
        return {"format_version": 1, "suite": "p1-canon-gate", "python": sys.version.split()[0], "sources": sources,
                "isolation": {"normal_domain_imports": True, "domain_io": "audit-denied", "network": "audit-denied",
                              "settings_imported": False, "inputs_unchanged": True,
                              "audit_self_tests": ["author-read", "network", "write"]}, "cases": cases}
