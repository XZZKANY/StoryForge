"""Exact persisted continuation receipts, not new disk baselines, qualify recovery."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from sqlalchemy import select

from app.common.author_voice import build_generation_system_prompt
from app.common.generation_delivery import MAX_DELIVERY_REFS, generation_delivery_reference
from app.common.generation_sources import GenerationSourceCapture
from app.common.manuscript import previous_chapter_tail
from app.domains.agent_runs.canon_context import build_scene_constraint_block
from app.domains.agent_runs.loop.knowledge_recovery import knowledge_sources_unchanged
from app.domains.agent_runs.loop.ordinary_recovery import ordinary_sources_unchanged
from app.domains.assistant import continuation
from app.domains.assistant.models import AssistantToolCall


def _persisted_tool_call(session, tool_call_id):
    # Column reads cannot refresh/overwrite pending ORM state; suppress autoflush
    # so checkpoint preparation never stages someone else's transaction effects.
    with session.no_autoflush:
        return session.execute(
            select(
                AssistantToolCall.id,
                AssistantToolCall.session_id,
                AssistantToolCall.tool_name,
                AssistantToolCall.input_summary,
            ).where(AssistantToolCall.id == tool_call_id)
        ).one_or_none()


def checkpoint_generation_receipts(session, assistant_session_id, traces) -> list[dict]:
    """Read named DB facts only. Missing evidence is explicit and never manufactured."""
    receipts = []
    for trace in traces:
        if trace.tool_name != "prose.continue":
            continue
        refs = trace.input_summary.get("generation_delivery_refs") if isinstance(trace.input_summary, dict) else None
        outer = _persisted_tool_call(session, trace.assistant_tool_call_id) if trace.assistant_tool_call_id else None
        if (
            not isinstance(refs, list)
            or not refs
            or outer is None
            or outer.session_id != assistant_session_id
            or outer.tool_name != "prose.continue"
            or not isinstance(outer.input_summary, dict)
            or outer.input_summary.get("generation_delivery_refs") != refs
        ):
            return [{"unverified_reason": "missing_or_unbound_generation_receipt"}]
        for ref in refs:
            if not isinstance(ref, dict) or type(ref.get("assistant_tool_call_id")) is not int:
                return [{"unverified_reason": "invalid_generation_reference"}]
            inner = _persisted_tool_call(session, ref["assistant_tool_call_id"])
            manifest = (
                inner.input_summary.get("generation_sources")
                if inner is not None and isinstance(inner.input_summary, dict)
                else None
            )
            if (
                inner is None
                or inner.session_id != assistant_session_id
                or inner.tool_name != "assistant.continue"
                or not isinstance(manifest, dict)
            ):
                return [{"unverified_reason": "missing_generation_manifest"}]
            try:
                if generation_delivery_reference(inner.id, manifest).as_dict() != ref:
                    return [{"unverified_reason": "generation_manifest_changed"}]
            except (KeyError, TypeError, ValueError):
                return [{"unverified_reason": "invalid_generation_manifest"}]
            receipts.append({"reference": deepcopy(ref), "manifest": deepcopy(manifest)})
            if len(receipts) > MAX_DELIVERY_REFS:
                return [{"unverified_reason": "generation_receipt_budget"}]
    return receipts


def generation_outcome_covered(payload: dict) -> bool:
    """Legacy completed continuation transcripts cannot silently claim new coverage."""
    try:
        traces = payload.get("outcome", {}).get("traces", [])
        expected = []
        for trace in traces:
            if trace.get("tool_name") == "prose.continue":
                refs = trace["input_summary"].get("generation_delivery_refs")
                if not isinstance(refs, list) or not refs:
                    return False
                expected.extend(refs)
        receipts = payload.get("sources", {}).get("generation_receipts", [])
        return expected == [r.get("reference") for r in receipts]
    except (AttributeError, KeyError, TypeError):
        return False


def independent_source_view(manifest: dict) -> dict:
    """Keep all actual reads/omissions and selection dependencies; no supplied-text claim."""
    return {
        "project_identity_sha256": manifest["project_identity_sha256"],
        "writing_context": manifest["writing_context"],
        "selections": manifest["selections"],
        "sources": [row for row in manifest["sources"] if row["selection_source"] == "independent_writer_read"],
        "projections": [
            row for row in manifest["projections"] if row["purpose"] not in {"current_tail", "current_suffix"}
        ],
        "system_sha256": manifest["request"]["system_sha256"],
    }


def writing_context_sources_unchanged(receipt, root: Path, *, current_file: str, user_message: str) -> bool:
    """Shared frozen-context qualification; does not claim a provider invocation."""
    manifest = {"context_delivery": receipt, "writing_context": {"current_file": current_file}}
    try:
        return knowledge_sources_unchanged(manifest, root, user_message=user_message) and ordinary_sources_unchanged(
            manifest, root
        )
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeError):
        return False


def generation_sources_unchanged(receipts, root: Path, *, user_message: str = "续写") -> bool:
    """Re-run the same bounded read/selection owners and compare with consumed bytes."""
    if not isinstance(receipts, list) or len(receipts) > MAX_DELIVERY_REFS:
        return False
    try:
        for receipt in receipts:
            ref, manifest = receipt["reference"], receipt["manifest"]
            if (
                manifest.get("version") != "generation-sources-v1"
                or manifest.get("delivery_boundary") != "writer_provider_seam"
            ):
                return False
            if generation_delivery_reference(ref["assistant_tool_call_id"], manifest).as_dict() != ref:
                return False
            context = manifest["writing_context"]
            if not isinstance(context, dict) or context.get("intent") != "prose.continue":
                return False
            target = (root / context["current_file"]).resolve()
            target.relative_to(root)  # Never open a source outside the admitted project.
            if not writing_context_sources_unchanged(
                manifest.get("context_delivery"), root, current_file=context["current_file"], user_message=user_message
            ):
                return False
            capture = GenerationSourceCapture(str(root), current_file=str(target))
            with capture.collecting():
                scene = build_scene_constraint_block(str(root), str(target))
                previous = previous_chapter_tail(str(root), str(target))
                system = build_generation_system_prompt(continuation.CONTINUE_SYSTEM_PROMPT, str(root))
            # Only source projection strings are needed, not stored manuscript/prompt plaintext.
            user = "\n\n".join(value for value in (scene, previous[1] if previous else None) if value)
            if independent_source_view(capture.manifest(system, user)) != independent_source_view(manifest):
                return False
        return True
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RuntimeError):
        return False
