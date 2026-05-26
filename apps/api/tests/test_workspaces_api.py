from __future__ import annotations

from fastapi.testclient import TestClient

import app.models  # noqa: F401


def test_create_workspace_add_members_and_enforce_seat_limit(client: TestClient) -> None:
    create_response = client.post(
        "/api/workspaces",
        json={"title": "星海协作组", "description": "第三阶段协作试点", "seat_limit": 1},
    )
    assert create_response.status_code == 201
    workspace = create_response.json()
    assert workspace["title"] == "星海协作组"
    assert workspace["slug"] == "workspace"
    assert workspace["seat_limit"] == 1

    first_member_response = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"display_name": "林岚", "role": "owner"},
    )
    assert first_member_response.status_code == 201
    assert first_member_response.json()["role"] == "owner"

    overflow_response = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"display_name": "顾潮", "role": "editor"},
    )
    assert overflow_response.status_code == 400
    assert overflow_response.json()["detail"] == "工作区席位已满，无法继续添加活跃成员。"

    members_response = client.get(f"/api/workspaces/{workspace['id']}/members")
    assert members_response.status_code == 200
    assert [member["display_name"] for member in members_response.json()] == ["林岚"]


def test_workspace_members_return_404_for_missing_workspace(client: TestClient) -> None:
    member_response = client.post(
        "/api/workspaces/999/members",
        json={"display_name": "顾潮", "role": "editor"},
    )
    assert member_response.status_code == 404

    members_response = client.get("/api/workspaces/999/members")
    assert members_response.status_code == 404
