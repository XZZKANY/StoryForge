"""Import-only filesystem access and execution-phase IO denial for pure kernel oracles."""
from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def pure_kernel_oracle():
    api = Path(__file__).resolve().parents[1]
    repo = api.parents[1]
    inherited = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR"}}
    os.environ.clear()
    os.environ.update(inherited)
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(api))
    state = {"enabled": True, "executing": False}
    runtime = [Path(sys.prefix), Path(sys.base_prefix)]

    def guard(event: str, args: tuple) -> None:
        if not state["enabled"]:
            return
        if event.startswith(("socket.", "subprocess.", "sqlite3.connect")) or event in {"os.system", "os.spawn"}:
            raise AssertionError("Pure oracle forbids network/process/database access")
        if event in {"os.remove", "os.rename", "os.mkdir", "os.rmdir", "os.truncate"}:
            raise AssertionError("Pure oracle forbids filesystem mutation")
        if event not in {"open", "os.scandir", "os.listdir"}:
            return
        if state["executing"]:
            raise AssertionError("Pure kernel must not perform IO")
        path_arg = args[0]
        if not isinstance(path_arg, (str, bytes, os.PathLike)):
            raise AssertionError("Pure oracle forbids file descriptors")
        path = Path(os.path.abspath(os.fsdecode(path_arg)))
        if event == "open" and args[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
            raise AssertionError("Pure oracle forbids writes")
        code = (path.is_relative_to(api / "app") or path == api) and (event != "open" or path.suffix in {".py", ".pyc", ".pyd"})
        if path.name.startswith(".env") or not (code or any(path.is_relative_to(root) for root in runtime)):
            raise AssertionError("Pure oracle forbids author/config reads")

    sys.addaudithook(guard)
    try:
        for event, args in [("open", (str(repo / ".env"), "r", 0)), ("socket.connect", (None, None)),
                            ("open", (str(api / "app/forbidden.py"), "w", os.O_WRONLY))]:
            try:
                sys.audit(event, *args)
            except AssertionError:
                pass
            else:
                raise AssertionError("Pure oracle denial self-test failed")
        yield api, state
    finally:
        state["enabled"] = False

def typed_json(value: object) -> dict:
    # Do not let JS JSON.parse erase Python integer/float identity or dict insertion order.
    if value is None:
        return {"kind": "null"}
    if isinstance(value, bool):
        return {"kind": "bool", "value": value}
    if isinstance(value, int):
        return {"kind": "int", "value": str(value)}
    if isinstance(value, float):
        return {"kind": "float", "value": repr(value)}
    if isinstance(value, str):
        return {"kind": "str", "value": [ord(char) for char in value]}
    if isinstance(value, (list, tuple)):
        return {"kind": "list", "value": [typed_json(item) for item in value]}
    if isinstance(value, dict):
        return {"kind": "dict", "value": [[[ord(char) for char in key], typed_json(item)] for key, item in value.items()]}
    raise AssertionError(type(value))


