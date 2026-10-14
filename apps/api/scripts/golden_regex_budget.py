"""Regex budget oracle (P3-7a): the real `search_project` / `project_knowledge_search` loops over `SearchMatcher`
with a scripted regex engine and a virtual monotonic clock.

Each line of the synthetic files is a distinct token; the scenario scripts, per token, how long the regex runs and
whether it hits. A run longer than the per-line timeout raises TimeoutError the way the `regex` module does. Recorded:
the tool output or error, and the tokens the regex was asked about (in order) — that pins the per-line timeout, the
2 s total budget, and where the loops stop once `max_matches` is reached.
"""

from __future__ import annotations

import functools
import hashlib
import os
import re
from types import SimpleNamespace

from golden_fs import Project, isolated_fs_oracle

SOURCES = [
    "app/domains/agent_runs/fs_safety.py",
    "app/domains/agent_runs/fs_tools.py",
    "app/domains/agent_runs/fs/project_knowledge.py",
]


def lines(prefix: str, count: int) -> str:
    return "".join(f"{prefix}{index}\n" for index in range(count))


def scenarios() -> list[dict]:
    """timings: token -> [seconds, hit]; tokens not listed take 0.001 s and miss."""
    s = []
    many = {"正文/a.md": lines("a", 6), "正文/b.md": lines("b", 6), "正文/c.md": lines("c", 4)}
    s.append({"id": "hits-under-budget", "fn": "search", "files": many, "max_matches": 50,
              "timings": {"a1": [0.002, True], "b0": [0.01, True], "c3": [0.001, True]}})
    s.append({"id": "max-matches-stops-mid-file", "fn": "search", "files": many, "max_matches": 2,
              "timings": {"a0": [0.001, True], "a2": [0.001, True], "a4": [0.001, True], "b1": [0.001, True]}})
    s.append({"id": "max-matches-filled-at-file-end", "fn": "search", "files": many, "max_matches": 2,
              "timings": {"a4": [0.001, True], "a5": [0.001, True], "b3": [0.001, True], "c0": [0.001, True]}})
    s.append({"id": "single-line-timeout", "fn": "search", "files": many, "max_matches": 50,
              "timings": {"a1": [0.001, True], "b2": [0.06, True]}})
    s.append({"id": "line-just-over-timeout", "fn": "search", "files": many, "max_matches": 50,
              "timings": {"a3": [0.055, True]}})
    s.append({"id": "line-exactly-at-timeout", "fn": "search", "files": many, "max_matches": 50,
              "timings": {"a3": [0.05, True]}})
    # 1/32 s is exact in binary: 64 lines spend exactly 2 s, so the 65th line check finds no budget left.
    slow = {"正文/slow.md": lines("s", 70)}
    s.append({"id": "budget-exhausted", "fn": "search", "files": slow, "max_matches": 50,
              "timings": {f"s{index}": [1 / 32, index % 7 == 0] for index in range(70)}})
    # The last allowed line gets min(50 ms, remaining) as its timeout.
    s.append({"id": "timeout-capped-by-remaining-budget", "fn": "search", "files": slow, "max_matches": 50,
              "timings": {**{f"s{index}": [0.049, False] for index in range(40)}, "s40": [0.045, True]}})
    s.append({"id": "budget-spans-files", "fn": "search",
              "files": {"正文/a.md": lines("a", 40), "正文/b.md": lines("b", 40)}, "max_matches": 50,
              "timings": {**{f"a{index}": [1 / 32, index == 3] for index in range(40)},
                          **{f"b{index}": [1 / 32, index == 2] for index in range(40)}}})
    s.append({"id": "budget-ends-exactly-at-file-end", "fn": "search",
              "files": {"正文/a.md": lines("a", 64), "正文/b.md": lines("b", 2)}, "max_matches": 50,
              "timings": {**{f"a{index}": [1 / 32, index == 63] for index in range(64)}, "b0": [0.0, True]}})
    s.append({"id": "substring-ignores-timings", "fn": "search", "files": many, "max_matches": 50,
              "use_regex": False, "query": "b", "timings": {"a1": [5.0, True]}})
    s.append({"id": "empty-file-costs-nothing", "fn": "search",
              "files": {"正文/a.md": "", "正文/b.md": lines("b", 2)}, "max_matches": 50,
              "timings": {"b1": [0.03, True]}})
    knowledge = {"设定/规则.md": lines("k", 5), "人物/主角.md": lines("p", 5)}
    s.append({"id": "knowledge-hits", "fn": "knowledge", "files": knowledge, "max_matches": 20,
              "timings": {"k1": [0.002, True], "p4": [0.002, True]}})
    s.append({"id": "knowledge-max-matches", "fn": "knowledge", "files": knowledge, "max_matches": 1,
              "timings": {"k0": [0.001, True], "k3": [0.001, True], "p0": [0.001, True]}})
    s.append({"id": "knowledge-timeout", "fn": "knowledge", "files": knowledge, "max_matches": 20,
              "timings": {"k2": [0.2, True]}})
    return s


def p3_regex_budget_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-regex-budget-") as (api, run):
        from app.domains.agent_runs import fs_safety
        from app.domains.agent_runs.fs import project_knowledge as pk
        from app.domains.agent_runs.fs_tools import FsToolError, fs_search

        clock = {"now": 100.0}
        state: dict = {"timings": {}, "asked": []}

        class ScriptedPattern:
            def search(self, line, timeout):
                state["asked"].append(line)
                seconds, hit = state["timings"].get(line, [0.001, False])
                if seconds > timeout:
                    clock["now"] += timeout
                    raise TimeoutError("regex timed out")
                clock["now"] += seconds
                return SimpleNamespace() if hit else None

        fs_safety.regex = SimpleNamespace(compile=lambda _query, _flags: ScriptedPattern(), VERSION0=0,
                                          error=re.error)
        fs_safety.monotonic = lambda: clock["now"]

        records = []
        for spec in scenarios():
            project = Project(run, spec["id"], spec["files"])
            state["timings"], state["asked"] = spec["timings"], []
            clock["now"] = 100.0
            args = {"query": spec.get("query", "x"), "use_regex": spec.get("use_regex", True),
                    "max_matches": spec["max_matches"]}
            search = (functools.partial(fs_search, glob="*.md") if spec["fn"] == "search"
                      else pk.project_knowledge_search)
            project.call(spec["fn"], args, functools.partial(search, str(project.root), **args),
                         errors=(FsToolError,))
            record = project.record(spec["id"])
            records.append({**record, "fn": spec["fn"], "timings": spec["timings"], "asked": state["asked"]})
        return {
            "format_version": 1,
            "suite": "p3-regex-budget",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "scenarios": records,
        }
