"""L5：APP_VERSION 是 sidecar 版本握手单点，与 pyproject.toml / tauri.conf.json 手动对齐。

三处漂移的后果：Tauri 起服据 /health/ready 的 app_version 与桌面应用版本比对，不符即强杀
sidecar 重启。若只 bump 了桌面/依赖版本而漏改 APP_VERSION，一个**版本正确匹配**的 sidecar
会在每次起服被误判成旧孤儿 → 反复 kill/respawn（甚至与 #89 的 kill-orphan 逻辑成循环）。
这条测试把三处钉在一起，任一漂移即红，逼迫同步。
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from app.common.version import APP_VERSION

_API_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _API_ROOT.parents[1]
_TAURI_CONF = _REPO_ROOT / "apps" / "desktop" / "src-tauri" / "tauri.conf.json"


def _pyproject_version() -> str:
    data = tomllib.loads((_API_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return data["project"]["version"]


def _tauri_conf_version() -> str:
    return json.loads(_TAURI_CONF.read_text(encoding="utf-8"))["version"]


def test_app_version_matches_pyproject() -> None:
    assert _pyproject_version() == APP_VERSION, (
        "app/common/version.py 的 APP_VERSION 与 apps/api/pyproject.toml 的 version 漂移，"
        "会破坏 sidecar 版本握手，请同步。"
    )


def test_app_version_matches_tauri_conf() -> None:
    assert _tauri_conf_version() == APP_VERSION, (
        "app/common/version.py 的 APP_VERSION 与 tauri.conf.json 的 version 漂移，"
        "会让桌面端把匹配的 sidecar 误判成孤儿反复强杀，请同步。"
    )
