"""File-backed, isolated book.context oracle. No mocks of domain readers or builders."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory

from golden_pure import typed_json as _typed


def _encoded(raw: bytes) -> dict:
    # Keep exact byte budgets cheap to review. A repeated prefix plus suffix is lossless.
    if len(raw) > 4096 and raw.count(raw[:1]) >= len(raw) - 32:
        count = len(raw) - len(raw.lstrip(raw[:1]))
        if count > 4096:
            return {"chunks": [
                {"base64": base64.b64encode(raw[:1]).decode(), "repeat": count},
                {"base64": base64.b64encode(raw[count:]).decode(), "repeat": 1},
            ]}
    return {"chunks": [{"base64": base64.b64encode(raw).decode(), "repeat": 1}]}


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_cases() -> list[dict]:
    cases = []
    texts = [
        ("numbers", "[0,-0,1,1.0,1e0,-0.0,9007199254740993,18446744073709551615]"),
        ("unicode-version-repr", '["\u1c89","\U0001fae9","\u00ad","\u2028","\ufeff"]'),
        ("float-format", "[1e-5,1e-4,1e15,1e16,1.234e20,1.23e-7,-0.0,5e-324,1.7976931348623157e308]"),
        ("float-specials", "[NaN,Infinity,-Infinity,1e400,-1e400,1e-400]"),
        ("dict-order-duplicates", '{"10":0,"2":1,"10":2,"__proto__":3,"constructor":4}'),
        ("containers", '[null,true,false,"𠀀😀",[],{},["x"],{"a":1}]'),
        ("escaped-surrogates", '["\\ud800","\\udc00","\\ud800\\udc00"]'),
        ("whitespace", ' \r\n\t{"a":1}\t\r\n '),
        ("text-bom", '\ufeff{"a":1}'),
        ("non-json-whitespace", '\u001c{"a":1}'),
        ("leading-zero", "01"), ("trailing-comma", "[1,]"),
        ("trailing-content", "{}[]"), ("lowercase-nan", "nan"),
        ("unescaped-control", '"a\x00b"'), ("bad-escape", '"\\x41"'),
    ]
    for name, value in texts:
        cases.append({"id": name, "mode": "text", "text": value})
    for encoding in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "utf-32", "utf-32-le", "utf-32-be"):
        raw = '["𠀀😀",1,1.0]'.encode(encoding)
        cases.append({"id": f"bytes-{encoding}", "mode": "bytes", **_encoded(raw)})
    for name, raw in [
        ("utf8-surrogatepass", b'["\xed\xa0\x80"]'),
        ("utf16-surrogatepass", b'\xff\xfe[\x00"\x00\x00\xd8"\x00]\x00'),
        ("utf32-surrogatepass", '["'.encode("utf-32-le") + b'\x00\xd8\x00\x00' + '"]'.encode("utf-32-le")),
        ("invalid-utf8", b'["\xff"]'), ("invalid-utf16", b'\xff\xfe[\x00\xff'),
        ("invalid-utf32", b'\x00\x00\xfe\xff\x00\x11\x00\x00'),
    ]:
        cases.append({"id": name, "mode": "bytes", **_encoded(raw)})
    for name, text in [
        ("raw-pair", '["\ud800\udc00"]'),
        ("raw-escaped", '["\ud800\\udc00"]'),
        ("escaped-raw", '["\\ud800\udc00"]'),
        ("mixed-runs", '["\ud800\ud800\udc00\udc00\U00010000"]'),
        ("dict-collisions", '{"\U00010000":1,"\ud800\udc00":2,"\U00010000":3}'),
        ("dict-pair-duplicate", '{"\ud800\udc00":1,"x":2,"\ud800\udc00":3}'),
        ("primitive-raw-pair", '"\ud800\udc00"'),
    ]:
        for encoding in ("utf-8", "utf-16-le", "utf-32-le"):
            cases.append({"id": f"{name}-{encoding}", "mode": "bytes",
                          **_encoded(text.encode(encoding, errors="surrogatepass"))})
    for case in cases:
        value = case.get("text") if case["mode"] == "text" else b"".join(
            base64.b64decode(chunk["base64"]) * chunk["repeat"] for chunk in case["chunks"]
        )
        try:
            parsed = json.loads(value)
            case["output"] = _typed(parsed)
            case["truthy"] = bool(parsed)
            case["string_codepoints"] = [ord(char) for char in str(parsed)]
        except (ValueError, RecursionError) as error:
            case["error"] = type(error).__name__
    return cases


def _redaction_cases() -> dict:
    # Called only inside the audited synthetic-settings process. Capture the owner's actual
    # ordered snapshot rather than recreating its set ordering in TS.
    from app.common.redaction import configured_secret_values, is_sensitive_key, redact_sensitive

    keys = ["", "apiKey", "APIKEY", "myapikeyvalue", "api-key", "api key", "api_token",
            "accessToken", "refresh-token", "auth token", "bearer token", "auth", "token",
            "authtoken", "password", "passwd", "credential", "credentials", "secret",
            "nestedSecretValue", "tokenCount", "authStatus", "hasSecret", "isPassword",
            "has", "is", "apiKeyAvailable", "secret_configured", "tokenEnabled",
            "passwordPresent", "credentialRequired", "secretStatus", "secretStatusValue",
            "HAS_SECRET", "APIKey", "apikey_available", "\u0130secret", "key\ud800\udc00",
            "hasSecret-secret", "issecret", "is_secret_secret"]
    cases = []

    def add(name: str, value: object, extra: tuple = (), passes: int = 1) -> None:
        configured = configured_secret_values(extra)
        output = value
        for _ in range(passes):
            output = redact_sensitive(output, extra_secrets=extra)
        cases.append({"id": name, "input": _typed(value), "context": [[ord(char) for char in secret] for secret in configured],
                      "passes": passes, "output": _typed(output)})

    add("keys-recursive", {key: {"safe": "unchanged", "secret": "private"} for key in keys})
    add("primitives", [None, True, False, 0, 1.0, -0.0, 2**64, [], {}])
    add("settings-sources", " | ".join(["synthetic-oracle-api-key", "synthetic-oracle-jwt-secret",
        "synthetic-oracle-llm-key", "synthetic-oracle-embedding-key", "synthetic-oracle-s3-secret",
        "synthetic-oracle-access"]))
    os.environ["ORACLE_API_KEY"] = "literal-from-env!"
    os.environ["ORACLE_CREDENTIAL"] = "literal-env-credential!"
    os.environ["ORACLE_HARMLESS"] = "harmless-env-value!"
    try:
        add("env-sources", "literal-from-env! literal-env-credential! harmless-env-value!")
    finally:
        for key in ["ORACLE_API_KEY", "ORACLE_CREDENTIAL", "ORACLE_HARMLESS"]:
            del os.environ[key]
    add("literal-length-order", "abcde abcdef abcdefghi abcdefabcdef", ("abcde", "abcdef", "abcdefghi", "abcdef", None))
    add("literal-regex-characters", ".*[x]+$? .* [x] +$?", (".*[x]+$?",))
    add("literal-overlap", "aaaaaaa aaaaaaaaaaaa aaaaaab", ("aaaaaa",))
    add("literal-equal-length-order", "abcdefghij bcdefghijk", ("abcdef", "bcdefg"))
    add("literal-codepoint-length", "😀😀😀 😀😀😀😀😀😀 \ud800\udc00\ud800\udc00\ud800\udc00", ("😀😀😀", "😀😀😀😀😀😀", "\ud800\udc00\ud800\udc00\ud800\udc00"))
    for passes in (1, 2, 3):
        add(f"repeated-{passes}", {"secret": "private", "text": "REDACTED", "status": "[REDACTED]"}, ("REDACTED",), passes)
    assignments = ["api-key", "api_key", "api key", "APIKEY", "authorization", "bearer", "token",
                   "password", "secret", "credential", "ſecret", "apİ_Key", "APı KEY"]
    add("assignments", [f"{key}{sep}{value}" for key in assignments for sep in ("=", ": ", "\u001c:\u0085")
                        for value in ("abcde", "abcdef", "secret", "İıſKab", "a._:/+=@-b")])
    add("bearer", ["Bearer " + value for value in ("abcde", "abcdef", "BEARER", "Bearer", "bearer", "İıſKab")])
    add("assignment-whole-match-replacement", ["secret=secret", "SECRET=secret", "Bearer Bearer", "bearer bearer", "authorization=authorization"])
    tokens = ["sk-a123456", "sk-a12345", "sk-a123456---", "secret-abcd", "secret-abc", "ſecret-İıſK",
              "token-a.-_", "token-___-", "ghp_" + "a" * 20, "ghp_" + "a" * 19,
              "xoxb-" + "a" * 10, "xoxb-" + "a" * 9, "AIza" + "a" * 20, "AIza" + "a" * 19]
    for i, boundary in enumerate(["", " ", ".", "-", "_", "a", "中", "\u0301", "\u1c89", "𐀀", "😀", "\ud800\udc00", "İ", "\ufeff"]):
        add(f"boundaries-{i}", [boundary + token + boundary for token in tokens])
    add("nested-after-rejected-start", ["中sk-secret-abcd", "中secret-secret-abcd", "aBearer secret=abcdef", "sk-abcdefg-中", "sk-abcdefg--中"])
    add("raw-key-identity", {"\U00010000": "token-abcd", "\ud800\udc00": "sk-a123456"})
    # A deterministic varied corpus exercises scan restart/backtracking without synthetic expected strings.
    import random

    rng = random.Random(20261011)
    fragments = tokens + assignments + ["中", "_", "--", " ", "😀", "\ud800", "\udc00", "abcdef", ":", "=", "\n", "İ", "\u1c89"]
    for i in range(12):
        add(f"mixed-{i}", ["".join(rng.choice(fragments) for _ in range(6)) for _ in range(20)])
    return {"keys": [{"input": [ord(char) for char in key], "output": is_sensitive_key(key)} for key in keys], "cases": cases}


def p1_context_snapshot() -> dict:
    if os.environ.get("PYTHONHASHSEED") != "0":
        raise SystemExit("p1-context requires PYTHONHASHSEED=0 before Python startup for reproducible secret snapshot ordering")
    api = Path(__file__).resolve().parents[1]
    repo = api.parents[1]
    owned = repo / "output/ts-engine-p1"
    owned.mkdir(parents=True, exist_ok=True)
    # Whitelist rather than enumerating credentials. Never invoke the normal dotenv resolver.
    inherited = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR"}}
    os.environ.clear()
    os.environ.update(inherited)
    os.environ["PYDANTIC_DISABLE_PLUGINS"] = "__all__"
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(api))
    with TemporaryDirectory(prefix="context-oracle-", dir=owned) as temporary:
        run = Path(temporary)
        home = run / "home"
        home.mkdir()
        os.environ.update(HOME=str(home), USERPROFILE=str(home), TEMP=str(home), TMP=str(home))
        audit = {"enabled": True, "readonly": False, "root": None, "trace": Counter(), "writes": []}
        runtime_roots = [Path(sys.prefix), Path(sys.base_prefix)]

        def guard(event: str, args: tuple) -> None:
            if not audit["enabled"]:
                return
            # SQLAlchemy uses platform.machine(), which calls local gethostname on Windows.
            # This reads OS identity only; socket creation, DNS and connections remain denied.
            if (event.startswith(("socket.", "subprocess.", "sqlite3.connect")) and event != "socket.gethostname") or event in {"os.system", "os.spawn"}:
                raise AssertionError(f"Oracle forbids {event}")
            writes = event in {"os.mkdir", "os.remove", "os.rmdir", "os.rename", "os.link", "os.symlink", "os.truncate"}
            if event not in {"open", "os.scandir", "os.listdir"} and not writes:
                return
            if event == "open":
                mode, flags = args[1:3]
                writes = (isinstance(mode, str) and any(flag in mode for flag in "wax+")) or (
                    isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
                )
            path_arg = args[0]
            if isinstance(path_arg, int):
                raise AssertionError("Oracle forbids untracked descriptor access")
            path = Path(os.path.abspath(os.fsdecode(path_arg)))
            if writes:
                if audit["readonly"] or not path.is_relative_to(run):
                    audit["writes"].append(event)
                    raise AssertionError(f"Oracle forbids writes during domain execution: {event}")
                return
            if path.is_relative_to(run):
                root = audit["root"]
                if root is not None and path.is_relative_to(root):
                    audit["trace"][(event, path.relative_to(root).as_posix())] += 1
                return
            code = (path.is_relative_to(api / "app") or (path == api and event != "open")) and (
                event != "open" or path.suffix in {".py", ".pyc", ".pyd"}
            )
            runtime = any(path.is_relative_to(root) for root in runtime_roots)
            if path.name in {".env", ".env.local"} or not (code or runtime):
                raise AssertionError(f"Oracle forbids non-fixture read: {path}")

        sys.addaudithook(guard)
        previous_cwd = Path.cwd()
        try:
            # Exercise denial before importing domains. sys.audit invokes the same hook without
            # attempting a real author-file open or creating a socket.
            audit["readonly"] = True
            for event, args in [
                ("open", (str(repo / ".env"), "r", 0)),
                ("socket.connect", (None, None)),
                ("open", (str(home / "forbidden-write"), "w", os.O_WRONLY)),
            ]:
                try:
                    sys.audit(event, *args)
                except AssertionError:
                    pass
                else:
                    raise AssertionError(f"Oracle audit self-test did not deny {event}")
            audit["readonly"] = False
            audit["writes"].clear()
            from app.common import config

            settings = config.StoryForgeSettings(
                _env_file=None, _secrets_dir=home,
                database_url="sqlite://", storyforge_api_key="synthetic-oracle-api-key",
                storyforge_jwt_secret="synthetic-oracle-jwt-secret",
                storyforge_llm_api_key="synthetic-oracle-llm-key",
                storyforge_embedding_api_key="synthetic-oracle-embedding-key",
                s3_access_key="synthetic-oracle-access", s3_secret_key="synthetic-oracle-s3-secret",
            )
            config.get_settings = lambda: settings
            from fastapi import FastAPI
            from starlette.responses import JSONResponse

            from app.common.exceptions import DomainError
            from app.common.redaction import configured_secret_values
            from app.domains.agent_runs.book_context import build_book_context, to_payload
            from app.domains.agent_runs.canon_cache_freshness import capture_source_revision
            from app.domains.ide.command_registry import IdeCommandExecutionError, execute_ide_command_by_id
            from app.domains.ide.schemas import IdeCommandRequest, IdeCommandResult

            http = FastAPI()

            async def command_route(payload=None):
                # Same thin binding as router.execute_ide_command, without importing unrelated
                # agent runtime/metrics or the infrastructure session dependency. Real registry/models.
                return execute_ide_command_by_id("book.context", (payload or IdeCommandRequest()).args)

            # Future annotations cannot resolve function-local imports in FastAPI globals.
            command_route.__annotations__["payload"] = IdeCommandRequest | None
            http.post("/commands/book.context", response_model=IdeCommandResult)(command_route)

            @http.exception_handler(DomainError)
            async def domain_error(_request, error):
                # Same two-line boundary as app.main, without importing its app/lifespan.
                return JSONResponse(status_code=error.status_code, content={"detail": str(error)})

            def http_response(args: object) -> tuple[int, str]:
                frames = []
                body = json.dumps({"args": args}, ensure_ascii=True).encode()

                async def receive():
                    return {"type": "http.request", "body": body, "more_body": False}

                async def send(frame):
                    frames.append(frame)

                scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                         "method": "POST", "scheme": "http", "path": "/commands/book.context",
                         "raw_path": b"/commands/book.context", "root_path": "", "query_string": b"",
                         "headers": [(b"content-type", b"application/json")],
                         "server": ("synthetic.invalid", 80), "client": ("127.0.0.1", 1)}
                call = http(scope, receive, send)
                try:
                    # This async handler/send/receive has no asynchronous IO or dependencies.
                    # Assert it completes without starting an event loop, sockets or worker threads.
                    call.send(None)
                except StopIteration:
                    pass
                except (TypeError, ValueError, RecursionError):
                    # Starlette sends the 500 response and re-raises the original domain/encoding error.
                    assert frames and frames[0]["status"] == 500
                else:
                    raise AssertionError("Owned ASGI response unexpectedly suspended")
                finally:
                    call.close()
                return frames[0]["status"], b"".join(frame.get("body", b"") for frame in frames).decode()

            fixtures = []

            def add(name: str, files: dict[str, bytes | str] | None = None, *, current: str | None = None,
                    relative: bool = False, presence: str | None = None, encoding: str = "utf-8",
                    stamp: str = "fresh", missing_root: bool = False, encoding_errors: str = "strict",
                    command_variants: list[dict] | None = None) -> None:
                audit["readonly"] = False
                root = run / name
                root.mkdir()
                raw_files = {path: data.encode() if isinstance(data, str) else data for path, data in (files or {}).items()}

                def write(path: str, raw: bytes) -> None:
                    target = root / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(raw)

                for path, raw in raw_files.items():
                    write(path, raw)
                audit["readonly"] = True
                revision = capture_source_revision(str(root))
                if presence is not None:
                    # Real source hash from real receipt/declaration bytes, not a mocked cache reader.
                    token = revision if stamp == "fresh" else "canon-writeback-v1:stale"
                    text = presence.replace('"$REVISION"', _json(token))
                    raw_files[".storyforge/canon/derived/presence.json"] = text.encode(encoding, errors=encoding_errors)
                    audit["readonly"] = False
                    write(".storyforge/canon/derived/presence.json", text.encode(encoding, errors=encoding_errors))
                    audit["readonly"] = True
                fixture = {
                    "id": name, "files": {path: _encoded(raw) for path, raw in sorted(raw_files.items())},
                    "current": None if current is None else {"path": current, "kind": "relative" if relative else "absolute"},
                    "cwd": "outside-project", "missing_root": missing_root, "source_revision": revision,
                }
                audit["root"] = root
                audit["trace"].clear()
                audit["writes"].clear()
                os.chdir(home)
                argument = current if relative or current is None else str(root / current)
                try:
                    context = build_book_context(str(root / "missing") if missing_root else str(root), argument)
                    fixture["context_json"] = _json(None if context is None else asdict(context))
                    fixture["context_typed"] = _typed(None if context is None else asdict(context))
                    payload = None if context is None else to_payload(context)
                    fixture["payload_json"] = _json(payload)
                    prompt = None if payload is None else payload["prompt_block"]
                    fixture["prompt_utf8_base64"] = None if prompt is None else base64.b64encode(prompt.encode()).decode()
                except (TypeError, ValueError, RecursionError) as error:
                    fixture["error"] = {"type": type(error).__name__, "message": str(error)}
                fixture["read_trace"] = [
                    {"event": event, "path": path, "count": count}
                    for (event, path), count in sorted(audit["trace"].items())
                ]
                fixture["write_trace"] = list(audit["writes"])
                assert not fixture["write_trace"]
                # Invoke the actual registry and the field serializer separately from the builder
                # trace. Only replay metadata substitutes the owned absolute root after execution.
                def stable(value: object) -> object:
                    if isinstance(value, str):
                        return value.replace(str(root), "$ROOT").replace(root.as_posix(), "$ROOT")
                    if isinstance(value, dict):
                        return {key: stable(item) for key, item in value.items()}
                    if isinstance(value, list):
                        return [stable(item) for item in value]
                    return value

                fixture["commands"] = []
                for variant in command_variants or [{"id": "default"}]:
                    args = {"project_root": (root / "missing").as_posix() if missing_root else root.as_posix(),
                            "current_file": argument}
                    overrides = variant.get("args", {})
                    def expand(value: object) -> object:
                        if isinstance(value, str):
                            return value.replace("$ROOT", root.as_posix())
                        if isinstance(value, dict):
                            return {key: expand(item) for key, item in value.items()}
                        if isinstance(value, list):
                            return [expand(item) for item in value]
                        return value
                    args.update(expand(overrides))
                    for key in variant.get("omit", []):
                        args.pop(key, None)
                    env = variant.get("env", {})
                    assert all(key.startswith("ORACLE_") and key not in os.environ for key in env)
                    os.environ.update(env)
                    audit["trace"].clear()
                    audit["writes"].clear()
                    command = {"id": variant["id"], "args_json": json.dumps(stable(args), ensure_ascii=True, separators=(",", ":")),
                               "context": [[ord(char) for char in secret] for secret in configured_secret_values()]}
                    phase = "execute"
                    try:
                        result = execute_ide_command_by_id("book.context", args)
                        phase = "serialize"
                        output = result.model_dump(mode="json")
                        phase = "response"
                        # The production default response emits strict UTF-8, not ensure_ascii escapes.
                        response_body = JSONResponse(output).body.decode("utf-8")
                        command["output_json"] = _json(stable(json.loads(response_body)))
                        prompt = output["payload"]["book_context"]["prompt_block"]
                        command["prompt_utf8_base64"] = None if prompt is None else base64.b64encode(prompt.encode()).decode()
                    except (IdeCommandExecutionError, TypeError, ValueError, RecursionError) as error:
                        command["error"] = {"type": type(error).__name__, "message": stable(str(error)), "phase": phase,
                                            "display": stable(str(error)) if isinstance(error, IdeCommandExecutionError) else "API 返回 500"}
                    command["read_trace"] = [{"event": event, "path": path, "count": count}
                                             for (event, path), count in sorted(audit["trace"].items())]
                    audit["trace"].clear()
                    status, response = http_response(args)
                    try:
                        response_value = json.loads(response)
                    except json.JSONDecodeError:
                        response_value = None
                    if "output_json" in command:
                        assert status == 200 and stable(response_value) == json.loads(command["output_json"]), (name, variant["id"], status)
                        display = None
                    else:
                        expected_status = 400 if command["error"]["type"] == "IdeCommandExecutionError" else 500
                        assert status == expected_status
                        display = response_value["detail"] if isinstance(response_value, dict) and isinstance(response_value.get("detail"), str) else f"API 返回 {status}"
                        assert stable(display) == command["error"]["display"]
                    command["http"] = {"status": status, "display": stable(display),
                                       "normalized_body_sha256": hashlib.sha256((_json(stable(response_value)) if response_value is not None else response).encode()).hexdigest()}
                    for key in env:
                        del os.environ[key]
                    command["http_read_trace"] = [{"event": event, "path": path, "count": count}
                                             for (event, path), count in sorted(audit["trace"].items())]
                    command["write_trace"] = list(audit["writes"])
                    assert not command["write_trace"]
                    fixture["commands"].append(command)
                audit["root"] = None
                fixtures.append(fixture)

            canon_path = ".storyforge/canon/canon.json"
            canon = _json({"entities": [{"id": "a", "canonical_name": "林舟", "aliases": [" 阿舟 ", "林舟", "舟哥"]}]})
            presence = '{"_storyforge_source_revision":"$REVISION","entities":[{"id":"a","first_chapter":1,"last_chapter":2}]}'
            chapters = {"正文/01.md": "第一段。\r\n\r\n上一章收尾。\r\n", "正文/02.MD": "第二章。", "正文/03.md": "末章。"}
            add("empty")
            add("missing-root", missing_root=True)
            add("chapters", chapters, current="正文/02.MD")
            add("relative-current-cwd-split", chapters, current="正文/02.MD", relative=True)
            add("missing-next", chapters, current="正文/04.md")
            add("outside-current", chapters, current="../home/outside.md")
            add("non-manuscript-current", {**chapters, "大纲/计划.md": "计划。"}, current="大纲/计划.md")
            add("unicode-order", {f"正文/{name}.md": "x" for name in ["𠀀", "\ue000", "😀", "é", "é", "A2", "a1", "第10章", "第2章"]})
            knowledge = {f"大纲/{i:02}.md": "大纲。" * i for i in range(15)}
            knowledge.update({path: "{}" for path in [
                ".storyforge/book.json", ".storyforge/agent-instructions.md", ".storyforge/serial-plan.json",
                canon_path, ".storyforge/canon/hooks.json", ".资料/片段.md", "人物/角色.txt", "设定/世界.yaml",
                "大纲/cache/no.md", "大纲/api-key.txt", "大纲/.hidden/no.md", "大纲/no.exe", "正文/正文.md",
                "灵感.md", "OUTLINE/OK.MD", "大纲/secrets-archive.md",
            ]})
            knowledge["资料/at-limit.txt"] = b"x" * (512 * 1024)
            knowledge["资料/over-limit.txt"] = b"x" * (512 * 1024 + 1)
            add("knowledge-filters-and-limit", knowledge)
            for name, content in [
                ("bom-newlines", "\ufeff起头\r\n中段\r尾段\n\n".encode()),
                ("illegal-utf8", b"\xff\xe0\x80\x80\xed\xa0\x80\xf0\x90end"),
                ("codepoints-paragraph", ("𠀀" * 700 + "\n\n" + "😀" * 480).encode()),
                ("whitespace", "\u001c\u0085正文\u001f\n".encode()),
                ("empty-whitespace", b" \r\n\t"),
                ("nul-first-window", b"abc\0def"),
                ("nul-after-window", b"x" * 1024 + b"\0tail"),
                ("at-byte-limit", b"x" * (2 * 1024 * 1024)),
                ("over-byte-limit", b"x" * (2 * 1024 * 1024 + 1)),
            ]:
                add(f"previous-{name}", {"正文/01.md": content}, current="正文/02.md")
            # Valid deep IDs must keep their Python str() identity during cache lookup.
            # The context stays shallow; the oracle never recursively serializes the raw ID.
            for kind, opening, closing in [("list", "[", "]"), ("dict", '{"x":', "}")]:
                for depth in [1000, 2000, 2500]:
                    nested = opening * depth + '[1.0,null,true,"quoted\\\"text", "\u1c89"]' + closing * depth
                    rendered_id = str(json.loads(nested))
                    deep_canon = '{"entities":[{"id":' + nested + ',"canonical_name":"deep-id"}]}'
                    deep_presence = _json({"_storyforge_source_revision": "$REVISION", "entities": [
                        {"id": rendered_id, "first_chapter": 7, "last_chapter": 9},
                    ]})
                    add(f"deep-id-{kind}-{depth}", {canon_path: deep_canon}, presence=deep_presence)
            add("canon-no-presence", {canon_path: canon})
            add("fresh-presence", {canon_path: canon}, presence=presence)
            add("stale-presence", {canon_path: canon}, presence=presence, stamp="stale")
            for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "utf-32", "utf-32-le", "utf-32-be"):
                add(f"presence-{encoding}", {canon_path: canon}, presence=presence, encoding=encoding)
            for name, raw in [
                ("invalid", "{"), ("bom", "\ufeff" + canon), ("wrong-top", "[]"),
                ("invalid-utf8", b"\xff"), ("nul", b"{}\0"),
                ("oversize", b" " * (2 * 1024 * 1024 + 1)),
                ("scalar-entities", '{"entities":7}'), ("empty-object-entities", '{"entities":{}}'),
                ("string-aliases", '{"entities":[{"aliases":"𠀀😀𠀀"}]}'),
                ("map-aliases", '{"entities":[{"canonical_name":"\u001c 林舟 \u001f","aliases":{"10":1,"2":2,"a":3}}]}'),
                ("scalar-aliases", '{"entities":[{"canonical_name":"林舟","aliases":7}]}'),
            ]:
                add(f"canon-{name}", {canon_path: raw})
            forms = [{"canonical_name": ""}] * 19 + [{"canonical_name": "最后可见"}, {"canonical_name": "不补位"}]
            add("roster-truncate-before-forms", {canon_path: _json({"entities": [None, "x", *forms]})})
            numeric_canon = '{"entities":[{"id":null,"canonical_name":"无ID"},{"id":true,"canonical_name":"布尔ID"},{"id":1.0,"canonical_name":"浮点ID"},{"id":[1,"a"],"canonical_name":"列表ID"},{"id":{"10":1,"2":true},"canonical_name":"对象ID"}]}'
            numeric_presence = _json({"_storyforge_source_revision": "$REVISION", "entities": [
                {"id": "None", "first_chapter": True, "last_chapter": 1},
                {"id": "True", "first_chapter": 1.0, "last_chapter": 2},
                {"id": "1.0", "first_chapter": 9007199254740993, "last_chapter": 9007199254740993},
                {"id": "[1, 'a']", "first_chapter": 2, "last_chapter": 4, "missing": "false"},
                {"id": "{'10': 1, '2': True}", "first_chapter": 3, "last_chapter": 5, "missing": []},
            ]})
            add("roster-python-value-semantics", {canon_path: numeric_canon}, presence=numeric_presence)
            add("presence-browser-infinity", {canon_path: canon}, presence=_json({
                "_storyforge_source_revision": "$REVISION", "entities": [
                    {"id": "a", "first_chapter": 2**1100, "last_chapter": 2**1100},
                ],
            }))
            add("presence-duplicate-and-nonstring-id", {canon_path: canon}, presence=_json({
                "_storyforge_source_revision": "$REVISION", "entities": [
                    {"id": "a", "first_chapter": 1, "last_chapter": 1},
                    {"id": "a", "first_chapter": False, "last_chapter": 0}, {"id": 1, "missing": True},
                ],
            }))
            add("presence-scalar-entities", {canon_path: canon}, presence='{"_storyforge_source_revision":"$REVISION","entities":7}')
            unicode_canon = _json({"entities": [{"id": "\U00010000", "canonical_name": "代理码点边界"}]})
            for encoding in ("utf-8", "utf-16-le", "utf-32-le"):
                for order in ("raw-last", "astral-last"):
                    rows = [
                        {"id": "\U00010000", "first_chapter": 2, "last_chapter": 3},
                        {"id": "\ud800\udc00", "first_chapter": 98, "last_chapter": 99},
                    ]
                    if order == "astral-last":
                        rows.reverse()
                    add(f"presence-pair-identity-{encoding}-{order}", {canon_path: unicode_canon},
                        presence=_json({"_storyforge_source_revision": "$REVISION", "entities": rows}),
                        encoding=encoding, encoding_errors="surrogatepass")
            for name, value in [("raw-escaped", "\ud800" + "\\udc00"), ("escaped-raw", "\\ud800" + "\udc00")]:
                raw_presence = '{"_storyforge_source_revision":"$REVISION","entities":[{"id":"' + value + '","first_chapter":98,"last_chapter":99}]}'
                add(f"presence-pair-identity-{name}", {canon_path: unicode_canon},
                    presence=raw_presence, encoding_errors="surrogatepass")
            unicode_id = ["\u1c89", "\U0001fae9"]
            add("unicode-version-container-id", {canon_path: _json({"entities": [{"id": unicode_id, "canonical_name": "Unicode版本边界"}]})},
                presence=_json({"_storyforge_source_revision": "$REVISION", "entities": [
                    {"id": str(unicode_id), "first_chapter": 2, "last_chapter": 3},
                ]}))
            operation, fingerprint = "1" * 64, "2" * 64
            intent = {"schemaVersion": 1, "operationId": operation, "fingerprint": fingerprint,
                      "relativePath": "正文/01.md", "beforeHash": None, "afterHash": "3" * 64,
                      "checkpointTimestamp": 2**64 - 1}
            outcome = {"schemaVersion": 1, "operationId": operation, "fingerprint": fingerprint, "state": "applied"}
            for name, changed, pair in [
                ("valid", {}, True), ("valid-ms-timestamp", {"checkpointTimestamp": 1_760_000_000_000}, True),
                ("unknown", {}, False), ("schema-bool", {"schemaVersion": True}, True),
                ("schema-float", {"schemaVersion": 1.0}, True),
                ("checkpoint-overflow", {"checkpointTimestamp": 2**64}, True),
                ("checkpoint-float", {"checkpointTimestamp": 1.0}, True),
                ("extra-field", {"extra": 1}, True),
            ]:
                files = {canon_path: canon, f".storyforge/writeback-receipts/{operation}.intent.json": _json({**intent, **changed})}
                if pair:
                    files[f".storyforge/writeback-receipts/{operation}.outcome.json"] = _json(outcome)
                add(f"receipts-{name}", files, presence=presence)
            variants = [{"id": "missing-root-argument", "omit": ["project_root"]}]
            for i, value in enumerate([None, False, 0, [], {}, "", " \u001c\u0085 "]):
                variants.append({"id": f"invalid-root-{i}", "args": {"project_root": value}})
            for i, value in enumerate([None, False, 42, [], {}, "", " \u001c\u0085 ", "$ROOT/正文/02.MD", " \u001c$ROOT/正文/02.MD\u0085 "]):
                variants.append({"id": f"current-shape-{i}", "args": {"current_file": value}})
            variants.extend([
                {"id": "trim-keep-original-args", "args": {"project_root": " \u001c$ROOT\u0085 ", "current_file": " $ROOT/正文/02.MD ", "other": {"10": 1, "2": 2, "__proto__": "own"}}},
                {"id": "literal-args-and-prompt", "args": {"safe": "synthetic-oracle-api-key", "hasApiKey": True, "password": "private", "apiKeyAvailable": "synthetic-oracle-jwt-secret"}},
                {"id": "three-passes", "env": {"ORACLE_TOKEN": "REDACTED"}, "args": {"secret": "private", "safe": "REDACTED"}},
                {"id": "metadata-two-passes", "env": {"ORACLE_TOKEN": "REDACTED", "ORACLE_API_KEY": "Manuscript"}},
                {"id": "lone-surrogate-arg", "args": {"safe": "\ud800"}},
                {"id": "redacted-surrogate-arg", "args": {"password": "\ud800"}},
                {"id": "lone-surrogate-key", "args": {"\ud800": "value"}},
            ])
            add("command-inputs", {**chapters, "正文/01.md": "正文结尾 synthetic-oracle-api-key REDACTED。", canon_path: canon},
                current="正文/02.MD", command_variants=variants)
            request_shapes = []
            for args in [None, [], 42, "text"]:
                audit["trace"].clear()
                status, response = http_response(args)
                assert status == 422 and isinstance(json.loads(response)["detail"], list)
                assert not audit["trace"] and not audit["writes"]
                request_shapes.append({"args_json": _json(args), "status": status, "display": f"API 返回 {status}"})
            audit["readonly"] = False
            sources = ["app/common/manuscript.py", "app/common/project_tree.py", "app/common/config.py", "app/common/redaction.py",
                       "app/domains/ide/command_registry.py", "app/domains/ide/schemas.py", "app/domains/ide/router.py", "app/main.py",
                       "app/domains/agent_runs/book_context.py", "app/domains/agent_runs/canon_rebuild.py",
                       "app/domains/agent_runs/canon_store.py", "app/domains/agent_runs/canon_cache_freshness.py",
                       "app/domains/agent_runs/fs/project_knowledge.py", "app/domains/agent_runs/fs_tools.py",
                       "app/domains/agent_runs/fs_safety.py", "app/common/generation_sources.py"]
            audit["readonly"] = True
            result = {
                "format_version": 4, "suite": "p1-context", "platform": "windows" if os.name == "nt" else "posix",
                "python": {"version": sys.version.split()[0], "int_max_str_digits": sys.get_int_max_str_digits()},
                "response_runtime": {name: sys.modules[name].__version__ for name in ("fastapi", "starlette", "pydantic")},
                "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in sources},
                "isolation": {"settings": "synthetic-no-dotenv", "network": "audit-denied", "domain_writes": "audit-denied",
                              "trace_scope": "open/scandir/listdir; stat/resolve are not audit events",
                              "hash_seed": 0, "http_probe": "owned ASGI binding; actual registry/request/response model; no production router/app.main/lifespan/auth/session/network", "local_os_identity": "SQLAlchemy platform.machine calls gethostname only; no DNS/socket allowed", "secret_source": "complete ordered synthetic configured_secret_values snapshot",
                              "audit_self_tests": ["author-read-denied", "network-denied", "domain-write-denied"]},
                "json": _json_cases(), "book_context": fixtures, "redaction": _redaction_cases(), "request_shapes": request_shapes,
            }
        finally:
            audit["enabled"] = False
            os.chdir(previous_cwd)
        return result

