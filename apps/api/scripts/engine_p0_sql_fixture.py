"""Create owned synthetic legacy SQLite fixtures; never open an author's database."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from contextlib import closing
from datetime import datetime
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    output = parser.parse_args().output.resolve()
    root = Path(__file__).resolve().parents[3]
    output.relative_to(root / "output" / "ts-engine-p0")
    output.mkdir(parents=True, exist_ok=True)
    original = output / "synthetic-original.sqlite3"
    readonly = output / "synthetic-readonly.sqlite3"
    if original.exists() or readonly.exists():
        raise FileExistsError("Refusing to overwrite previous probe databases")
    for name in list(os.environ):
        if name.startswith(("STORYFORGE_", "OPENAI_", "ANTHROPIC_", "GEMINI_")):
            os.environ.pop(name)
    os.environ["PYDANTIC_DISABLE_PLUGINS"] = "__all__"
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    from sqlalchemy import create_engine

    from app.db.base import Base
    from app.domains.agent_runs import models as agent_models
    from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall

    engine = create_engine(f"sqlite:///{original.as_posix()}")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
        for index in range(1, 17):
            timestamp = datetime(2026, 1, index, 12, 34, 56, 123456)
            connection.execute(
                AssistantSession.__table__.insert().values(
                    id=index,
                    title=f"合成会话 {index} 🧪",
                    task_type="chat",
                    project_path=None if index % 2 else f"D:/synthetic/正文/{index}",
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
            connection.execute(
                AssistantMessage.__table__.insert().values(
                    id=index,
                    session_id=index,
                    role="user",
                    content=f"合成消息\r\n第 {index} 段",
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
        connection.execute(
            AssistantToolCall.__table__.insert().values(
                id=1,
                session_id=1,
                tool_name="synthetic",
                status="completed",
                input_summary={"文本": "𠀀\r\n", "nested": [True, None, 1]},
                output_summary={"ok": True},
                error_message=None,
                related_type=None,
                related_id=None,
                started_at=None,
                finished_at=datetime(2026, 1, 1, 12, 34, 56),
                created_at=datetime(2026, 1, 1),
                updated_at=datetime(2026, 1, 1),
            )
        )
    engine.dispose()
    with closing(sqlite3.connect(original)) as connection:
        checkpoint = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if checkpoint[0] != 0:
            raise RuntimeError(f"WAL checkpoint failed: {checkpoint}")
    shutil.copyfile(original, readonly)
    queries = {
        "sessions": "SELECT id, title, task_type, project_path, created_at, updated_at FROM assistant_sessions ORDER BY id",
        "messages": "SELECT id, session_id, role, content, created_at FROM assistant_messages ORDER BY id",
        "tool_calls": "SELECT id, input_summary, output_summary, error_message, related_id, started_at, finished_at FROM assistant_tool_calls ORDER BY id",
        "tables": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    }
    with closing(sqlite3.connect(f"file:{readonly.as_posix()}?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        expected = {name: [dict(row) for row in connection.execute(query)] for name, query in queries.items()}
    snapshot = {
        "synthetic": True,
        "original": original.as_posix(),
        "readonly": readonly.as_posix(),
        "new": (output / "synthetic-new.sqlite3").as_posix(),
        "missing": (output / "synthetic-missing.sqlite3").as_posix(),
        "schema_tables": sorted(Base.metadata.tables),
        "schema_sources": {
            str(Path(module.__file__).relative_to(root)).replace("\\", "/"): hashlib.sha256(
                Path(module.__file__).read_bytes()
            ).hexdigest()
            for module in [agent_models, sys.modules[AssistantSession.__module__]]
        },
        "queries": queries,
        "expected": expected,
    }
    (output / "sql-fixture.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


if __name__ == "__main__":
    main()
