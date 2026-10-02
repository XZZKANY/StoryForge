"""独立GUI fixture来源约束，不更改生产release常量。"""

import json
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from gui_lifecycle_backend import PROTOCOL, SCENARIOS, configure_fixture, validate_fixture

from app.common.config import get_settings
from app.db.session import get_session
from app.domains.agent_runs import external_admission
from app.main import app as production_app


def test_fixture_manifest_requires_exact_protocol_and_known_scenario(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    manifest = tmp_path / "gui-fixture.json"
    manifest.write_text(json.dumps({"protocol": PROTOCOL, "scenario": "manual_wait"}))
    assert validate_fixture(tmp_path, "a" * 64) == project
    for scenario in SCENARIOS:
        manifest.write_text(json.dumps({"protocol": PROTOCOL, "scenario": scenario}))
        assert validate_fixture(tmp_path, "a" * 64) == project
    for payload in [
        {"protocol": "wrong", "scenario": "manual_wait"},
        {"protocol": PROTOCOL, "scenario": "production"},
        {"protocol": PROTOCOL, "scenario": "manual_wait", "project": "other"},
    ]:
        manifest.write_text(json.dumps(payload))
        with pytest.raises(ValueError, match="manifest_invalid"):
            validate_fixture(tmp_path, "a" * 64)
    assert external_admission.RELEASE_GATE_PASSED is False


def test_fixture_rejects_ambient_or_missing_process_identity(tmp_path):
    for identity in ["", "localhost", "A" * 64, "a" * 63]:
        with pytest.raises(ValueError, match="identity_invalid"):
            validate_fixture(tmp_path, identity)
    with pytest.raises(ValueError, match="identity_invalid"):
        validate_fixture(type(tmp_path)("relative"), "a" * 64)


def test_fixture_factory_is_scoped_zero_write_and_restores_production_projection(tmp_path, monkeypatch):
    project = tmp_path / "project"
    project.mkdir()
    chapter = project / "chapter.md"
    before = b"before\r\n"
    chapter.write_bytes(before)
    (tmp_path / "gui-fixture.json").write_text(json.dumps({"protocol": PROTOCOL, "scenario": "manual_wait"}))
    generation = "b" * 64
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", generation)
    monkeypatch.setenv("STORYFORGE_EXTERNAL_WRITEBACK_ENABLED", "1")
    monkeypatch.setattr(get_settings(), "storyforge_api_key", "gui-fixture-unit-test")
    capability = external_admission.agent_capabilities
    route_ids = [id(route) for route in production_app.router.routes]
    headers = {"X-StoryForge-API-Key": "gui-fixture-unit-test"}
    with ExitStack() as stack:
        fixture_app = configure_fixture(tmp_path, generation, stack)
        assert fixture_app is not production_app
        assert [id(route) for route in fixture_app.router.routes] == route_ids
        client = TestClient(fixture_app)
        response = client.get("/api/agent-runs/capabilities", headers=headers)
        assert response.status_code == 200
        assert response.json()["execution_protocols"] == ["external_writeback_v1"]
        assert response.json()["managed_host_generation"] == generation
        response = client.options(
            "/api/ide/agent/sessions/test-only/stream",
            headers={
                "Origin": "http://tauri.localhost",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-storyforge-api-key,x-storyforge-host-generation",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"
        for args in [{}, {"project_path": str(tmp_path)}]:
            response = client.post("/api/ide/agent/sessions/test-only/stream", json={"args": args}, headers=headers)
            assert response.status_code == 409
            assert response.json()["detail"] == "gui_fixture_project_scope_mismatch"
        assert chapter.read_bytes() == before
        assert list(project.iterdir()) == [chapter]
        assert json.loads((tmp_path / "gui-provider-stats.json").read_text()) == {
            "provider_calls": 0,
            "revision_calls": 0,
            "saved_read_observed": False,
        }
        assert external_admission.RELEASE_GATE_PASSED is False
    assert external_admission.agent_capabilities is capability
    assert [id(route) for route in production_app.router.routes] == route_ids
    response = TestClient(production_app).get("/api/agent-runs/capabilities", headers=headers)
    assert response.status_code == 200
    assert response.json()["execution_protocols"] == []
    assert response.json()["disabled_reason"] == "release_gate_closed"


def test_fixture_real_stream_retains_live_wait_projection_without_enabling_release(
    tmp_path, session_factory, monkeypatch
):
    project = tmp_path / "project"
    project.mkdir()
    chapter = project / "chapter.md"
    before = "雨还在下。林舟撑着伞，沿着河岸走着。\r\n"
    chapter.write_bytes(before.encode())
    (tmp_path / "gui-fixture.json").write_text(json.dumps({"protocol": PROTOCOL, "scenario": "manual_wait"}))
    generation = "c" * 64
    monkeypatch.setenv("STORYFORGE_MANAGED_HOST_GENERATION", generation)
    monkeypatch.setattr(get_settings(), "storyforge_api_key", "gui-fixture-unit-test")

    def session_dependency():
        with session_factory() as session:
            yield session

    headers = {"X-StoryForge-API-Key": "gui-fixture-unit-test", "X-StoryForge-Host-Generation": generation}
    with ExitStack() as stack:
        fixture_app = configure_fixture(tmp_path, generation, stack)
        # Reused APIRoute objects retain the original dependency-overrides provider.
        stack.enter_context(patch.dict(production_app.dependency_overrides, {get_session: session_dependency}))
        client = TestClient(fixture_app)
        response = client.post(
            "/api/ide/agent/sessions/gui-live-test/stream",
            headers=headers,
            json={
                "execution_protocol": "external_writeback_v1",
                "run_id": "gui-live-test",
                "user_message": "请修订当前章节，然后重新读取保存的文件。",
                "permission_profile": "ask",
                "args": {
                    "project_path": str(project),
                    "file_path": str(chapter),
                    "current_file": str(chapter),
                    "content": before,
                },
            },
        )
        assert response.status_code == 200
        frames = [
            json.loads(line.removeprefix("data: ")) for line in response.text.splitlines() if line.startswith("data: ")
        ]
        waiting = next(
            frame for frame in frames if frame["type"] == "agent_run_waiting" and frame.get("execution_epoch")
        )
        response = client.get(
            "/api/agent-runs/gui-live-test/writeback", params={"session_id": "gui-live-test"}, headers=headers
        )
        assert response.status_code == 200
        projection = response.json()
        assert projection["wait_id"] == waiting["wait_id"]
        assert projection["stage"] == "await_authorization"
        assert projection["continuation_available"] is True
        assert projection["feedback_consumed"] is False
        assert projection["identity"] is None
        assert chapter.read_bytes() == before.encode()
        assert not list((project / ".storyforge/writeback-receipts").glob("*.intent.json"))
        assert json.loads((tmp_path / "gui-provider-stats.json").read_text())["provider_calls"] == 1
        assert external_admission.RELEASE_GATE_PASSED is False
