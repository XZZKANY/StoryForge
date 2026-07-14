from __future__ import annotations

import json
from pathlib import Path

from app.domains.agent_runs import canon_store

# 表面形刻意互不为子串（真实别名多为独立称谓 / 头衔），避免嵌套子串重复计数。
_QINGYAN = {
    "id": "char_qingyan",
    "canonical_name": "青岩",
    "kind": "character",
    "aliases": ["剑主"],
}
_YUER = {"id": "char_yuer", "canonical_name": "月儿", "kind": "character", "aliases": []}
def _write_canon(root: Path, canon: dict) -> None:
    canon_dir = root / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True, exist_ok=True)
    (canon_dir / "canon.json").write_text(json.dumps(canon, ensure_ascii=False), encoding="utf-8")


def _write_hooks(root: Path, hooks: list[dict]) -> None:
    canon_store.write_hooks(str(root), {"version": 1, "hooks": hooks})

