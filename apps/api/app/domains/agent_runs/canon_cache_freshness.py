"""Canon 缓存的写回版本；不扫描正文，不声称覆盖无回执的外部手工编辑。"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from app.common.project_tree import MAX_READ_BYTES, ProjectTreeError, scoped_target
from app.domains.agent_runs.fs_tools import FsToolError, resolve_project_root

MAX_RECEIPT_ENTRIES = 4096
MAX_RECEIPT_BYTES = 16 * 1024
MAX_RECEIPTS_TOTAL_BYTES = 8 * 1024 * 1024
UNCACHED_SCAN_NOTE = (
    "写回历史无法完整核验；本次直接扫描结果仅供参考，扫描期间的来源一致性未经核验，"
    "未复用或发布正文派生缓存。"
)
_HEX_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_RECEIPT_NAME = re.compile(r"([0-9a-f]{64})\.(intent|outcome)\.json\Z")


def _read_bounded(root: Path, path: Path, limit: int) -> bytes:
    target = scoped_target(root, path)
    if path.is_symlink() or not target.is_file():
        raise ValueError("invalid_cache_source")
    with target.open("rb", buffering=0) as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("cache_source_byte_budget")
    return raw


def _digest(value: object) -> bool:
    return isinstance(value, str) and _HEX_DIGEST.fullmatch(value) is not None


def _receipts(root: Path) -> list[tuple[str, str]]:
    directory = scoped_target(root, root / ".storyforge/writeback-receipts")
    if not directory.exists():
        return []
    records: dict[str, dict[str, dict]] = {}
    hashes = []
    total_bytes = 0
    with os.scandir(directory) as entries:
        for count, entry in enumerate(entries, start=1):
            if count > MAX_RECEIPT_ENTRIES:
                raise ValueError("cache_receipt_entry_budget")
            if not entry.name.endswith((".intent.json", ".outcome.json")):
                continue  # 原生失效重试标记不是正文版本，也不能使 unknown intent 变成终态。
            match = _RECEIPT_NAME.fullmatch(entry.name)
            if match is None:
                raise ValueError("invalid_cache_receipt_name")
            operation_id, kind = match.groups()
            raw = _read_bounded(root, Path(entry.path), MAX_RECEIPT_BYTES)
            total_bytes += len(raw)
            if total_bytes > MAX_RECEIPTS_TOTAL_BYTES:
                raise ValueError("cache_receipts_byte_budget")
            record = json.loads(raw)
            allowed = {"schemaVersion", "operationId", "fingerprint"} | (
                {"relativePath", "beforeHash", "afterHash", "checkpointTimestamp"}
                if kind == "intent" else {"state", "detail"}
            )
            if (
                not isinstance(record, dict)
                or not record.keys() <= allowed
                or type(record.get("schemaVersion")) is not int
                or record["schemaVersion"] != 1
                or record.get("operationId") != operation_id
                or not _digest(record.get("fingerprint"))
            ):
                raise ValueError("invalid_cache_receipt_identity")
            records.setdefault(operation_id, {})[kind] = record
            hashes.append((entry.name, hashlib.sha256(raw).hexdigest()))
    for pair in records.values():
        intent, outcome = pair.get("intent"), pair.get("outcome")
        if (
            intent is None
            or outcome is None
            or not isinstance(outcome.get("state"), str)
            or outcome.get("state") not in {"applied", "not_written"}
            or intent["fingerprint"] != outcome["fingerprint"]
            or not isinstance(intent.get("relativePath"), str)
            or not intent["relativePath"]
            or not _digest(intent.get("afterHash"))
            or (intent.get("beforeHash") is not None and not _digest(intent["beforeHash"]))
            or (
                intent.get("checkpointTimestamp") is not None
                and (
                    type(intent["checkpointTimestamp"]) is not int
                    or not 0 <= intent["checkpointTimestamp"] < 2**64
                )
            )
            or (outcome.get("detail") is not None and not isinstance(outcome["detail"], str))
        ):
            raise ValueError("unknown_cache_source_writeback")
    return sorted(hashes)


def capture_source_revision(project_root: str) -> str | None:
    """必须在读取生成输入前捕获；任何不完整/不可读回执都不能资格化缓存。"""

    root = resolve_project_root(project_root)
    try:
        sources = _receipts(root)
        for name in ("canon.json", "hooks.json"):
            path = scoped_target(root, root / ".storyforge/canon" / name)
            digest = (
                hashlib.sha256(_read_bounded(root, path, MAX_READ_BYTES)).hexdigest()
                if path.exists()
                else "missing"
            )
            sources.append((name, digest))
        encoded = json.dumps(sources, ensure_ascii=False, separators=(",", ":")).encode()
        return "canon-writeback-v1:" + hashlib.sha256(encoded).hexdigest()
    except (OSError, ValueError, ProjectTreeError, RuntimeError):
        return None


def require_source_revision(project_root: str, source_revision: str | None) -> None:
    if source_revision is None or capture_source_revision(project_root) != source_revision:
        raise FsToolError("派生缓存来源已变化或无法确认，请确认写回结果后重新扫描。")
