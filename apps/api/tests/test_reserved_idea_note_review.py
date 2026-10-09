"""Independent review of the exact application-reserved root note exception."""

import pytest

from app.common.manuscript import is_manuscript_path, iter_manuscript_files, previous_chapter_tail
from app.domains.agent_runs.book_context import build_book_context
from app.domains.agent_runs.canon_rebuild import chapter_ordinals, rebuild_presence
from app.domains.agent_runs.fs_tools import FsToolError, fs_list, fs_read
from app.domains.assistant import service
from app.domains.assistant.schemas import AssistantDraftRequest


@pytest.mark.parametrize(
    "path,expected",
    [
        ("灵感.md", False),
        ("README.md", True),
        ("第001章.md", True),
        ("灵感2.md", True),
        ("灵感.markdown", True),
        ("灵感.MD", True),
        ("正文/灵感.md", True),
        ("卷一/灵感.md", True),
        ("正文\\灵感.md", True),
        ("设定/灵感.md", False),
    ],
)
def test_exception_only_reserves_exact_root_note(path, expected):
    assert is_manuscript_path(path) is expected


def write(root, relative, text):
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def test_zero_progress_and_no_predecessor_for_reserved_note_only(tmp_path):
    note = write(tmp_path, "灵感.md", "IDEA_NOTE_ONLY")
    context = build_book_context(str(tmp_path), str(note))
    assert context is not None
    assert context.total_chapters == 0
    assert context.total_estimated_chars == 0
    assert context.current_ordinal is None
    assert previous_chapter_tail(str(tmp_path), str(tmp_path / "第001章.md")) is None
    assert note.read_text() == "IDEA_NOTE_ONLY"


def test_arbitrary_root_and_nested_chapters_keep_existing_membership(tmp_path):
    expected_paths = ["README.md", "第001章.md", "正文/灵感.md", "卷一/灵感.md"]
    write(tmp_path, "灵感.md", "ROOT_NOTE")
    for path in expected_paths:
        write(tmp_path, path, "REAL_MANUSCRIPT")
    expected = {path: index + 1 for index, path in enumerate(sorted(expected_paths))}
    assert chapter_ordinals(str(tmp_path), "*.md") == expected
    assert [path.relative_to(tmp_path).as_posix() for path in iter_manuscript_files(tmp_path)] == sorted(expected)


def test_note_remains_visible_readable_while_hidden_paths_stay_blocked(tmp_path):
    write(tmp_path, "灵感.md", "VISIBLE_IDEA")
    write(tmp_path, ".hidden/灵感.md", "HIDDEN_IDEA")
    paths = [entry["path"] for entry in fs_list(str(tmp_path))["entries"]]
    assert "灵感.md" in paths
    assert ".hidden/灵感.md" not in paths
    assert fs_read(str(tmp_path), "灵感.md")["content"] == "VISIBLE_IDEA"
    with pytest.raises(FsToolError):
        fs_read(str(tmp_path), ".hidden/灵感.md")


def test_notes_do_not_create_false_entity_presence_but_nested_names_do(tmp_path):
    write(tmp_path, "灵感.md", "ONLY_NOTES_ENTITY")
    write(tmp_path, "正文/灵感.md", "REAL_ENTITY")
    entities = [{"id": "note", "canonical_name": "ONLY_NOTES_ENTITY"}, {"id": "real", "canonical_name": "REAL_ENTITY"}]
    result = rebuild_presence(str(tmp_path), entities)
    rows = {row["id"]: row for row in result["entities"]}
    assert rows["note"]["missing"] is True
    assert rows["real"]["first_chapter"] == 1


def test_explicit_note_context_reaches_writer_without_becoming_previous_chapter(session, tmp_path, monkeypatch):
    note = write(tmp_path, "灵感.md", "PINNED_IDEA_SENTINEL")
    target = tmp_path / "第001章.md"
    prompts = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})

    def writer(_source, *, system_prompt, user_prompt):
        prompts.append(user_prompt)
        return {"content": "Draft proposal."}

    monkeypatch.setattr(service, "_call_llm_streamed", writer)
    request = AssistantDraftRequest(
        file_path=str(target),
        project_root=str(tmp_path),
        instruction="Use the pinned idea.",
        context_bundle={
            "project_root": str(tmp_path),
            "current_file": str(target),
            "files": [
                {
                    "path": str(note),
                    "relative_path": "灵感.md",
                    "kind": "other",
                    "title": "灵感.md",
                    "excerpt": "PINNED_IDEA_SENTINEL",
                }
            ],
            "budget": {"pinned_file_count": 1},
        },
    )
    service.draft_file_content(session, request)
    assert len(prompts) == 1
    assert "PINNED_IDEA_SENTINEL" in prompts[0]
    assert "上一章（灵感.md）" not in prompts[0]
    assert not target.exists()
    assert note.read_text() == "PINNED_IDEA_SENTINEL"
