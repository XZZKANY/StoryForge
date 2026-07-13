from __future__ import annotations

import ast
import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
API_ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = Path(__file__).parent / "fixtures" / "source_code_standards_baseline.json"
PRIVATE_ACCESS_ROOTS = (
    API_ROOT / "app" / "domains" / "agent_runs",
    API_ROOT / "app" / "domains" / "book_runs",
)
AGENT_RUNS_ROOT = API_ROOT / "app" / "domains" / "agent_runs"
AGENT_RUNS_ADAPTER_ROOT = AGENT_RUNS_ROOT / "adapters"
AGENT_RUNS_PUBLIC_FACES = ("loop", "tools", "fs", "events", "permission", "patches")
BOOK_RUNS_ROOT = API_ROOT / "app" / "domains" / "book_runs"
LIVE_BOOK_RUNS_CONSUMER_ROOTS = (
    API_ROOT / "app" / "domains" / "assistant",
    AGENT_RUNS_ROOT,
    API_ROOT / "app" / "domains" / "ide",
)
BOOK_RUNS_PUBLIC_MODULES = {
    "app.domains.book_runs.book_generation",
    "app.domains.book_runs.models",
    "app.domains.book_runs.service",
}
HARD_SOURCE_LINE_LIMITS = {
    "apps/api/app/domains/agent_runs/runtime.py": 400,
    "apps/api/app/domains/agent_runs/tooling.py": 500,
    "apps/api/app/domains/agent_runs/loop_runtime.py": 500,
    "apps/api/app/domains/agent_runs/llm_context.py": 500,
    "apps/api/app/domains/agent_runs/save_points.py": 500,
    "apps/api/app/domains/book_runs/book_context.py": 500,
    "apps/api/app/domains/book_runs/book_generation.py": 500,
    "apps/api/app/domains/book_runs/book_generation_judge.py": 500,
    "apps/api/app/domains/book_runs/book_generation_parallel.py": 500,
}
RUNTIME_COMPATIBILITY_HELPERS = (
    "_trim_prose_instruction",
    "_safe_summary",
)
LIVE_TEST_PATTERNS = ("test_agent*.py", "test_ide_agent*.py", "test_book*.py")
NEW_LIVE_MODULE_LINE_LIMIT = 500
NEW_LIVE_TEST_LINE_LIMIT = 800


@dataclass(frozen=True, order=True)
class PrivateAccess:
    owner: str
    kind: str
    target: str
    name: str


def _is_private_name(name: str) -> bool:
    return name.startswith("_") and not name.startswith("__")


def _module_name(path: Path) -> tuple[str, bool]:
    parts = list(path.relative_to(API_ROOT).with_suffix("").parts)
    is_package = parts[-1] == "__init__"
    if is_package:
        parts.pop()
    return ".".join(parts), is_package


def _resolve_import_from(node: ast.ImportFrom, *, current_module: str, is_package: bool) -> str:
    if node.level == 0:
        return node.module or ""

    package_parts = current_module.split(".") if is_package else current_module.split(".")[:-1]
    ascend = node.level - 1
    if ascend > len(package_parts):
        return node.module or ""
    resolved = package_parts[: len(package_parts) - ascend]
    if node.module:
        resolved.extend(node.module.split("."))
    return ".".join(resolved)


