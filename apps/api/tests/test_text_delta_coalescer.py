"""Deterministic contract for the consumer-side text-delta coalescer.

These tests drive _TextDeltaCoalescer directly (no timing), pinning the merge and
renumbering rules that the timing-based SSE integration test cannot assert reliably.
"""
from __future__ import annotations

from app.domains.ide.router import _TEXT_COALESCE_MAX_CHARS, _TextDeltaCoalescer


def _delta(sequence: int, text: str, *, stream_id: str = "s", round_index: int = 1) -> dict:
    return {
        "type": "agent_text_delta",
        "run_id": "r",
        "stream_id": stream_id,
        "round_index": round_index,
        "chunk_sequence": sequence,
        "text_delta": text,
    }


def _drain(coalescer: _TextDeltaCoalescer) -> list[dict]:
    out = []
    while True:
        frame = coalescer.flush()
        if frame is None:
            return out
        out.append(frame)


def test_first_delta_of_round_is_emitted_immediately_without_arming_window():
    coalescer = _TextDeltaCoalescer()
    frames, armed = coalescer.feed(_delta(1, "首"))
    assert [f["text_delta"] for f in frames] == ["首"]
    assert armed is False
    assert _drain(coalescer) == []


def test_subsequent_deltas_buffer_then_flush_merged_and_renumbered():
    coalescer = _TextDeltaCoalescer()
    coalescer.feed(_delta(1, "首"))
    # Second delta of the same round is buffered (window armed), not emitted.
    frames, armed = coalescer.feed(_delta(2, "二"))
    assert frames == []
    assert armed is True
    frames, armed = coalescer.feed(_delta(3, "三"))
    assert frames == []
    assert armed is True
    merged = _drain(coalescer)
    assert len(merged) == 1
    assert merged[0]["text_delta"] == "二三"
    # First emitted frame was seq 1; the merged frame is renumbered to seq 2 (contiguous).
    assert merged[0]["chunk_sequence"] == 2


def test_non_delta_frame_flushes_pending_then_passes_through():
    coalescer = _TextDeltaCoalescer()
    coalescer.feed(_delta(1, "首"))
    coalescer.feed(_delta(2, "缓冲"))
    terminal = {"type": "agent_result", "agent_result": {"summary": "完"}}
    frames, armed = coalescer.feed(terminal)
    assert armed is False
    assert [f["type"] for f in frames] == ["agent_text_delta", "agent_result"]
    assert frames[0]["text_delta"] == "缓冲"
    assert frames[1] is terminal


def test_new_round_flushes_previous_without_absorbing_it():
    coalescer = _TextDeltaCoalescer()
    coalescer.feed(_delta(1, "一轮"))
    coalescer.feed(_delta(2, "继续"))
    frames, armed = coalescer.feed(_delta(1, "二轮", round_index=2))
    # Previous round's buffered text is flushed as its own frame; new round buffers fresh.
    assert [f["text_delta"] for f in frames] == ["继续"]
    assert frames[0]["round_index"] == 1
    assert armed is True
    rest = _drain(coalescer)
    assert [f["text_delta"] for f in rest] == ["二轮"]
    # Renumbering is per-round: round 2 restarts its own contiguous sequence at 1.
    assert rest[0]["chunk_sequence"] == 1


def test_byte_budget_ships_merged_frame_and_starts_fresh_window():
    coalescer = _TextDeltaCoalescer()
    coalescer.feed(_delta(1, "首"))
    big = "字" * (_TEXT_COALESCE_MAX_CHARS - 1)
    coalescer.feed(_delta(2, big[:10]))
    # Adding a piece that would exceed the budget flushes the merged buffer first.
    frames, armed = coalescer.feed(_delta(3, "溢" * _TEXT_COALESCE_MAX_CHARS))
    assert len(frames) == 1
    assert frames[0]["text_delta"] == big[:10]
    assert armed is True
    overflow = _drain(coalescer)
    assert overflow[0]["text_delta"] == "溢" * _TEXT_COALESCE_MAX_CHARS


def test_realistic_round_boundary_with_started_frames_keeps_per_round_sequences():
    """started frames pass through (and flush) without consuming a sequence; each round's
    first delta still ships immediately at chunk_sequence 1, matching the frontend's
    per-round `sequence=0` reset on agent_text_stream_started."""
    coalescer = _TextDeltaCoalescer()
    emitted: list[dict] = []

    def started(round_index: int) -> dict:
        return {
            "type": "agent_text_stream_started",
            "run_id": "r",
            "stream_id": f"s{round_index}",
            "round_index": round_index,
            "chunk_sequence": 0,
        }

    for payload in [
        started(1),
        _delta(1, "一轮", stream_id="s1", round_index=1),
        _delta(2, "甲乙", stream_id="s1", round_index=1),
        _delta(3, "丙丁", stream_id="s1", round_index=1),
        started(2),
        _delta(1, "二轮", stream_id="s2", round_index=2),
        _delta(2, "戊己", stream_id="s2", round_index=2),
    ]:
        frames, _ = coalescer.feed(payload)
        emitted.extend(frames)
    emitted.extend(_drain(coalescer))

    types = [f["type"] for f in emitted]
    # Round-1 started passes through first; round-2 started flushes round-1's merged tail.
    assert types[0] == "agent_text_stream_started"
    assert "agent_text_stream_started" in types[1:]
    round1 = [f for f in emitted if f["type"] == "agent_text_delta" and f["round_index"] == 1]
    round2 = [f for f in emitted if f["type"] == "agent_text_delta" and f["round_index"] == 2]
    # Round-1 text joins exactly; its first frame is immediate (seq 1), tail renumbered.
    assert "".join(f["text_delta"] for f in round1) == "一轮甲乙丙丁"
    assert [f["chunk_sequence"] for f in round1] == list(range(1, len(round1) + 1))
    assert round1[0]["text_delta"] == "一轮"  # first delta of round 1 shipped un-merged
    # Round 2 restarts at seq 1, first delta immediate.
    assert "".join(f["text_delta"] for f in round2) == "二轮戊己"
    assert round2[0]["chunk_sequence"] == 1
    assert round2[0]["text_delta"] == "二轮"


def test_joined_text_is_exact_and_sequences_are_contiguous_across_merges():
    coalescer = _TextDeltaCoalescer()
    emitted: list[dict] = []
    pieces = ["风", "起", "，", "万", "叶", "摇", "。"]
    for index, piece in enumerate(pieces, start=1):
        frames, _ = coalescer.feed(_delta(index, piece))
        emitted.extend(frames)
    emitted.extend(_drain(coalescer))
    assert "".join(frame["text_delta"] for frame in emitted) == "风起，万叶摇。"
    assert [frame["chunk_sequence"] for frame in emitted] == list(range(1, len(emitted) + 1))
    assert len(emitted) < len(pieces)  # the burst genuinely coalesced
