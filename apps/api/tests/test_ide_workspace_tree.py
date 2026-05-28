from __future__ import annotations

from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.domains.books.models import Book, Chapter


def test_read_workspace_tree_returns_workspace_book_and_chapter_nodes(
    client: TestClient,
    session: Session,
) -> None:
    """IDE 工作区树必须一次返回作品和章节层级，供 Explorer 直接渲染。"""

    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    chapter_two = Chapter(book_id=book.id, ordinal=2, title="余波", status="draft", summary=None)
    chapter_one = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary=None)
    session.add_all([chapter_two, chapter_one])
    session.commit()

    response = client.get("/api/ide/workspace-tree")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["root"] == {
        "id": "workspace:default",
        "type": "workspace",
        "title": "StoryForge 工作区",
        "ref_id": None,
        "children": [
            {
                "id": f"book:{book.id}",
                "type": "book",
                "title": "灯塔余烬",
                "ref_id": book.id,
                "children": [
                    {
                        "id": f"chapter:{chapter_one.id}",
                        "type": "chapter",
                        "title": "第 1 章：旧港",
                        "ref_id": chapter_one.id,
                        "children": [],
                    },
                    {
                        "id": f"chapter:{chapter_two.id}",
                        "type": "chapter",
                        "title": "第 2 章：余波",
                        "ref_id": chapter_two.id,
                        "children": [],
                    },
                ],
            }
        ],
    }
    assert [node["id"] for node in payload["nodes"]] == [
        "workspace:default",
        f"book:{book.id}",
        f"chapter:{chapter_one.id}",
        f"chapter:{chapter_two.id}",
    ]