def _dotted_name(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        if parent is not None:
            return f"{parent}.{node.attr}"
    return None


def _known_modules() -> set[str]:
    modules: set[str] = set()
    for path in (API_ROOT / "app").rglob("*.py"):
        module, _ = _module_name(path)
        modules.add(module)
    return modules


def _module_aliases(
    tree: ast.AST,
    *,
    current_module: str,
    is_package: bool,
    known_modules: set[str],
) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in known_modules:
                    continue
                if alias.asname:
                    aliases[alias.asname] = alias.name
                else:
                    root = alias.name.split(".", maxsplit=1)[0]
                    aliases[root] = root
        elif isinstance(node, ast.ImportFrom):
            source = _resolve_import_from(node, current_module=current_module, is_package=is_package)
            for alias in node.names:
                candidate = f"{source}.{alias.name}" if source else alias.name
                if candidate in known_modules:
                    aliases[alias.asname or alias.name] = candidate
    return aliases


def scan_private_accesses() -> Counter[PrivateAccess]:
    known_modules = _known_modules()
    violations: Counter[PrivateAccess] = Counter()
    for root in PRIVATE_ACCESS_ROOTS:
        for path in sorted(root.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            current_module, is_package = _module_name(path)
            aliases = _module_aliases(
                tree,
                current_module=current_module,
                is_package=is_package,
                known_modules=known_modules,
            )
            owner = path.relative_to(API_ROOT).as_posix()
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    target = _resolve_import_from(node, current_module=current_module, is_package=is_package)
                    for alias in node.names:
                        if _is_private_name(alias.name):
                            violations[PrivateAccess(owner, "import", target, alias.name)] += 1
                    continue
                if not isinstance(node, ast.Attribute) or not _is_private_name(node.attr):
                    continue
                dotted = _dotted_name(node.value)
                if dotted is None or dotted in {"self", "cls"}:
                    continue
                target = aliases.get(dotted)
                if target is None and dotted in known_modules:
                    target = dotted
                if target is not None:
                    violations[PrivateAccess(owner, "attribute", target, node.attr)] += 1
    return violations


def _load_baseline() -> dict[str, object]:
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


def _private_access_fingerprint(access: PrivateAccess) -> str:
    value = "\0".join((access.owner, access.kind, access.target, access.name))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _private_access_baseline(payload: dict[str, object]) -> Counter[str]:
    fingerprints = payload.get("private_access_fingerprints")
    assert isinstance(fingerprints, dict)
    return Counter({str(fingerprint): int(count) for fingerprint, count in fingerprints.items()})


def _format_private_accesses(counter: Counter[PrivateAccess]) -> str:
    lines: list[str] = []
    for access, count in sorted(counter.items()):
        suffix = f" x{count}" if count > 1 else ""
        lines.append(f"{access.owner}: {access.kind} {access.target}.{access.name}{suffix}")
    return "\n".join(lines)


def _line_count(path: Path) -> int:
    return len(path.read_text(encoding="utf-8").splitlines())


def test_private_cross_module_access_does_not_expand() -> None:
    """S0 freezes exact private-import/module-attribute debt; later waves may only remove entries."""

    payload = _load_baseline()
    baseline = _private_access_baseline(payload)
    current_accesses = scan_private_accesses()
    current_fingerprints = Counter(
        {_private_access_fingerprint(access): count for access, count in current_accesses.items()}
    )
    unexpected_fingerprints = current_fingerprints - baseline
    unexpected = Counter(
        {
            access: unexpected_fingerprints[_private_access_fingerprint(access)]
            for access in current_accesses
            if unexpected_fingerprints[_private_access_fingerprint(access)] > 0
        }
    )

    assert not unexpected, "New cross-module private access:\n" + _format_private_accesses(unexpected)


def test_agent_runs_private_cross_module_access_is_zero() -> None:
    current_accesses = Counter(
        {
            access: count
            for access, count in scan_private_accesses().items()
            if access.owner.startswith("app/domains/agent_runs/")
        }
    )

    assert not current_accesses, "agent_runs cross-module private access:\n" + _format_private_accesses(current_accesses)


def test_book_runs_private_cross_module_access_is_zero() -> None:
    current_accesses = Counter(
        {
            access: count
            for access, count in scan_private_accesses().items()
            if access.owner.startswith("app/domains/book_runs/")
        }
    )

    assert not current_accesses, "book_runs cross-module private access:\n" + _format_private_accesses(current_accesses)


def test_live_consumers_use_book_runs_public_modules() -> None:
    violations: list[str] = []
    for root in LIVE_BOOK_RUNS_CONSUMER_ROOTS:
        for path in sorted(root.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
            owner = path.relative_to(API_ROOT).as_posix()
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    if not module.startswith("app.domains.book_runs"):
                        continue
                    if module not in BOOK_RUNS_PUBLIC_MODULES:
                        violations.append(f"{owner}: imports internal book_runs module {module}")
                    for alias in node.names:
                        if _is_private_name(alias.name):
                            violations.append(f"{owner}: imports private book_runs symbol {module}.{alias.name}")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.startswith("app.domains.book_runs") and alias.name not in BOOK_RUNS_PUBLIC_MODULES:
                            violations.append(f"{owner}: imports internal book_runs module {alias.name}")

    assert not violations, "Live consumers must use the BookRun public API:\n" + "\n".join(violations)


def test_agent_runs_public_faces_exist() -> None:
    for face in AGENT_RUNS_PUBLIC_FACES:
        init_path = AGENT_RUNS_ROOT / face / "__init__.py"
        assert init_path.is_file(), f"Missing agent_runs public face: {face}"


def test_completed_wave_source_files_meet_hard_line_limits() -> None:
    for relative_path, limit in HARD_SOURCE_LINE_LIMITS.items():
        current = _line_count(REPO_ROOT / relative_path)
        assert current <= limit, f"{relative_path}: {current} lines > hard limit {limit}"


def test_runtime_compatibility_helpers_remain_exported() -> None:
    from app.domains.agent_runs import runtime

    for name in RUNTIME_COMPATIBILITY_HELPERS:
        assert callable(getattr(runtime, name, None)), f"Missing runtime compatibility helper: {name}"


def test_loop_main_path_reads_business_payloads_through_typed_contracts() -> None:
    path = AGENT_RUNS_ROOT / "loop_runtime.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    run_loop = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "run_chat_loop")
    calls = {
        _dotted_name(node.func)
        for node in ast.walk(run_loop)
        if isinstance(node, ast.Call)
    }
    assert "LoopRoundResult.from_payload" in calls
    assert "LoopToolCall.from_payload" in calls
    assert "LoopToolFeedback.from_output" in calls

    raw_gets = [
        node
        for node in ast.walk(run_loop)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "get"
        and not (isinstance(node.func.value, ast.Name) and node.func.value.id == "_TOOL_NAME_MAP")
    ]
    assert not raw_gets, "run_chat_loop must decode raw business payloads before field access"


def test_dual_track_imports_stay_behind_explicit_adapters() -> None:
    required_adapters = {
        "intent_fixed_pipeline_adapter.py",
        "bookrun_managed_run_adapter.py",
    }
    assert required_adapters <= {path.name for path in AGENT_RUNS_ADAPTER_ROOT.glob("*.py")}

    loop_files = [AGENT_RUNS_ROOT / "loop_runtime.py", *(AGENT_RUNS_ROOT / "loop").glob("*.py")]
    for path in loop_files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        imported_modules = {
            node.module or ""
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
        }
        imported_modules.update(
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        )
        assert not any("agent_runs.adapters" in module for module in imported_modules), path
        assert not any("domains.book_runs" in module for module in imported_modules), path

    runtime_path = AGENT_RUNS_ROOT / "runtime.py"
    runtime_tree = ast.parse(runtime_path.read_text(encoding="utf-8"), filename=str(runtime_path))
    run_message = next(
        node
        for node in ast.walk(runtime_tree)
        if isinstance(node, ast.FunctionDef) and node.name == "run_user_message"
    )
    called_names = {
        _dotted_name(node.func)
        for node in ast.walk(run_message)
        if isinstance(node, ast.Call)
    }
    assert "run_fixed_intent_pipeline" in called_names
    assert not {
        "self._run_file_review_interruptible",
        "self._run_chapter_polish",
        "self._run_bookrun_generation",
        "self._run_chapter_review",
        "self._run_chapter_review_repair",
    } & called_names

    patch_handlers = (AGENT_RUNS_ROOT / "patches" / "runtime_tools.py").read_text(encoding="utf-8")
    assert "managed_bookrun_handlers()" in patch_handlers
    assert '"bookrun.start"' not in patch_handlers


def test_private_access_baseline_summary_is_consistent() -> None:
    payload = _load_baseline()
    summary = payload.get("private_access_summary")
    assert isinstance(summary, dict)
    baseline = _private_access_baseline(payload)
    assert sum(baseline.values()) == int(summary["total"])


def test_grandfathered_source_files_do_not_grow() -> None:
    payload = _load_baseline()
    raw_limits = payload.get("line_limits")
    assert isinstance(raw_limits, dict)
    for relative_path, frozen_limit in raw_limits.items():
        path = REPO_ROOT / str(relative_path)
        assert path.is_file(), f"Frozen source baseline path disappeared: {relative_path}"
        current = _line_count(path)
        assert current <= int(frozen_limit), f"{relative_path}: {current} lines > S0 baseline {frozen_limit}"


def test_new_live_modules_stay_within_line_limit() -> None:
    payload = _load_baseline()
    raw_limits = payload.get("line_limits")
    assert isinstance(raw_limits, dict)
    grandfathered = {str(path) for path in raw_limits}

    for root in PRIVATE_ACCESS_ROOTS:
        for path in root.rglob("*.py"):
            relative_path = path.relative_to(REPO_ROOT).as_posix()
            if relative_path in grandfathered:
                continue
            assert _line_count(path) <= NEW_LIVE_MODULE_LINE_LIMIT, (
                f"{relative_path} exceeds the {NEW_LIVE_MODULE_LINE_LIMIT}-line limit; "
                "split the module or add a time-bounded exception to the source standards plan"
            )


def test_new_live_test_files_stay_within_line_limit() -> None:
    payload = _load_baseline()
    raw_limits = payload.get("line_limits")
    assert isinstance(raw_limits, dict)
    grandfathered = {str(path) for path in raw_limits}
    live_tests = {path for pattern in LIVE_TEST_PATTERNS for path in (API_ROOT / "tests").glob(pattern)}

    for path in sorted(live_tests):
        relative_path = path.relative_to(REPO_ROOT).as_posix()
        if relative_path in grandfathered:
            continue
        assert _line_count(path) <= NEW_LIVE_TEST_LINE_LIMIT, (
            f"{relative_path} exceeds the {NEW_LIVE_TEST_LINE_LIMIT}-line live-test limit"
        )
