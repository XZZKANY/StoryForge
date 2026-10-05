"""Author-owned generation inputs may not escape the project or exhaust scanning."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env

from app.common import author_voice, manuscript, style_baseline
from app.domains.assistant import service
from app.domains.assistant.schemas import AssistantContinueRequest, AssistantDraftRequest


def directory_alias(alias: Path, target: Path):
    if os.name == "nt":
        result = subprocess.run(
            ["cmd.exe", "/c", "mklink", "/J", str(alias), str(target)],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        assert result.returncode == 0, "could not create test project junction"
    else:
        alias.symlink_to(target, target_is_directory=True)


def test_author_instruction_directory_cannot_follow_foreign_project(tmp_path):
    project = tmp_path / "project"
    outside = tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    (outside / "agent-instructions.md").write_text("OUTSIDE_AUTHOR_SENTINEL", encoding="utf-8")
    directory_alias(project / ".storyforge", outside)
    assert author_voice.read_author_instructions(str(project)) is None


def test_author_instructions_reject_invalid_encoding_without_crashing_generation(tmp_path):
    (tmp_path / ".storyforge").mkdir()
    (tmp_path / ".storyforge/agent-instructions.md").write_bytes(b"\xff\xfe")
    assert author_voice.build_generation_system_prompt("BASE", str(tmp_path)) == "BASE"


def test_author_instruction_file_has_a_complete_read_limit(tmp_path):
    (tmp_path / ".storyforge").mkdir()
    target = tmp_path / ".storyforge/agent-instructions.md"
    target.write_bytes(b"x" * (512 * 1024 + 1))
    assert author_voice.read_author_instructions(str(tmp_path)) is None


def test_directory_alias_is_not_entered_by_manuscript_discovery(tmp_path):
    project = tmp_path / "project"
    outside = tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    (project / "第01章.md").write_text("本地正文。", encoding="utf-8")
    (outside / "第99章.md").write_text("OUTSIDE_MANUSCRIPT_SENTINEL", encoding="utf-8")
    directory_alias(project / "正文", outside)
    assert [p.relative_to(project).as_posix() for p in manuscript.iter_manuscript_files(project)] == ["第01章.md"]


def test_linked_files_cannot_activate_style_baseline(tmp_path):
    source = tmp_path / "第01章.md"
    source.write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    for i in range(3):
        os.link(source, tmp_path / f"第{i + 2:02d}章.md")
    assert style_baseline.build_style_baseline(str(tmp_path)) is None, (
        "one physical chapter is not four independent chunks"
    )


def test_discovery_budget_failure_does_not_return_a_partial_manuscript_list(tmp_path, monkeypatch):
    # Exercise the shared boundary used by the actual facade, not a separate model.
    from app.common import project_tree

    monkeypatch.setattr(project_tree, "MAX_DIRECTORY_ENTRIES", 3)
    for i in range(5):
        (tmp_path / f"第{i:02d}章.md").write_text("正文。", encoding="utf-8")
    with pytest.raises(OSError, match="遍历预算"):
        manuscript.iter_manuscript_files(tmp_path)
    assert style_baseline.build_style_baseline(str(tmp_path)) is None
    assert manuscript.previous_chapter_tail(str(tmp_path), "第99章.md") is None


def test_oversize_previous_chapter_is_not_read_as_an_unbounded_source(tmp_path):
    source = tmp_path / "第01章.md"
    source.write_bytes(b"x" * (2 * 1024 * 1024 + 1))
    assert manuscript.previous_chapter_tail(str(tmp_path), "第02章.md") is None


def test_actual_draft_provider_never_receives_foreign_author_instructions(session, tmp_path, monkeypatch):
    _enable_loop_env(monkeypatch)
    project = tmp_path / "project"
    outside = tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    (outside / "agent-instructions.md").write_text("OUTSIDE_AUTHOR_SENTINEL", encoding="utf-8")
    directory_alias(project / ".storyforge", outside)
    prompts = []
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *_, **kw: prompts.append(kw["system_prompt"]) or {"content": "新稿。"}
    )
    service.draft_file_content(
        session,
        AssistantDraftRequest(file_path=str(project / "新章.md"), project_root=str(project), instruction="写新章"),
    )
    assert len(prompts) == 1 and "OUTSIDE_AUTHOR_SENTINEL" not in prompts[0]
    assert not (project / "新章.md").exists()


def test_independent_copies_remain_independent_style_samples(tmp_path):
    for i in range(3):
        (tmp_path / f"第{i:02d}章.md").write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    baseline = style_baseline.build_style_baseline(str(tmp_path))
    assert baseline is not None and baseline.file_count == 3


def test_root_alias_preserves_local_sources_and_tail(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    (project / ".storyforge").mkdir()
    (project / ".storyforge/agent-instructions.md").write_text("本地作者要求。", encoding="utf-8")
    for i in range(3):
        (project / f"第{i:02d}章.md").write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    alias = tmp_path / "root-alias"
    directory_alias(alias, project)
    assert author_voice.read_author_instructions(str(alias)) == "本地作者要求。"
    assert len(manuscript.iter_manuscript_files(alias)) == 3
    baseline = style_baseline.build_style_baseline(str(alias))
    assert baseline is not None and baseline.file_count == 3
    previous = manuscript.previous_chapter_tail(str(alias), "第03章.md")
    assert previous is not None and previous[0] == "第02章.md"


def test_author_directory_alias_inside_project_remains_usable(tmp_path):
    source = tmp_path / "author-settings"
    source.mkdir()
    (source / "agent-instructions.md").write_text("只用限知视角。", encoding="utf-8")
    directory_alias(tmp_path / ".storyforge", source)
    assert author_voice.read_author_instructions(str(tmp_path)) == "只用限知视角。"


def test_hidden_metadata_and_directory_aliases_are_pruned_before_scandir(tmp_path, monkeypatch):
    project = tmp_path / "project"
    project.mkdir()
    (project / "第01章.md").write_text("本地。", encoding="utf-8")
    for name in (".cache", "人物", "设定", "资料"):
        (project / name).mkdir()
        (project / name / "非正文.md").write_text("不可作为正文。", encoding="utf-8")
    directory_alias(project / "循环", project)
    original = os.scandir
    visited = []

    def observe(path):
        visited.append(Path(path))
        assert Path(path) == project, "excluded directories must not be opened"
        return original(path)

    monkeypatch.setattr(os, "scandir", observe)
    assert manuscript.iter_manuscript_files(project) == [project / "第01章.md"]
    assert visited == [project]


def test_depth_exhaustion_is_explicit_not_a_partial_previous_chapter(tmp_path, monkeypatch):
    from app.common import project_tree

    monkeypatch.setattr(project_tree, "MAX_DIRECTORY_DEPTH", 1)
    (tmp_path / "正文/deep").mkdir(parents=True)
    (tmp_path / "第01章.md").write_text("本地。", encoding="utf-8")
    (tmp_path / "正文/deep/第02章.md").write_text("深层。", encoding="utf-8")
    with pytest.raises(OSError, match="最大遍历深度"):
        manuscript.iter_manuscript_files(tmp_path)
    assert manuscript.previous_chapter_tail(str(tmp_path), "第03章.md") is None


def test_excluded_entries_still_consume_discovery_budget(tmp_path, monkeypatch):
    from app.common import project_tree

    monkeypatch.setattr(project_tree, "MAX_DIRECTORY_ENTRIES", 2)
    for i in range(3):
        (tmp_path / f".hidden{i}.txt").write_text("excluded", encoding="utf-8")
    with pytest.raises(OSError, match="遍历预算"):
        manuscript.iter_manuscript_files(tmp_path)


def test_style_source_moved_outside_after_scan_is_optional_not_a_crash(tmp_path, monkeypatch):
    project = tmp_path / "project"
    chapter_dir = project / "正文"
    chapter_dir.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (chapter_dir / "第01章.md").write_text("本地正文。" * 100, encoding="utf-8")
    (outside / "第01章.md").write_text("OUTSIDE_STYLE_SENTINEL" * 100, encoding="utf-8")
    original = style_baseline.iter_manuscript_files

    def scan_then_move(root):
        paths = original(root)
        chapter_dir.rename(project / ".held-chapters")
        directory_alias(chapter_dir, outside)
        return paths

    monkeypatch.setattr(style_baseline, "iter_manuscript_files", scan_then_move)
    assert style_baseline.build_style_baseline(str(project)) is None


def test_style_rechecks_remaining_sources_after_an_earlier_read(tmp_path, monkeypatch):
    project = tmp_path / "project"
    chapter_dir = project / "正文"
    chapter_dir.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    first = project / "a.md"
    first.write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
    for name in ("b.md", "c.md"):
        (chapter_dir / name).write_text("他把灯芯捻短了一寸。" * 60, encoding="utf-8")
        (outside / name).write_text("OUTSIDE_STYLE_SENTINEL" * 100, encoding="utf-8")
    original = Path.open
    opened = []

    def swap_before_remaining_reads(path, *args, **kwargs):
        opened.append(path)
        assert path.resolve().is_relative_to(project), "foreign style source must never be opened"
        stream = original(path, *args, **kwargs)
        if path == first:
            chapter_dir.rename(project / ".held-chapters")
            directory_alias(chapter_dir, outside)
        return stream

    monkeypatch.setattr(Path, "open", swap_before_remaining_reads)
    assert style_baseline.build_style_baseline(str(project)) is None
    assert opened == [first]


@pytest.mark.parametrize("kind", ["author", "previous"])
@pytest.mark.parametrize("over_limit", [False, True], ids=["exact-limit", "over-limit"])
def test_source_reads_are_bounded_and_complete(tmp_path, monkeypatch, kind, over_limit):
    if kind == "author":
        target = tmp_path / ".storyforge/agent-instructions.md"
        target.parent.mkdir()
        limit = author_voice.MAX_SOURCE_BYTES
    else:
        target = tmp_path / "第01章.md"
        limit = manuscript.MAX_READ_BYTES
    target.write_bytes(b"x" * (limit + int(over_limit)))
    original = Path.open
    reads = []

    class ObservedStream:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.stream.close()

        def read(self, size=-1):
            reads.append(size)
            assert size == limit + 1, "read must stop at a bounded completeness sentinel"
            return self.stream.read(size)

    def bounded_open(path, *args, **kwargs):
        stream = original(path, *args, **kwargs)
        return ObservedStream(stream) if path == target else stream

    monkeypatch.setattr(Path, "open", bounded_open)
    if kind == "author":
        result = author_voice.read_author_instructions(str(tmp_path))
    else:
        result = manuscript.previous_chapter_tail(str(tmp_path), "第02章.md")
    assert (result is None) is over_limit
    assert reads == [limit + 1]


@pytest.mark.parametrize("streaming", [False, True], ids=["tool-loop", "editor-stream"])
@pytest.mark.parametrize("outside_alias", [False, True], ids=["local-source", "outside-source"])
def test_continuation_provider_receives_only_project_owned_sources(
    session, tmp_path, monkeypatch, streaming, outside_alias
):
    _enable_loop_env(monkeypatch)
    project = tmp_path / "project"
    project.mkdir()
    source_root = tmp_path / "outside" if outside_alias else project
    source_root.mkdir(exist_ok=True)
    settings = source_root / ".storyforge"
    settings.mkdir()
    (settings / "agent-instructions.md").write_text("AUTHOR_SENTINEL：只写限知视角。", encoding="utf-8")
    chapter_dir = source_root / "正文"
    chapter_dir.mkdir()
    (chapter_dir / "第01章.md").write_text("PREVIOUS_SENTINEL：门闩落下。", encoding="utf-8")
    if outside_alias:
        directory_alias(project / ".storyforge", settings)
        directory_alias(project / "正文", chapter_dir)
        # A normal current file must not be inside the foreign alias.
        current = project / "第02章.md"
    else:
        current = project / "正文/第02章.md"
    original = "CURRENT_SENTINEL：她握住钥匙。"
    current.write_text(original, encoding="utf-8")
    requests = []

    def generate(_source, **kwargs):
        requests.append((kwargs["system_prompt"], kwargs["user_prompt"]))
        return {"content": "门外传来两声叩响。"}

    def stream(_source, payload):
        requests.append(tuple(message["content"] for message in payload["messages"]))
        yield {"type": "delta", "text": "门外传来两声叩响。"}
        yield {"type": "done", "content": "门外传来两声叩响。"}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    monkeypatch.setattr(service, "stream_chat_completions", stream)
    payload = AssistantContinueRequest(
        file_path=str(current), project_root=str(project), content=original, cursor_line=1, instruction="接着写"
    )
    if streaming:
        frames = list(service.stream_continue_prose(session, payload))
        assert any("event: done" in frame for frame in frames), frames
    else:
        response = service.draft_continuation(session, payload)
        assert response.content == "门外传来两声叩响。"
    assert len(requests) == 1
    system, user = requests[0]
    assert ("AUTHOR_SENTINEL" in system) is not outside_alias
    assert ("PREVIOUS_SENTINEL" in user) is not outside_alias
    assert "CURRENT_SENTINEL" in user
    assert current.read_text(encoding="utf-8") == original, "a proposed continuation is not manuscript writeback"
