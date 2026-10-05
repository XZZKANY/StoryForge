"""Request-local observations of the exact independent writer reads, never a live cache."""

from __future__ import annotations

import hashlib
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

from app.common.redaction import redact_sensitive, redact_sensitive_text

MAX_SOURCE_REFS = 32
MAX_MANIFEST_BYTES = 20_000
_CURRENT: ContextVar[GenerationSourceCapture | None] = ContextVar("generation_source_capture", default=None)


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def selection_sha256(value) -> str:
    return text_sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


class GenerationSourceCapture:
    """Transient text is private; only hashes, relative identities and decisions are exported."""

    def __init__(self, project_root: str | None, *, current_file: str | None = None):
        try:
            self.root = Path(project_root).resolve() if project_root else None
        except (OSError, RuntimeError):
            self.root = None
        identity = os.path.normcase(str(self.root)) if self.root else ""
        self.project_identity_sha256 = text_sha256(identity) if identity else None
        self.sources: list[dict] = []
        self.projections: list[tuple[dict, str | None]] = []
        self.selections: list[dict] = []
        self.context_delivery = None
        self.writing_context = None
        if self.root is not None and current_file:
            try:
                target = (self.root / current_file.replace("\\", "/")).resolve()
                relative = target.relative_to(self.root).as_posix()
                self.writing_context = {"intent": "prose.continue", "current_file": redact_sensitive_text(relative)}
            except (OSError, ValueError, RuntimeError):
                pass  # Unknown target identity cannot qualify for automatic source replay.

    @contextmanager
    def collecting(self):
        token = _CURRENT.set(self)
        try:
            yield self
        finally:
            _CURRENT.reset(token)

    def observe(
        self, purpose, path, *, raw=None, text=None, complete=None, omission_reason=None, origin="project_file"
    ):
        # Readers supply their already resolved path: do not re-read/resolve it to
        # manufacture a new identity after the consumed bytes were captured.
        relative = None
        if self.root is not None and path is not None:
            try:
                relative = Path(path).relative_to(self.root).as_posix()
            except ValueError:
                omission_reason = "outside_project"
        byte_hash = hashlib.sha256(raw).hexdigest() if raw is not None else None
        source_id = (
            "gsrc-"
            + text_sha256(json.dumps([self.project_identity_sha256, purpose, relative, byte_hash, omission_reason]))[
                :24
            ]
        )
        row = {
            "source_id": source_id,
            "purpose": purpose,
            "relative_path": redact_sensitive_text(relative) if relative else None,
            "selection_source": "independent_writer_read" if origin == "project_file" else "request_value",
            "evidence_state": ("observed" if origin == "project_file" else "unverified")
            if raw is not None
            else "unavailable",
            "source_complete": complete,
            "observed_bytes": len(raw) if raw is not None else None,
            "observed_bytes_sha256": byte_hash,
            "file_bytes_sha256": byte_hash if complete and origin == "project_file" else None,
            "content_sha256": text_sha256(text) if text is not None and complete else None,
            "observed_content_sha256": text_sha256(text) if text is not None else None,
            "omission_reason": omission_reason,
        }
        if any(item["source_id"] == source_id for item in self.sources):
            return
        if len(self.sources) >= MAX_SOURCE_REFS:
            raise ValueError("生成来源证据超过预算，不能静默省略。")
        self.sources.append(row)

    def omit(self, purpose, path, reason):
        relative = Path(path).relative_to(self.root).as_posix() if self.root else None
        for row in self.sources:
            if row["purpose"] == purpose and row["relative_path"] == redact_sensitive_text(relative or ""):
                row["omission_reason"] = reason

    def select(self, purpose, value):
        row = {"purpose": purpose, "value": redact_sensitive(value)}
        if row not in self.selections:
            if len(self.selections) >= MAX_SOURCE_REFS:
                raise ValueError("生成选择证据超过预算，不能静默省略。")
            self.selections.append(json.loads(json.dumps(row, ensure_ascii=False)))

    def project(
        self,
        purpose,
        text,
        *,
        source_purpose=None,
        channel="system",
        truncated=False,
        omission_reason=None,
        source_span=None,
        transformation="identity",
    ):
        purposes = source_purpose or purpose
        purposes = (purposes,) if isinstance(purposes, str) else purposes
        ids = [
            row["source_id"] for row in self.sources if row["purpose"] in purposes and row["omission_reason"] is None
        ]
        requested_count = sum(row["purpose"] in purposes for row in self.sources)
        row = {
            "purpose": purpose,
            "source_ids": ids,
            "requested_source_count": requested_count,
            "selected_source_count": len(ids),
            "channel": channel,
            "truncated": truncated,
            "omission_reason": omission_reason,
            "source_span": source_span,
            "transformation": transformation,
        }
        if len(self.projections) >= MAX_SOURCE_REFS:
            raise ValueError("生成投影证据超过预算，不能静默省略。")
        self.projections.append((row, text))

    def continuation(self, content, anchor_line, tail, suffix, *, suffix_limit):
        self.observe(
            "supplied_manuscript",
            None,
            raw=content.encode("utf-8"),
            text=content,
            complete=True,
            origin="supplied_value",
        )
        normalized = content.replace("\r\n", "\n").replace("\r", "\n")
        prefix = "\n".join(normalized.split("\n")[:anchor_line])
        start = prefix.rfind(tail) if tail else 0
        self.project(
            "current_tail",
            tail,
            source_purpose="supplied_manuscript",
            channel="user",
            truncated=len(prefix.strip("\n")) > len(tail),
            source_span={
                "start": start,
                "end": start + len(tail),
                "basis": "normalized_supplied_text",
                "unit": "chars",
            },
            transformation="cursor_paragraph_tail_v1",
        )
        lines = normalized.split("\n")
        remaining = "\n".join(lines[anchor_line:])
        start = sum(len(line) + 1 for line in lines[:anchor_line]) + len(remaining) - len(remaining.lstrip("\n"))
        excerpt = suffix[:suffix_limit]
        self.project(
            "current_suffix",
            excerpt,
            source_purpose="supplied_manuscript",
            channel="user",
            truncated=len(suffix) > suffix_limit,
            source_span={
                "start": start,
                "end": start + len(excerpt),
                "basis": "normalized_supplied_text",
                "unit": "chars",
            }
            if excerpt
            else None,
            transformation="cursor_readonly_suffix_v1",
        )

    def manifest(self, system_prompt: str, user_prompt: str) -> dict:
        """Pure final binding to the strings handed to the existing provider seam."""
        projections = []
        for row, text in self.projections:
            prompt = system_prompt if row["channel"] == "system" else user_prompt
            delivered = bool(text) and text in prompt
            projections.append(
                {
                    **row,
                    "delivered": delivered,
                    "delivered_chars": len(text) if delivered else 0,
                    "delivered_source_count": len(row["source_ids"]) if delivered else 0,
                    "omitted_source_count": row["requested_source_count"]
                    - (len(row["source_ids"]) if delivered else 0),
                    "excerpt_sha256": text_sha256(text) if delivered else None,
                    "omission_reason": row["omission_reason"] or (None if delivered else "not_in_final_request"),
                }
            )
        evidence = {
            "version": "generation-sources-v1",
            "delivery_boundary": "writer_provider_seam",
            "project_identity_sha256": self.project_identity_sha256,
            "request": {"system_sha256": text_sha256(system_prompt), "user_sha256": text_sha256(user_prompt)},
            "sources": self.sources,
            "writing_context": self.writing_context,
            "selections": self.selections,
            "context_delivery": self.context_delivery,
            "projections": projections,
            "unobserved_purposes": sorted(
                {"author_instructions", "style_baseline", "canon_constraints"}
                - {row["purpose"] for row, _ in self.projections}
            ),
        }
        encoded = json.dumps(evidence, ensure_ascii=False, sort_keys=True)
        if len(encoded.encode("utf-8")) > MAX_MANIFEST_BYTES:
            raise ValueError("生成来源证据超过字节预算，不能静默省略。")
        return json.loads(encoded)  # A detached value, no path I/O or shared mutable evidence.


def observe_generation_source(purpose, path, **kwargs):
    capture = _CURRENT.get()
    if capture is not None:
        capture.observe(purpose, path, **kwargs)


def observe_generation_context(receipt):
    """Accept a backend value handoff only while the writer owns the capture."""
    capture = _CURRENT.get()
    if capture is not None:
        capture.context_delivery = json.loads(json.dumps(receipt, ensure_ascii=False, sort_keys=True))


def omit_generation_source(purpose, path, reason):
    capture = _CURRENT.get()
    if capture is not None:
        capture.omit(purpose, path, reason)


def project_generation_source(purpose, text, **kwargs):
    capture = _CURRENT.get()
    if capture is not None:
        capture.project(purpose, text, **kwargs)


def observe_generation_selection(purpose, value, *, ordered_paths=None, ordinals=None):
    capture = _CURRENT.get()
    if capture is not None:
        selected = dict(value)
        if ordered_paths is not None:
            selected["ordered_paths_sha256"] = selection_sha256(ordered_paths)
        if ordinals is not None:
            selected["ordinals_sha256"] = selection_sha256(ordinals)
        capture.select(purpose, selected)
