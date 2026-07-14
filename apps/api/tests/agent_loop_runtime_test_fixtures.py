from pathlib import Path

import pytest


@pytest.fixture()
def novel_project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("灯塔第三十三次错误闪光。\n", encoding="utf-8")
    (tmp_path / "设定" / "人物.md").write_text("林岚：审计员。\n", encoding="utf-8")
    return tmp_path
