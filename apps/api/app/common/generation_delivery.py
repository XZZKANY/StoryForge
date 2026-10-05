"""Scoped links to acknowledged writer receipts; no DB, path reads or domain imports."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

MAX_DELIVERY_REFS = 32
_CURRENT: ContextVar[GenerationDeliveryCapture | None] = ContextVar("generation_delivery_capture", default=None)


@dataclass(frozen=True, slots=True)
class GenerationDeliveryRef:
    encoded: str

    def as_dict(self) -> dict:
        return json.loads(self.encoded)


def generation_delivery_reference(assistant_tool_call_id: int, manifest: dict) -> GenerationDeliveryRef:
    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    value = {
        "assistant_tool_call_id": assistant_tool_call_id,
        "manifest_version": manifest["version"],
        "delivery_boundary": manifest["delivery_boundary"],
        "manifest_sha256": hashlib.sha256(encoded.encode("utf-8")).hexdigest(),
        "project_identity_sha256": manifest["project_identity_sha256"],
        "request": manifest["request"],
    }
    return GenerationDeliveryRef(json.dumps(value, ensure_ascii=False))


class GenerationDeliveryCapture:
    """One execution scope, retaining only immutable identifiers and receipt hashes."""

    def __init__(self, *, on_record: Callable[[list[dict]], None] | None = None):
        self._refs: list[GenerationDeliveryRef] = []
        self._on_record = on_record

    @contextmanager
    def collecting(self):
        token = _CURRENT.set(self)
        try:
            yield self
        finally:
            _CURRENT.reset(token)

    def record(self, assistant_tool_call_id: int, manifest: dict):
        if len(self._refs) >= MAX_DELIVERY_REFS:
            raise ValueError("生成送达关联超过预算，不能静默省略。")
        self._refs.append(generation_delivery_reference(assistant_tool_call_id, manifest))
        if self._on_record is not None:
            self._on_record([ref.as_dict() for ref in self._refs])

    def bind(self, summary: dict) -> dict:
        # Never trust a caller/model-provided link, including when no writer ran.
        result = {key: value for key, value in summary.items() if key != "generation_delivery_refs"}
        if self._refs:
            result["generation_delivery_refs"] = [ref.as_dict() for ref in self._refs]
        return result


def record_generation_delivery(assistant_tool_call_id: int, manifest: dict) -> None:
    """Producer calls only after its exact receipt has been committed and refreshed."""
    capture = _CURRENT.get()
    if capture is not None:
        capture.record(assistant_tool_call_id, manifest)
