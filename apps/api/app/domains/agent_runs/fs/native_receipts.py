"""Read-only adapter for Native's v1 writeback ledger, never a file writer.

Bindings come from a persisted, trusted operation, not from provider arguments.
Hashes prove consistency within that local trust boundary, not authenticity.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.domains.agent_runs.fs_safety import MAX_READ_BYTES, FsToolError, is_directory_link, scoped_target

MAX_RECEIPT_BYTES = 64 * 1024
Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class NativeReceiptError(RuntimeError):
    """A receipt cannot be safely associated or read; no replay is authorized."""


class NativeWritebackIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, populate_by_name=True)

    relative_path: str = Field(alias="relativePath", min_length=1)
    operation_id: Hash = Field(alias="operationId")
    fingerprint: Hash


class _Intent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: int = Field(alias="schemaVersion", ge=1, le=1)
    operation_id: Hash = Field(alias="operationId")
    fingerprint: Hash
    relative_path: str = Field(alias="relativePath")
    before_hash: Hash | None = Field(alias="beforeHash")
    after_hash: Hash = Field(alias="afterHash")
    checkpoint_timestamp: int | None = Field(alias="checkpointTimestamp", ge=0, le=2**64 - 1)


class _Outcome(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: int = Field(alias="schemaVersion", ge=1, le=1)
    operation_id: Hash = Field(alias="operationId")
    fingerprint: Hash
    state: Literal["applied", "not_written"]
    detail: str | None


@dataclass(frozen=True)
class NativeWritebackBinding:
    project_path: Path
    canonical_root: Path
    requested_path: str
    identity: NativeWritebackIdentity
    before_hash: str | None
    after_hash: str


@dataclass(frozen=True)
class NativeWritebackObservation:
    operation_id: str
    state: Literal["applied", "not_written", "outcome_unknown"]
    current: Literal["before", "after", "diverged", "missing", "unreadable"]
    receipt_persisted: bool
    checkpoint_timestamp: int | None
    verified_after: str | None = None


def raw_sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json_digest(value: list[str]) -> str:
    return raw_sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _relative(root: Path, target: Path) -> str:
    value = target.relative_to(root).as_posix()
    return value.lower() if os.name == "nt" else value


def bind_native_writeback(
    *, project_path: Path, requested_path: str, operation_key: str, source: str,
    content: str, raw_before: bytes | None, identity: NativeWritebackIdentity,
) -> NativeWritebackBinding:
    """Validate a Native description against trusted, frozen proposal inputs."""
    try:
        root = project_path.resolve(strict=True)
        if not root.is_dir() or not project_path.is_absolute():
            raise NativeReceiptError("invalid_project")
        lexical = PurePosixPath(requested_path)
        if (not requested_path or "\\" in requested_path or ":" in requested_path or lexical.is_absolute()
                or any(part in {"", ".", ".."} for part in requested_path.split("/"))):
            raise NativeReceiptError("invalid_target")
        target = scoped_target(root, root / requested_path)
        relative = _relative(root, target)
        if target == root or target.is_relative_to(root / ".storyforge" / "writeback-receipts"):
            raise NativeReceiptError("invalid_target")
        if not operation_key or len(operation_key.encode("utf-8")) > 4096:
            raise NativeReceiptError("invalid_operation_key")
        if identity.relative_path != relative:
            raise NativeReceiptError("target_identity_mismatch")
        if (identity.operation_id != _json_digest([relative, operation_key])
                or identity.fingerprint != _json_digest([relative, operation_key, source, content])):
            raise NativeReceiptError("operation_identity_mismatch")
        after = content.encode("utf-8")
        if len(after) > MAX_READ_BYTES or (raw_before is not None and len(raw_before) > MAX_READ_BYTES):
            raise NativeReceiptError("content_budget_exceeded")
        if raw_before is not None:
            raw_before.decode("utf-8", errors="strict")
        return NativeWritebackBinding(project_path, root, requested_path, identity,
                                      raw_sha256(raw_before) if raw_before is not None else None, raw_sha256(after))
    except (OSError, ValueError, UnicodeError, FsToolError) as exc:
        raise NativeReceiptError("invalid_writeback_binding") from exc


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise NativeReceiptError("duplicate_receipt_field")
        result[key] = value
    return result


def _record(root: Path, operation_id: str, suffix: str):
    path = root / ".storyforge" / "writeback-receipts" / f"{operation_id}.{suffix}.json"
    try:
        for item in (path.parent.parent, path.parent, path):
            scoped_target(root, item)
            try:
                if is_directory_link(item):
                    raise NativeReceiptError("linked_receipt_path")
            except FileNotFoundError:
                continue
        if not stat.S_ISREG(path.stat().st_mode):
            raise NativeReceiptError("nonregular_receipt")
        with path.open("rb", buffering=0) as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise NativeReceiptError("nonregular_receipt")
            raw = stream.read(MAX_RECEIPT_BYTES + 1)
        if len(raw) > MAX_RECEIPT_BYTES:
            raise NativeReceiptError("receipt_budget_exceeded")
        record = json.loads(raw.decode("utf-8", errors="strict"), object_pairs_hook=_unique_object)
        if not isinstance(record, dict):
            raise NativeReceiptError("nonobject_receipt")
        return record
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError, ValueError, RecursionError, FsToolError) as exc:
        raise NativeReceiptError("unreadable_or_invalid_receipt") from exc


def _observe(root: Path, requested: str, before: str | None, after: str):
    try:
        target = scoped_target(root, root / requested)
        if not stat.S_ISREG(target.stat().st_mode):
            return "unreadable", None
        with target.open("rb", buffering=0) as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                return "unreadable", None
            raw = stream.read(MAX_READ_BYTES + 1)
        if len(raw) > MAX_READ_BYTES:
            return "unreadable", None
        digest = raw_sha256(raw)
        if digest == after:
            return "after", raw.decode("utf-8", errors="strict")
        return ("before" if digest == before else "diverged"), None
    except FileNotFoundError:
        return ("before" if before is None else "missing"), None
    except (OSError, UnicodeError, FsToolError):
        return "unreadable", None


def inspect_native_writeback(binding: NativeWritebackBinding) -> NativeWritebackObservation | None:
    """Inspect only the bound ledger. Missing/unknown is never permission to write."""
    try:
        root = binding.project_path.resolve(strict=True)
        if root != binding.canonical_root or not root.is_dir():
            raise NativeReceiptError("project_identity_changed")
        target = scoped_target(root, root / binding.requested_path)
        if _relative(root, target) != binding.identity.relative_path:
            raise NativeReceiptError("target_identity_changed")
        # Defensive validation also covers bindings reconstructed from persisted state.
        identity = NativeWritebackIdentity.model_validate(binding.identity.model_dump(by_alias=True))
        raw_intent = _record(root, identity.operation_id, "intent")
        raw_outcome = _record(root, identity.operation_id, "outcome")
        if raw_intent is None:
            if raw_outcome is not None:
                raise NativeReceiptError("orphaned_outcome")
            return None
        intent = _Intent.model_validate(raw_intent)
        if (intent.operation_id != identity.operation_id or intent.fingerprint != identity.fingerprint
                or intent.relative_path != identity.relative_path or intent.before_hash != binding.before_hash
                or intent.after_hash != binding.after_hash):
            raise NativeReceiptError("receipt_identity_mismatch")
        outcome = _Outcome.model_validate(raw_outcome) if raw_outcome is not None else None
        if outcome is not None and (outcome.operation_id != identity.operation_id
                                    or outcome.fingerprint != identity.fingerprint):
            raise NativeReceiptError("receipt_identity_mismatch")
        current, text = _observe(root, binding.requested_path, intent.before_hash, intent.after_hash)
        return NativeWritebackObservation(
            identity.operation_id, outcome.state if outcome is not None else "outcome_unknown", current,
            outcome is not None, intent.checkpoint_timestamp,
            text if outcome is not None and outcome.state == "applied" and current == "after" else None,
        )
    except (OSError, ValueError, ValidationError, FsToolError) as exc:
        raise NativeReceiptError("invalid_receipt_or_project") from exc

