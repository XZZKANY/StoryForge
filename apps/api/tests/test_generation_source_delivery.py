"""Final request evidence must come from the reads used by that request."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env
from sqlalchemy import select
from test_author_source_boundaries import directory_alias

from app.common import generation_sources, style_baseline
from app.common.author_voice import GENERATION_PREFIX
from app.common.generation_sources import GenerationSourceCapture, observe_generation_source, project_generation_source
from app.domains.agent_runs import canon_store
from app.domains.agent_runs.fs import FsToolError
from app.domains.assistant import continuation, service
from app.domains.assistant.models import AssistantToolCall
from app.domains.assistant.schemas import AssistantContinueRequest, AssistantDraftRequest, AssistantReviseRequest


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.mark.parametrize("mode", ["draft", "continue", "revise", "stream"])
def test_writer_records_exact_independent_sources_before_provider(session, tmp_path, monkeypatch, mode):
    _enable_loop_env(monkeypatch)
    settings = tmp_path / ".storyforge"
    settings.mkdir()
    author = "旧要求。\r\n" * 850 + "AUTHOR_FINAL：只用限知视角。"
    author_file = settings / "agent-instructions.md"
    author_file.write_bytes(author.encode())
    (settings / "canon").mkdir()
    canon_raw = json.dumps(
        {
            "version": 1,
            "entities": [],
            "invariants": {"single_holder": [{"item": "CANON_SENTINEL", "holder": "她", "from_chapter": 1}]},
        },
        ensure_ascii=False,
    ).encode()
    (settings / "canon/canon.json").write_bytes(canon_raw)
    (settings / "canon/hooks.json").write_text(
        json.dumps(
            {
                "version": 1,
                "hooks": [{"id": "h1", "description": "HOOK_SENTINEL", "status": "active"}],
                "agenda": {"4": {"advance": ["h1"]}},
            }
        ),
        encoding="utf-8",
    )
    for i in range(1, 4):
        (tmp_path / f"第{i:02d}章.md").write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    current = tmp_path / "第04章.md"
    body = "她握住钥匙。\n后文不动。" if mode != "draft" else ""
    if mode != "draft":
        current.write_text(body, encoding="utf-8")
    requests = []

    def verify(system, user):
        tool = session.scalars(select(AssistantToolCall)).one()
        assert "generation_sources" in tool.input_summary, "actual writer inputs have no final source evidence"
        evidence = tool.input_summary["generation_sources"]
        assert evidence["request"] == {"system_sha256": sha(system), "user_sha256": sha(user)}
        sources = evidence["sources"]
        author_ref = next(s for s in sources if s["purpose"] == "author_instructions")
        assert author_ref["file_bytes_sha256"] == hashlib.sha256(author.encode()).hexdigest()
        projections = evidence["projections"]
        author_projection = next(p for p in projections if p["purpose"] == "author_instructions")
        sent_author = system.split(GENERATION_PREFIX, 1)[1]
        assert author_projection["excerpt_sha256"] == sha(sent_author)
        assert author_projection["truncated"] and author_projection["delivered"]
        assert author_projection["source_ids"] == [author_ref["source_id"]]
        style = next(p for p in projections if p["purpose"] == "style_baseline")
        assert style["delivered"] and len(style["source_ids"]) >= 3
        assert len(json.dumps(evidence, ensure_ascii=False)) < 20_000
        assert "AUTHOR_FINAL" not in json.dumps(evidence, ensure_ascii=False)
        if mode != "revise":
            previous = next(p for p in projections if p["purpose"] == "previous_chapter")
            assert previous["delivered"] and previous["excerpt_sha256"]
        canon = next(p for p in projections if p["purpose"] == "canon_constraints")
        assert canon["delivered"] and len(canon["source_ids"]) == 2
        assert "CANON_SENTINEL" in user and "HOOK_SENTINEL" in user
        declaration = next(s for s in sources if s["purpose"] == "canon_declaration")
        assert declaration["file_bytes_sha256"] == hashlib.sha256(canon_raw).hexdigest()
        assert evidence["unobserved_purposes"] == []
        if mode in {"continue", "stream"}:
            supplied = next(s for s in sources if s["purpose"] == "supplied_manuscript")
            assert supplied["content_sha256"] == sha(body) and supplied["evidence_state"] == "unverified"
            assert supplied["file_bytes_sha256"] is None
            tail = next(p for p in projections if p["purpose"] == "current_tail")
            suffix = next(p for p in projections if p["purpose"] == "current_suffix")
            assert tail["excerpt_sha256"] == sha("她握住钥匙。")
            assert suffix["excerpt_sha256"] == sha("后文不动。")
        requests.append(evidence)

    def generate(_source, **kwargs):
        verify(kwargs["system_prompt"], kwargs["user_prompt"])
        return {"content": "门外传来两声叩响。" if mode != "revise" else body.replace("钥匙", "银钥匙")}

    def stream(_source, payload):
        verify(*(message["content"] for message in payload["messages"]))
        yield {"type": "delta", "text": "门外传来两声叩响。"}
        yield {"type": "done", "content": "门外传来两声叩响。"}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    monkeypatch.setattr(service, "stream_chat_completions", stream)
    common = {"file_path": str(current), "project_root": str(tmp_path), "instruction": "接着写"}
    if mode == "draft":
        service.draft_file_content(session, AssistantDraftRequest(**common))
    elif mode == "revise":
        service.revise_file_content(session, AssistantReviseRequest(**common, content=body))
    else:
        payload = AssistantContinueRequest(**common, content=body, cursor_line=1)
        if mode == "stream":
            assert any("event: done" in f for f in service.stream_continue_prose(session, payload))
        else:
            service.draft_continuation(session, payload)
    assert len(requests) == 1
    if mode == "draft":
        assert not current.exists()
    else:
        assert current.read_text(encoding="utf-8") == body


@pytest.mark.parametrize(
    "name,reader", [("canon.json", canon_store.read_canon), ("hooks.json", canon_store.read_hooks)]
)
def test_canon_reader_does_not_treat_foreign_declarations_as_project_truth(tmp_path, name, reader):
    project = tmp_path / "project"
    outside = tmp_path / "outside"
    (project / ".storyforge").mkdir(parents=True)
    outside.mkdir()
    (outside / name).write_text('{"version":1,"hooks":[],"entities":[]}', encoding="utf-8")
    directory_alias(project / ".storyforge/canon", outside)
    with pytest.raises(FsToolError):
        reader(str(project))


@pytest.mark.parametrize("source", ["missing", "invalid-utf8", "oversize", "binary"])
def test_optional_author_loss_is_explicit_in_actual_writer_evidence(session, tmp_path, monkeypatch, source):
    _enable_loop_env(monkeypatch)
    (tmp_path / ".storyforge").mkdir()
    path = tmp_path / ".storyforge/agent-instructions.md"
    if source != "missing":
        path.write_bytes({"invalid-utf8": b"\xff", "oversize": b"x" * (512 * 1024 + 1), "binary": b"\x00"}[source])
    captured = []

    def generate(_source, **kwargs):
        tool = session.scalars(select(AssistantToolCall)).one()
        evidence = tool.input_summary["generation_sources"]
        author = next(p for p in evidence["projections"] if p["purpose"] == "author_instructions")
        assert not author["delivered"] and author["omission_reason"]
        assert author["excerpt_sha256"] is None
        assert GENERATION_PREFIX not in kwargs["system_prompt"]
        captured.append(evidence)
        return {"content": "新稿。"}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    service.draft_file_content(
        session, AssistantDraftRequest(file_path="新章.md", project_root=str(tmp_path), instruction="写新章")
    )
    assert len(captured) == 1


def test_pure_final_binding_does_not_rehash_new_disk_bytes_or_share_mutable_evidence(tmp_path, monkeypatch):
    source = tmp_path / "author.md"
    source.write_text("OLD_SOURCE", encoding="utf-8")
    capture = GenerationSourceCapture(str(tmp_path))
    with capture.collecting():
        observe_generation_source("author", source, raw=b"OLD_SOURCE", text="OLD_SOURCE", complete=True)
        project_generation_source("author", "OLD", channel="system")
    source.write_text("NEW_SOURCE", encoding="utf-8")

    def forbidden(*_, **__):
        pytest.fail("pure manifest must never read or resolve a new source")

    monkeypatch.setattr(Path, "open", forbidden)
    monkeypatch.setattr(Path, "resolve", forbidden)
    first = capture.manifest("OLD", "")
    assert first["sources"][0]["file_bytes_sha256"] == sha("OLD_SOURCE")
    assert first["projections"][0]["excerpt_sha256"] == sha("OLD")
    first["sources"][0]["content_sha256"] = "forged"
    assert capture.manifest("OLD", "")["sources"][0]["content_sha256"] == sha("OLD_SOURCE")
    assert not capture.manifest("", "OLD")["projections"][0]["delivered"], "channel must match"


def test_nested_request_scopes_restore_parent_and_never_merge_projects(tmp_path):
    a = GenerationSourceCapture(str(tmp_path / "a"))
    b = GenerationSourceCapture(str(tmp_path / "b"))
    with a.collecting():
        observe_generation_source("one", tmp_path / "a/1.md", raw=b"a", complete=True)
        with b.collecting():
            observe_generation_source("two", tmp_path / "b/2.md", raw=b"b", complete=True)
        observe_generation_source("three", tmp_path / "a/3.md", raw=b"c", complete=True)
    observe_generation_source("outside", tmp_path / "a/4.md", raw=b"ignored", complete=True)
    assert [s["purpose"] for s in a.manifest("", "")["sources"]] == ["one", "three"]
    assert [s["purpose"] for s in b.manifest("", "")["sources"]] == ["two"]


def test_style_evidence_distinguishes_prefix_hashes_and_omitted_budget_samples(tmp_path, monkeypatch):
    monkeypatch.setattr(style_baseline, "MAX_TOTAL_BYTES", 1_000)
    for i in range(4):
        (tmp_path / f"{i}.md").write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    capture = GenerationSourceCapture(str(tmp_path))
    with capture.collecting():
        prompt = style_baseline.append_style_baseline_to_system_prompt("BASE", str(tmp_path))
    evidence = capture.manifest(prompt, "")
    assert len(evidence["sources"]) == 2
    assert evidence["sources"][-1]["omission_reason"] == "aggregate_character_budget"
    style = evidence["projections"][0]
    assert not style["delivered"] and style["requested_source_count"] == 2 and style["omitted_source_count"] == 2


def test_metadata_overflow_fails_before_provider_and_does_not_leave_running_tool(session, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    monkeypatch.setattr(generation_sources, "MAX_MANIFEST_BYTES", 10)

    def unexpected(*_, **__):
        pytest.fail("metadata overflow must reject before provider")

    monkeypatch.setattr(service, "_call_llm_streamed", unexpected)
    with pytest.raises(service.AssistantReviseError, match="未调用模型"):
        service.draft_file_content(
            session, AssistantDraftRequest(file_path="新章.md", project_root=str(tmp_path), instruction="写新章")
        )
    assert session.scalars(select(AssistantToolCall)).one().status == "failed"


def test_style_partial_reads_never_claim_a_full_file_hash(tmp_path):
    raw = ("他把灯芯捻短了一寸。" * 30_000).encode()
    for i in range(3):
        (tmp_path / f"{i}.md").write_bytes(raw)
    capture = GenerationSourceCapture(str(tmp_path))
    with capture.collecting():
        prompt = style_baseline.append_style_baseline_to_system_prompt("BASE", str(tmp_path))
    evidence = capture.manifest(prompt, "")
    assert len(evidence["sources"]) == 3
    for source in evidence["sources"]:
        assert source["source_complete"] is False and source["file_bytes_sha256"] is None
        assert source["content_sha256"] is None and source["observed_bytes"] == style_baseline.MAX_FILE_BYTES
        assert source["observed_bytes_sha256"] == hashlib.sha256(raw[: style_baseline.MAX_FILE_BYTES]).hexdigest()
    assert evidence["projections"][0]["delivered_source_count"] == 3


def test_next_writer_reads_current_author_and_keeps_prior_request_receipt(session, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    author_file = tmp_path / ".storyforge/agent-instructions.md"
    author_file.parent.mkdir()
    received = []

    def generate(_source, **kwargs):
        tools = session.scalars(select(AssistantToolCall).order_by(AssistantToolCall.id)).all()
        receipt = tools[-1].input_summary["generation_sources"]
        received.append((kwargs["system_prompt"], receipt))
        # Mutating after the captured request must not rewrite that request's evidence.
        author_file.write_text("LATER_AUTHOR：改用第一人称。", encoding="utf-8")
        return {"content": "新稿。"}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    for text in ("OLD_AUTHOR：只用限知。", "NEW_AUTHOR：只写短句。"):
        author_file.write_text(text, encoding="utf-8")
        service.draft_file_content(
            session, AssistantDraftRequest(file_path="新章.md", project_root=str(tmp_path), instruction="写新章")
        )
    assert "OLD_AUTHOR" in received[0][0] and "NEW_AUTHOR" in received[1][0]
    assert "LATER_AUTHOR" not in received[1][0]
    for prompt, receipt in received:
        assert receipt["request"]["system_sha256"] == sha(prompt)
    tools = session.scalars(select(AssistantToolCall).order_by(AssistantToolCall.id)).all()
    assert tools[0].input_summary["generation_sources"] == received[0][1]
    assert tools[1].input_summary["generation_sources"] == received[1][1]


@pytest.mark.parametrize(
    "name,reader", [("canon.json", canon_store.read_canon), ("hooks.json", canon_store.read_hooks)]
)
def test_declaration_read_budget_is_complete_not_a_truncated_json_fallback(tmp_path, name, reader):
    directory = tmp_path / ".storyforge/canon"
    directory.mkdir(parents=True)
    (directory / name).write_bytes(b"{}" + b" " * (2 * 1024 * 1024))
    capture = GenerationSourceCapture(str(tmp_path))
    with capture.collecting(), pytest.raises(FsToolError):
        reader(str(tmp_path))
    source = capture.manifest("", "")["sources"][0]
    assert source["source_complete"] is False and source["file_bytes_sha256"] is None
    assert source["omission_reason"]


@pytest.mark.parametrize("newline", ["\r\n", "\r"], ids=["crlf", "cr"])
def test_actual_cursor_tail_and_evidence_share_the_normalized_insertion_coordinate(tmp_path, newline):
    body = "上文。" + newline + "后文。"
    anchor = continuation.resolve_anchor_line(body, 1)
    tail = continuation.manuscript_tail(body, anchor)
    suffix = continuation.manuscript_suffix(body, anchor)
    assert tail == "上文。" and suffix == "后文。"
    capture = GenerationSourceCapture(str(tmp_path))
    capture.continuation(body, anchor, tail, suffix, suffix_limit=3)
    prompt = continuation.build_continue_prompt(tail=tail, file_path="正文.md", suffix=suffix)
    projections = capture.manifest("", prompt)["projections"]
    normalized = body.replace("\r\n", "\n").replace("\r", "\n")
    for projection in projections:
        span = projection["source_span"]
        assert projection["delivered"]
        assert span["basis"] == "normalized_supplied_text"
        assert sha(normalized[span["start"] : span["end"]]) == projection["excerpt_sha256"]
