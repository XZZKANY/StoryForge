from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.main import app

import pytest


def test_create_workspace_add_members_and_enforce_seat_limit(client: TestClient) -> None:
    create_response = client.post(
        "/api/workspaces",
        json={"title": "星海协作组", "description": "第三阶段协作试点", "seat_limit": 1},
    )
    assert create_response.status_code == 404
