"""SQLite sidecar 的 Alembic 驱动层。

设计约束（见 arch-review-blueprint-2026-07-03 §7 W2）：历史迁移链无法在 SQLite 上
从 base 重放（`20260527_0001` 用 `op.create_foreign_key`，SQLite 需 batch 模式），因此
**建表仍由 create_all 负责**；本模块只承担「版本记账 + 前向演进」——让存量库被纳入
alembic 管理（stamp head），此后任何 ORM 列变更以 batch 安全的迁移经 `upgrade head` 落地，
从而堵死 F01：create_all 只建表不 ALTER、发版加列后存量库缺列崩服。
"""

from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine

from alembic import command

logger = logging.getLogger(__name__)

_BACKUP_SUFFIX = ".pre-alembic"
_BACKUP_KEEP = 3


def _alembic_script_location() -> Path:
    """定位 alembic 脚本目录，兼顾源码运行与 PyInstaller 冻结 exe。

    冻结态下 build-api-sidecar.mjs 以 --add-data 把 alembic/ 打进 _MEIPASS；
    源码态下本文件位于 app/db/migrations.py，parents[2] 即 apps/api。"""

    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        return base / "alembic"
    return Path(__file__).resolve().parents[2] / "alembic"


def build_alembic_config(engine: Engine) -> Config:
    """以编程方式构造 Config（不读磁盘 alembic.ini），供起服路径驱动迁移。"""

    config = Config()
    config.set_main_option("script_location", str(_alembic_script_location()))
    config.set_main_option("sqlalchemy.url", engine.url.render_as_string(hide_password=False))
    return config


def head_revision(engine: Engine) -> str | None:
    """迁移脚本目录当前 head 版本号（单 head，多 head 会由 alembic 抛错暴露）。"""

    script = ScriptDirectory.from_config(build_alembic_config(engine))
    return script.get_current_head()


def current_revision(engine: Engine) -> str | None:
    """库内 alembic_version 记录的版本号；未纳管返回 None。"""

    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def stamp_head(engine: Engine) -> None:
    """把库标记为 head，不执行任何 DDL（用于 create_all 建好表后纳入 alembic 管理）。"""

    config = build_alembic_config(engine)
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.stamp(config, "head")


def upgrade_head(engine: Engine) -> None:
    """应用所有未落地迁移（SQLite 走 batch 模式，见 env.py）。"""

    config = build_alembic_config(engine)
    with engine.connect() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def _sqlite_file_path(engine: Engine) -> Path | None:
    database = engine.url.database
    if not database or database == ":memory:":
        return None
    return Path(database)


def quick_check(engine: Engine) -> tuple[bool, str]:
    """PRAGMA quick_check：返回 (是否完好, 明细)。用于纳管前拦截损坏库。"""

    with engine.connect() as connection:
        rows = connection.exec_driver_sql("PRAGMA quick_check").fetchall()
    detail = "; ".join(str(row[0]) for row in rows)
    return (len(rows) == 1 and rows[0][0] == "ok"), detail


def backup_sqlite_database(engine: Engine, tag: str) -> Path | None:
    """用 SQLite backup API 做一致快照（规避 WAL 半截拷贝），命名带版本号并保留最近 3 份。

    恢复步骤：停 sidecar → 用 `<库名>.pre-alembic-<版本>.bak` 覆盖回原库文件 → 重启旧版 exe。"""

    source_path = _sqlite_file_path(engine)
    if source_path is None or not source_path.exists():
        return None

    safe_tag = "".join(ch if (ch.isalnum() or ch in "._-") else "_" for ch in tag) or "unknown"
    backup_path = source_path.with_name(f"{source_path.name}{_BACKUP_SUFFIX}-{safe_tag}.bak")

    source = sqlite3.connect(str(source_path))
    try:
        destination = sqlite3.connect(str(backup_path))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()

    _prune_backups(source_path)
    logger.info("sqlite backup written: %s", backup_path)
    return backup_path


def _prune_backups(source_path: Path, keep: int = _BACKUP_KEEP) -> None:
    pattern = f"{source_path.name}{_BACKUP_SUFFIX}-*.bak"
    backups = sorted(
        source_path.parent.glob(pattern),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale in backups[keep:]:
        try:
            stale.unlink()
        except OSError:  # noqa: PERF203 - 清理失败不阻断起服
            logger.warning("stale sqlite backup 清理失败: %s", stale, exc_info=True)
