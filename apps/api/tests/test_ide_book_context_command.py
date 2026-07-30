"""作品底座的只读投影出口（`book.context` IDE 命令）。

背景：#233 落地的作品底座只有**一个文本出口**——拼进 system prompt 给模型看。作者提名
「有些东西能展现在左边吗」，要的是同一份事实也能在桌面端左栏看见。

本文件的红线：
- **作者看见的必须就是模型看见的那一份**：payload 里的 `prompt_block` 与走 prompt 路径
  拼出来的字符串必须相等。前端另算一遍就可能与模型口径不一致，比不显示更糟；
- **章节明细不进 prompt**：模型有 fs_list，让它每轮背一份目录只会挤掉真正要紧的坐标；
- **截断必须可数**：`roster_declared_total` / `skeleton_total` 要报出被丢掉的条数——
  #235 的教训就是「整类被丢了而作者不知道」；
- 读不到项目时显式报错，不回空对象（空底座会让作者以为「书里什么都没有」）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import app.models  # noqa: F401
from app.domains.agent_runs import book_context


@pytest.fixture()
def serial(tmp_path: Path) -> Path:
    """三章正文 + 三份非正文骨架，正文夹一个不占章号的非正文目录。"""

    (tmp_path / "正文").mkdir()
    for ordinal, line in enumerate(
        ["旧城的雨下了三天。\n", "陈默把玄铁令扣回腰间。\n", "守夜人名册烧了半页。\n"], start=1
    ):
        (tmp_path / "正文" / f"第{ordinal:03d}章.md").write_text(line * 40, encoding="utf-8")
    (tmp_path / "大纲").mkdir()
    (tmp_path / "大纲" / "总纲.md").write_text("三卷结构。\n" * 20, encoding="utf-8")
    (tmp_path / "人物").mkdir()
    (tmp_path / "人物" / "主角.md").write_text("陈默：退役守夜人。\n" * 20, encoding="utf-8")
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定" / "世界观.md").write_text("玄铁令是唯一凭信。\n" * 20, encoding="utf-8")
    return tmp_path


def _post(client: TestClient, args: dict[str, object]) -> dict:
    response = client.post("/api/ide/commands/book.context", json={"args": args})
    assert response.status_code == 200, response.text
    return response.json()["payload"]["book_context"]


# --- 红线一：作者看见的就是模型看见的 ---


def test_payload_carries_the_exact_prompt_the_model_gets(serial: Path) -> None:
    current = str(serial / "正文" / "第002章.md")
    context = book_context.build_book_context(str(serial), current)
    assert context is not None

    payload = book_context.to_payload(context)

    assert payload["prompt_block"] == book_context.build_book_context_block(str(serial), current)


def test_structured_projection_and_prompt_agree_on_the_chapter_number(serial: Path) -> None:
    """左栏说第几章，prompt 就得说第几章——两个数字打架比没有数字更糟。"""

    current = str(serial / "正文" / "第003章.md")
    payload = book_context.to_payload(book_context.build_book_context(str(serial), current))

    assert payload["current_ordinal"] == 3
    assert "当前打开的是第 3 章" in payload["prompt_block"]


# --- 红线二：章节明细只进 payload，不进 prompt ---


def test_chapter_list_reaches_the_panel(serial: Path) -> None:
    payload = book_context.to_payload(book_context.build_book_context(str(serial), None))

    assert [chapter["ordinal"] for chapter in payload["chapters"]] == [1, 2, 3]
    assert [chapter["relative_path"] for chapter in payload["chapters"]] == [
        "正文/第001章.md",
        "正文/第002章.md",
        "正文/第003章.md",
    ]
    assert all(chapter["estimated_chars"] > 0 for chapter in payload["chapters"])


def test_chapter_list_stays_out_of_the_prompt(serial: Path) -> None:
    """模型有 fs_list;每轮背一份目录只会把坐标挤掉。"""

    block = book_context.build_book_context_block(str(serial), None)

    assert "第002章.md" not in block
    assert "全书 3 章正文" in block


def test_non_manuscript_dirs_do_not_consume_chapter_numbers(serial: Path) -> None:
    payload = book_context.to_payload(book_context.build_book_context(str(serial), None))

    listed = {chapter["relative_path"] for chapter in payload["chapters"]}
    assert not any(path.startswith(("大纲/", "人物/", "设定/")) for path in listed)
    assert payload["total_chapters"] == 3


def test_current_file_outside_reading_order_is_reported_as_such(serial: Path) -> None:
    payload = book_context.to_payload(
        book_context.build_book_context(str(serial), str(serial / "大纲" / "总纲.md"))
    )

    assert payload["current_relative_path"] == "大纲/总纲.md"
    assert payload["current_ordinal"] is None


# --- 红线三：截断必须可数 ---


def test_skeleton_truncation_reports_how_many_were_dropped(serial: Path) -> None:
    extra = serial / "设定"
    for index in range(book_context.MAX_SKELETON_FILES + 5):
        (extra / f"补充{index:02d}.md").write_text("设定。\n" * 5, encoding="utf-8")

    payload = book_context.to_payload(book_context.build_book_context(str(serial), None))

    assert len(payload["skeleton"]) == book_context.MAX_SKELETON_FILES
    assert payload["skeleton_limit"] == book_context.MAX_SKELETON_FILES
    # 作者要能算出「被丢了几份」,而不是只看到一个「已截断」的布尔。
    assert payload["skeleton_total"] > payload["skeleton_limit"]


def test_roster_truncation_reports_how_many_were_dropped(serial: Path) -> None:
    canon_dir = serial / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    declared = book_context.MAX_ROSTER_ENTITIES + 7
    (canon_dir / "canon.json").write_text(
        json.dumps(
            {
                "version": 1,
                "entities": [
                    {"id": f"e{index}", "canonical_name": f"人物{index}"}
                    for index in range(declared)
                ],
                "invariants": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    payload = book_context.to_payload(book_context.build_book_context(str(serial), None))

    assert len(payload["roster"]) == book_context.MAX_ROSTER_ENTITIES
    assert payload["roster_declared_total"] == declared
    assert payload["roster_limit"] == book_context.MAX_ROSTER_ENTITIES


def test_roster_keeps_full_aliases_for_the_panel_but_trims_them_in_the_prompt(
    serial: Path,
) -> None:
    """prompt 里别名最多 3 个（省版面）,面板不受这个限制——两种渲染，一份事实。"""

    canon_dir = serial / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    (canon_dir / "canon.json").write_text(
        json.dumps(
            {
                "version": 1,
                "entities": [
                    {
                        "id": "e1",
                        "canonical_name": "陈默",
                        "aliases": ["守夜人", "老陈", "默哥", "第四别名"],
                    }
                ],
                "invariants": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    context = book_context.build_book_context(str(serial), None)
    payload = book_context.to_payload(context)

    assert payload["roster"][0]["aliases"] == ["守夜人", "老陈", "默哥", "第四别名"]
    assert "第四别名" not in payload["prompt_block"]
    assert "又称 守夜人 / 老陈 / 默哥" in payload["prompt_block"]


# --- 红线四：读不到项目时显式报错 ---


def test_unreadable_project_is_an_error_not_an_empty_book(
    client: TestClient, tmp_path: Path
) -> None:
    response = client.post(
        "/api/ide/commands/book.context",
        json={"args": {"project_root": str(tmp_path / "不存在的项目")}},
    )

    assert response.status_code == 400, response.text


def test_missing_project_root_is_rejected(client: TestClient) -> None:
    response = client.post("/api/ide/commands/book.context", json={"args": {}})

    assert response.status_code == 400, response.text


# --- 接线：REST 出口真的通到投影，不是只测纯函数 ---


def test_command_endpoint_returns_the_projection(client: TestClient, serial: Path) -> None:
    payload = _post(
        client,
        {"project_root": str(serial), "current_file": str(serial / "正文" / "第002章.md")},
    )

    assert payload["total_chapters"] == 3
    assert payload["current_ordinal"] == 2
    assert [chapter["ordinal"] for chapter in payload["chapters"]] == [1, 2, 3]
    assert payload["prompt_block"].startswith("[作品底座 · 确定性]")


def test_command_is_read_only_and_writes_no_derived_cache(
    client: TestClient, serial: Path
) -> None:
    """比 canon.refresh / observatory.scan 更轻:连派生缓存都不写,才敢随光标高频调用。"""

    _post(client, {"project_root": str(serial)})

    assert not (serial / ".storyforge").exists()
