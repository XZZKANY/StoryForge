"""Desktop's absolute manuscript paths must retain the project's boundary."""

from __future__ import annotations

import subprocess
import sys

import pytest
from agent_transport import stream_agent_message
from test_author_voice_http_provider import voice_http  # noqa: F401 - shared real HTTP fixture
from test_author_voice_policy import TAIL

from app.domains.agent_runs.patches.polishing_service import resolve_polishable_target


@pytest.mark.parametrize("absolute", [False, True])
def test_polish_target_resolver_returns_canonical_target_and_relative_trace(tmp_path, absolute):
    project = tmp_path / "project"
    target = project / "正文" / "第01章.md"
    target.parent.mkdir(parents=True)
    target.write_text("正文", encoding="utf-8")
    path = str(target) if absolute else "正文/第01章.md"
    assert resolve_polishable_target(str(project), path) == (str(target.resolve()), "正文/第01章.md")


@pytest.mark.parametrize("kind", ["outside", "sibling-prefix", "structured", "traversal", "missing"])
def test_polish_target_resolver_refuses_unbounded_or_derived_targets(tmp_path, kind):
    project = tmp_path / "project"
    project.mkdir()
    target = {
        "outside": tmp_path / "outside.md",
        "sibling-prefix": tmp_path / "project-other" / "正文.md",
        "structured": project / ".storyforge" / "state.md",
        "traversal": project / ".." / "outside.md",
        "missing": project / "missing.md",
    }[kind]
    if kind != "missing":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("正文", encoding="utf-8")
    with pytest.raises(ValueError, match="项目内现有"):
        resolve_polishable_target(str(project), str(target))


@pytest.mark.parametrize("kind", ["outside", "structured"])
def test_polish_target_resolver_rechecks_canonical_symlink_destination(tmp_path, kind):
    project = tmp_path / "project"
    project.mkdir()
    destination = tmp_path / "outside.md" if kind == "outside" else project / ".storyforge" / "state.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("正文", encoding="utf-8")
    alias = project / "正文.md"
    try:
        alias.symlink_to(destination)
    except OSError as exc:
        pytest.skip(f"OS cannot create test symlink: {exc}")
    with pytest.raises(ValueError, match="项目内现有"):
        resolve_polishable_target(str(project), str(alias))


@pytest.mark.skipif(sys.platform != "win32", reason="Windows directory junction boundary")
@pytest.mark.parametrize("kind", ["outside", "structured"])
def test_polish_target_resolver_rechecks_windows_junction_destination(tmp_path, kind):
    project = tmp_path / "project"
    project.mkdir()
    destination = tmp_path / "outside" if kind == "outside" else project / ".storyforge"
    destination.mkdir()
    (destination / "第01章.md").write_text("正文", encoding="utf-8")
    alias = project / "正文"
    assert alias.parent.resolve().is_relative_to(tmp_path.resolve())
    assert destination.resolve().is_relative_to(tmp_path.resolve())
    created = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(alias), str(destination)],
        capture_output=True,
        check=False,
    )
    assert created.returncode == 0, created.stderr
    assert (alias / "第01章.md").resolve() == (destination / "第01章.md").resolve()
    with pytest.raises(ValueError, match="项目内现有"):
        resolve_polishable_target(str(project), str(alias / "第01章.md"))


@pytest.mark.parametrize("absolute", [False, True], ids=["relative", "desktop-absolute"])
@pytest.mark.parametrize("mode", ["valid", "invalid"])
def test_desktop_polish_path_reaches_real_provider_without_writing(client, tmp_path, request, absolute, mode):
    provider = request.getfixturevalue("voice_http")
    project = tmp_path / "project"
    (project / ".storyforge").mkdir(parents=True)
    author = "保留重复问号和感叹号。"
    (project / ".storyforge/agent-instructions.md").write_text(author, encoding="utf-8")
    original = "她说：“真的？？？”\n门，，仍然敞着。\n" + TAIL
    target = project / "正文.md"
    target.write_text(original, encoding="utf-8")
    provider.replacements = (("，，", "，"),)
    provider.response_mode = mode
    frames = stream_agent_message(
        client,
        "desktop-path-session",
        run_id=f"desktop-path-{absolute}-{mode}",
        intent="chapter.polish",
        user_message="保守润色当前章",
        permission_profile="full",
        args={"project_path": str(project), "file_path": str(target) if absolute else "正文.md", "content": original},
    )
    result = frames[-1]
    assert result["type"] == "agent_result", result
    patch = result["proposed_patch"]
    assert patch["before"] == original
    assert patch["after"] == original.replace("，，", "，")
    assert patch["requires_confirmation"] is (mode == "invalid")
    trace = next(item for item in result["tool_trace"] if item["tool_name"] == "chapter.polish")
    assert trace["output_summary"]["file_path"] == "正文.md"
    assert len(provider.requests) == 1
    assert author in provider.requests[0]["messages"][0]["content"]
    assert target.read_text(encoding="utf-8") == original


@pytest.mark.parametrize("target_kind", ["outside", "sibling-prefix", "structured", "traversal", "missing"])
def test_desktop_polish_rejects_unbounded_or_structured_target_before_provider(client, tmp_path, request, target_kind):
    provider = request.getfixturevalue("voice_http")
    project = tmp_path / "project"
    project.mkdir()
    original = "门，，仍然敞着。\n" + TAIL
    targets = {
        "outside": tmp_path / "outside.md",
        "sibling-prefix": tmp_path / "project-other" / "正文.md",
        "structured": project / ".storyforge" / "state.md",
        "traversal": project / ".." / "outside.md",
        "missing": project / "missing.md",
    }
    target = targets[target_kind]
    if target_kind != "missing":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(original, encoding="utf-8")
    frames = stream_agent_message(
        client,
        "desktop-path-session",
        run_id=f"desktop-path-deny-{target_kind}",
        intent="chapter.polish",
        user_message="保守润色当前章",
        permission_profile="full",
        args={
            "project_path": str(project),
            "file_path": str(target),
            "_trace_file_path": "正文.md",
            "content": original,
        },
    )
    assert frames[-1]["type"] == "error", frames
    assert not provider.requests
    assert not client.get(f"/api/agent-runs/desktop-path-deny-{target_kind}/artifacts").json()
    if target_kind != "missing":
        assert target.read_text(encoding="utf-8") == original
