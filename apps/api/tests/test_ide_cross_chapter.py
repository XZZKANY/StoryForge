from fastapi.testclient import TestClient

import app.domains.ide.router as ide_router


def test_cross_chapter_endpoint_returns_findings(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(ide_router, "missing_book_generation_env", lambda: [])

    def fake_check(source, chapters, *, focus=None):
        assert len(chapters) == 2
        assert focus == "称谓是否一致"
        return {
            "findings": [
                {
                    "type": "naming",
                    "severity": "high",
                    "chapters": ["第1章", "第2章"],
                    "finding": "主角称谓漂移",
                    "evidence": "沈砚/沈岩",
                }
            ],
            "model": "deepseek-v4-pro",
            "latency_ms": 5,
        }

    monkeypatch.setattr(ide_router, "check_cross_chapter_consistency", fake_check)
    resp = client.post(
        "/api/ide/review/cross-chapter",
        json={
            "chapters": [
                {"name": "第1章", "content": "沈砚在苍岭城"},
                {"name": "第2章", "content": "沈岩走出县衙"},
            ],
            "focus": "称谓是否一致",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["findings"][0]["type"] == "naming"
    assert body["findings"][0]["chapters"] == ["第1章", "第2章"]
    assert body["model"] == "deepseek-v4-pro"


def test_cross_chapter_endpoint_409_when_llm_not_configured(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(ide_router, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])
    resp = client.post(
        "/api/ide/review/cross-chapter",
        json={"chapters": [{"name": "第1章", "content": "a"}, {"name": "第2章", "content": "b"}]},
    )
    assert resp.status_code == 409
    assert "STORYFORGE_LLM_API_KEY" in resp.json()["detail"]


def test_cross_chapter_endpoint_422_with_single_chapter(client: TestClient) -> None:
    resp = client.post(
        "/api/ide/review/cross-chapter",
        json={"chapters": [{"name": "第1章", "content": "a"}]},
    )
    assert resp.status_code == 422
