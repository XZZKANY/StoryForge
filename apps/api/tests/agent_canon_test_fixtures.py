from pathlib import Path

import pytest


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text(
        "青岩踏入观星台。\n剑主握紧断魂刀。\n", encoding="utf-8"
    )
    (tmp_path / "正文" / "第02章.md").write_text(
        "月儿远远望着。\n青岩转身离去。\n", encoding="utf-8"
    )
    return tmp_path
