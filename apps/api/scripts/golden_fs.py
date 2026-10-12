"""File-backed oracle harness shared by the P1 kernel groups (canon chain, scans, plans, ...).

Real Python domain functions run against synthetic project trees in an owned temporary
directory. Environment is whitelisted, settings are a stub without secrets, and an audit hook
denies network/processes plus any read or write outside the run directory, the app code and
the Python runtime. Each call records its output and the exact bytes it wrote or deleted.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace


def encoded(raw: bytes) -> dict:
    # Long single-byte runs become repeat chunks, so byte-budget fixtures stay small and lossless.
    chunks, literal, index = [], bytearray(), 0
    while index < len(raw):
        end = index
        while end < len(raw) and raw[end] == raw[index]:
            end += 1
        if end - index > 4096:
            if literal:
                chunks.append({"base64": base64.b64encode(bytes(literal)).decode(), "repeat": 1})
                literal.clear()
            chunks.append({"base64": base64.b64encode(raw[index:index + 1]).decode(), "repeat": end - index})
        else:
            literal += raw[index:end]
        index = end
    if literal or not chunks:
        chunks.append({"base64": base64.b64encode(bytes(literal)).decode(), "repeat": 1})
    return {"chunks": chunks}


def snapshot(root: Path) -> dict[str, bytes]:
    files = {}
    for directory, _dirs, names in os.walk(root):
        for name in names:
            path = Path(directory) / name
            files[path.relative_to(root).as_posix()] = path.read_bytes()
    return files


def tree_diff(before: dict[str, bytes], after: dict[str, bytes]) -> dict[str, dict | None]:
    changed = {path: encoded(raw) for path, raw in sorted(after.items()) if before.get(path) != raw}
    changed.update({path: None for path in sorted(before) if path not in after})
    return changed


def stable(value: object, root: Path) -> object:
    """Replace the owned absolute root so TS replays compare against its own synthetic root."""
    if isinstance(value, str):
        return value.replace(str(root), "$ROOT").replace(root.as_posix(), "$ROOT")
    if isinstance(value, dict):
        return {key: stable(item, root) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [stable(item, root) for item in value]
    return value


@contextmanager
def isolated_fs_oracle(prefix: str):
    api = Path(__file__).resolve().parents[1]
    repo = api.parents[1]
    owned = repo / "output/ts-engine-p1"
    owned.mkdir(parents=True, exist_ok=True)
    inherited = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR"}}
    os.environ.clear()
    os.environ.update(inherited)
    os.environ["PYDANTIC_DISABLE_PLUGINS"] = "__all__"
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(api))
    runtime_roots = [Path(sys.prefix), Path(sys.base_prefix)]
    with TemporaryDirectory(prefix=prefix, dir=owned) as temporary:
        run = Path(temporary)
        home = run / "home"
        home.mkdir()
        os.environ.update(HOME=str(home), USERPROFILE=str(home), TEMP=str(home), TMP=str(home))
        state = {"enabled": True}

        def guard(event: str, args: tuple) -> None:
            if not state["enabled"]:
                return
            if (event.startswith(("socket.", "subprocess.", "sqlite3.connect")) and event != "socket.gethostname") or event in {"os.system", "os.spawn"}:
                raise AssertionError(f"Oracle forbids {event}")
            writes = event in {"os.mkdir", "os.remove", "os.rmdir", "os.rename", "os.replace", "os.link", "os.symlink", "os.truncate"}
            if event not in {"open", "os.scandir", "os.listdir"} and not writes:
                return
            if event == "open":
                mode, flags = args[1:3]
                writes = (isinstance(mode, str) and any(flag in mode for flag in "wax+")) or (
                    isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
                )
            path_arg = args[0]
            if isinstance(path_arg, int):
                return  # fd opens (os.fdopen after mkstemp) were audited when the path was created
            path = Path(os.path.abspath(os.fsdecode(path_arg)))
            if path.is_relative_to(run):
                return
            if writes:
                raise AssertionError(f"Oracle forbids writes outside the run directory: {path}")
            code = (path.is_relative_to(api / "app") or (path == api and event != "open")) and (
                event != "open" or path.suffix in {".py", ".pyc", ".pyd"}
            )
            if path.name.startswith(".env") or not (code or any(path.is_relative_to(root) for root in runtime_roots)):
                raise AssertionError(f"Oracle forbids non-fixture read: {path}")

        sys.addaudithook(guard)
        previous_cwd = Path.cwd()
        try:
            for event, args in [("open", (str(repo / ".env"), "r", 0)), ("socket.connect", (None, None)),
                                ("open", (str(api / "app/forbidden.py"), "w", os.O_WRONLY))]:
                try:
                    sys.audit(event, *args)
                except AssertionError:
                    pass
                else:
                    raise AssertionError(f"Oracle audit self-test did not deny {event}")
            from app.common import config

            config.get_settings = lambda: SimpleNamespace()
            os.chdir(home)
            yield api, run
        finally:
            os.chdir(previous_cwd)
            state["enabled"] = False


class Project:
    """One synthetic project tree; calls run in order on the same tree and record their writes."""

    def __init__(self, run: Path, name: str, files: dict[str, bytes | str]):
        self.root = run / name
        self.root.mkdir()
        self.files = {path: data.encode() if isinstance(data, str) else data for path, data in files.items()}
        for path, raw in self.files.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        self.calls: list[dict] = []

    def call(self, fn: str, args: dict, run, *, errors: tuple = (), typed_args: bool = False) -> object:
        before = snapshot(self.root)
        row: dict = {"fn": fn, "args": args}
        if typed_args:
            # Keeps 2 vs 2.0 apart for the TS replay, which parses this text with its own JSON owner.
            row["args_json"] = json.dumps(args, ensure_ascii=False)
        result = None
        try:
            result = run()
            row["output_json"] = json.dumps(stable(result, self.root), ensure_ascii=False)
        except errors as error:
            row["error"] = {"type": type(error).__name__, "message": str(stable(str(error), self.root))}
        row["writes"] = tree_diff(before, snapshot(self.root))
        self.calls.append(row)
        return result

    def mutate(self, path: str, raw: bytes) -> None:
        """An author edit between calls; replayed from the recorded writes."""
        before = snapshot(self.root)
        (self.root / path).write_bytes(raw)
        self.calls.append({"fn": "author_write", "args": {"path": path}, "writes": tree_diff(before, snapshot(self.root))})

    def remove(self, path: str) -> None:
        """An author deletion between calls (for example an undone new chapter)."""
        before = snapshot(self.root)
        (self.root / path).unlink()
        self.calls.append({"fn": "author_write", "args": {"path": path}, "writes": tree_diff(before, snapshot(self.root))})

    def record(self, name: str) -> dict:
        return {"id": name, "files": {path: encoded(raw) for path, raw in sorted(self.files.items())}, "calls": self.calls}
