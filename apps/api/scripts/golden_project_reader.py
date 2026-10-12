"""Bounded real-filesystem oracle for the deterministic project-tree reader."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path
from tempfile import mkdtemp


def _fixtures() -> list[dict]:
    def action(name: str, **options: object) -> dict:
        return {"id": name, "visible": "nonhidden", "scope": ".", "explicit_files": [], **options}

    def fixture(name: str, *, files: list[str] | None = None, actions: list[dict] | None = None, **spec: object) -> dict:
        return {"id": name, "root": "p", "files": files or [], "directories": ["p"],
                "links": [], "hidden_entries": 0, "depth": 0,
                "actions": actions or [action("default")], **spec}

    return [
        fixture("empty", actions=[action("default"), action("zero-budget", max_entries=0)]),
        fixture("visibility-order", files=["p/a.md", "p/A2.md", "p/𠀀.md", "p/\ue000.md", "p/😀.md", "p/.hidden/x.md", "p/sub/b.md"],
                actions=[action("default"), action("all", visible="all"), action("subscope", scope="sub"),
                         action("hidden-scope", scope=".hidden"), action("hidden-explicit", explicit_files=[".hidden/x.md"]),
                         action("scope-file", scope="a.md"), action("scope-missing", scope="missing"),
                         action("scope-parent-outside", scope=".."), action("inside-parent-all", scope="sub/..", visible="all"),
                         action("inside-parent-hidden", scope="sub/.."), action("zero-budget", max_entries=0)]),
        fixture("missing-root", root="missing"),
        fixture("file-root", root="p/a.md", files=["p/a.md"]),
        fixture("entry-limit", hidden_entries=20_000),
        fixture("entry-over-limit", hidden_entries=20_001),
        fixture("depth-limit", depth=64),
        fixture("depth-over-limit", depth=65),
        fixture("scope-depth", files=["p/sub/d/a.md"], actions=[action("at-limit", scope="sub", max_depth=1), action("over-limit", scope="sub", max_depth=0)]),
        fixture("junction-roles", files=["p/real/a.md", "p/.hidden/h.md", "o/out.md"], directories=["p/real", "p/.hidden", "o"],
                links=[{"path": "p/alias", "target": "p/real", "kind": "junction"},
                       {"path": "p/hidden-alias", "target": "p/.hidden", "kind": "junction"},
                       {"path": "p/outside", "target": "o", "kind": "junction"}],
                actions=[action("default"), action("alias-scope", scope="alias"),
                         action("alias-explicit", explicit_files=["alias/a.md"]),
                         action("hidden-alias-explicit", explicit_files=["hidden-alias/h.md"]),
                         action("outside-explicit", explicit_files=["outside/out.md"]),
                         action("outside-scope", scope="outside")]),
        fixture("junction-root", root="r", files=["p/a.md"], links=[{"path": "r", "target": "p", "kind": "junction"}]),
        fixture("file-alias-roles", files=["p/real/a.md", "p/.hidden/h.md", "o/out.md"],
                links=[{"path": "p/alias.md", "target": "p/real/a.md", "kind": "file-symlink"},
                       {"path": "p/hidden-alias.md", "target": "p/.hidden/h.md", "kind": "file-symlink"},
                       {"path": "p/outside.md", "target": "o/out.md", "kind": "file-symlink"}],
                actions=[action("default"), action("explicit", explicit_files=["alias.md", "hidden-alias.md", "outside.md"])]),
    ]


def _owned_path(base: Path, relative: str) -> Path:
    value = Path(os.path.abspath(base / relative))
    if not value.is_relative_to(base) or value == base:
        raise AssertionError("Fixture path escaped its owned group")
    return value


def _materialize(group: Path, fixture: dict) -> dict | None:
    group.mkdir()
    for name in fixture["directories"]:
        _owned_path(group, name).mkdir(parents=True, exist_ok=True)
    files = list(fixture["files"])
    files += [f"p/.e{i:05}" for i in range(fixture["hidden_entries"])]
    if fixture["depth"]:
        files.append("p/" + "d/" * fixture["depth"] + "a.md")
    for name in files:
        path = _owned_path(group, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as target:
            target.write(b"synthetic\n" if name.endswith(".md") else b"")
    for link in fixture["links"]:
        path, target = _owned_path(group, link["path"]), _owned_path(group, link["target"])
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if link["kind"] == "junction":
                import _winapi
                _winapi.CreateJunction(str(target), str(path))
            else:
                path.symlink_to(target)
        except OSError as error:
            if link["kind"] == "file-symlink" and getattr(error, "winerror", None) == 1314:
                return {"operation": "file-symlink", "winerror": 1314}
            raise
    return None


def p1_reader_snapshot(fixture_root: Path | None = None) -> dict:
    if os.name != "nt":
        raise SystemExit("p1-reader currently records the Windows filesystem contract")
    api = Path(__file__).resolve().parents[1]
    repo = api.parents[1]
    owned = repo / "output/ts-engine-p1"
    owned.mkdir(parents=True, exist_ok=True)
    if fixture_root is None:
        run = Path(mkdtemp(prefix="reader-oracle-", dir=owned)).resolve()
    else:
        run = fixture_root.resolve()
        if not run.is_relative_to(owned.resolve()) or run == owned.resolve():
            raise ValueError("Reader fixtures must be a fresh directory below output/ts-engine-p1")
        run.mkdir()  # Exclusive: never mutate a previous run or an author tree.
    assert run.is_relative_to(owned.resolve())
    inherited = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR"}}
    os.environ.clear()
    os.environ.update(inherited)
    home = run / "home"
    home.mkdir()
    os.environ.update(HOME=str(home), USERPROFILE=str(home), TEMP=str(home), TMP=str(home))
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(api))
    state = {"enabled": True, "readonly": False, "group": None, "reads": Counter(), "writes": []}
    runtime = [Path(sys.prefix), Path(sys.base_prefix)]

    def guard(event: str, args: tuple) -> None:
        if not state["enabled"]:
            return
        if event.startswith(("socket.", "subprocess.", "sqlite3.connect")) or event in {"os.system", "os.spawn"}:
            raise AssertionError(f"Reader oracle forbids {event}")
        writes = event in {"os.mkdir", "os.remove", "os.rmdir", "os.rename", "os.link", "os.symlink", "os.truncate"}
        if event not in {"open", "os.scandir", "os.listdir"} and not writes:
            return
        if event == "open":
            mode, flags = args[1:3]
            writes = (isinstance(mode, str) and any(flag in mode for flag in "wax+")) or (isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)))
        if isinstance(args[0], int):
            raise AssertionError("Reader oracle forbids untracked descriptor access")
        path = Path(os.path.abspath(os.fsdecode(args[0])))
        if writes:
            if state["readonly"] or not path.is_relative_to(run):
                state["writes"].append(event)
                raise AssertionError(f"Reader oracle forbids write: {event}")
        elif path.is_relative_to(run):
            group = state["group"]
            if group is not None and path.is_relative_to(group):
                state["reads"][(event, path.relative_to(group).as_posix())] += 1
        elif path.name in {".env", ".env.local"} or not (
            ((path == api and event != "open") or path.is_relative_to(api / "app")) and (event != "open" or path.suffix in {".py", ".pyc", ".pyd"})
            or any(path.is_relative_to(base) for base in runtime)
        ):
            raise AssertionError(f"Reader oracle forbids non-fixture read: {path}")

    sys.addaudithook(guard)
    try:
        state["readonly"] = True
        for event, args in [("open", (str(repo / ".env"), "r", 0)), ("socket.connect", (None, None)),
                            ("open", (str(home / "forbidden"), "w", os.O_WRONLY))]:
            try:
                sys.audit(event, *args)
            except AssertionError:
                pass
            else:
                raise AssertionError("Reader audit self-test did not deny unsafe action")
        state["readonly"] = False
        state["writes"].clear()
        from app.common.project_tree import ProjectTreeError, scan_project_files

        fixtures = _fixtures()
        for fixture in fixtures:
            group = run / fixture["id"]
            skip = _materialize(group, fixture)
            fixture["skip"] = skip
            if skip is not None:
                continue
            state["readonly"] = True
            state["group"] = group
            root = _owned_path(group, fixture["root"]).resolve()
            for action in fixture["actions"]:
                state["reads"].clear()
                state["writes"].clear()
                def visible(path: Path, mode: str = action["visible"]) -> bool:
                    return mode == "all" or not any(part.startswith(".") for part in path.parts)
                kwargs = {name: action[name] for name in ["max_entries", "max_depth"] if name in action}
                try:
                    paths = scan_project_files(root, scope=root / action["scope"], visible=visible,
                                               explicit_files=action["explicit_files"], **kwargs)
                    action["output"] = [path.relative_to(root).as_posix() for path in paths]
                except ProjectTreeError as error:
                    action["error"] = {"name": type(error).__name__, "message": str(error)}
                action["read_trace"] = [{"operation": op, "path": path, "count": count} for (op, path), count in sorted(state["reads"].items())]
                action["write_trace"] = list(state["writes"])
                assert not action["write_trace"]
            state["readonly"] = False
            state["group"] = None
        sources = {"app/common/project_tree.py": hashlib.sha256((api / "app/common/project_tree.py").read_bytes()).hexdigest()}
        return {"format_version": 1, "suite": "p1-reader", "platform": "windows", "sources": sources,
                "isolation": {"network": "audit-denied", "domain_writes": "audit-denied", "author_reads": "audit-denied",
                              "trace_scope": "open/scandir/listdir; stat/resolve are not audited", "cleanup": "owned fixtures retained"},
                "fixtures": fixtures}
    finally:
        state["enabled"] = False
        (run / "execution.json").write_text(json.dumps({"fixture_root": str(run), "source": str(Path(__file__).resolve())}, indent=2) + "\n")
