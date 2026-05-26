"""Stage 7-1 游标分页 helper 与端点集成测试。"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common.pagination import (
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_LIMIT,
    CursorPage,
    clamp_limit,
    paginate_by_id,
    parse_cursor,
)
from app.domains.artifacts.models import Artifact
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.artifacts.service import create_artifact
from app.domains.books.models import Book


def test_parse_cursor_accepts_positive_integer_strings() -> None:
    assert parse_cursor("12") == 12
    assert parse_cursor("0001") == 1


def test_parse_cursor_rejects_empty_and_negative_and_garbage() -> None:
    assert parse_cursor(None) is None
    assert parse_cursor("") is None
    assert parse_cursor("   ") is None
    assert parse_cursor("0") is None
    assert parse_cursor("-3") is None
    assert parse_cursor("abc") is None


def test_clamp_limit_defaults_when_invalid_and_caps_at_max() -> None:
    assert clamp_limit(None) == DEFAULT_PAGE_LIMIT
    assert clamp_limit(0) == DEFAULT_PAGE_LIMIT
    assert clamp_limit(-5) == DEFAULT_PAGE_LIMIT
    assert clamp_limit(15) == 15
    assert clamp_limit(10000) == MAX_PAGE_LIMIT


@pytest.fixture()
def seeded_artifacts(session: Session) -> list[Artifact]:
    book = Book(title="分页样本", status="draft", premise="验证分页。")
    session.add(book)
    session.commit()
    created: list[Artifact] = []
    for index in range(5):
        artifact = create_artifact(
            session,
            ArtifactCreate(
                book_id=book.id,
                artifact_type="reference",
                name=f"制品 {index}",
                storage_uri=f"local://artifact-{index}",
                mime_type="text/plain",
            ),
        )
        created.append(artifact)
    return created


def test_paginate_by_id_returns_cursor_page_with_window_size(
    session: Session, seeded_artifacts: list[Artifact]
) -> None:
    statement = select(Artifact).order_by(Artifact.id)
    page: CursorPage = paginate_by_id(
        session, statement, id_column=Artifact.id, cursor=None, limit=2
    )

    assert [artifact.id for artifact in page.items] == [seeded_artifacts[0].id, seeded_artifacts[1].id]
    assert page.has_more is True
    assert page.next_cursor == str(seeded_artifacts[1].id)


def test_paginate_by_id_advances_via_cursor_until_exhausted(
    session: Session, seeded_artifacts: list[Artifact]
) -> None:
    statement = select(Artifact).order_by(Artifact.id)

    first = paginate_by_id(session, statement, id_column=Artifact.id, cursor=None, limit=2)
    second = paginate_by_id(
        session, statement, id_column=Artifact.id, cursor=first.next_cursor, limit=2
    )
    third = paginate_by_id(
        session, statement, id_column=Artifact.id, cursor=second.next_cursor, limit=2
    )

    assert [artifact.id for artifact in second.items] == [seeded_artifacts[2].id, seeded_artifacts[3].id]
    assert second.has_more is True
    assert [artifact.id for artifact in third.items] == [seeded_artifacts[4].id]
    assert third.has_more is False
    assert third.next_cursor is None


def test_paginate_by_id_invalid_cursor_is_treated_as_no_cursor(
    session: Session, seeded_artifacts: list[Artifact]
) -> None:
    statement = select(Artifact).order_by(Artifact.id)
    page = paginate_by_id(session, statement, id_column=Artifact.id, cursor="garbage", limit=3)
    assert [artifact.id for artifact in page.items] == [a.id for a in seeded_artifacts[:3]]
