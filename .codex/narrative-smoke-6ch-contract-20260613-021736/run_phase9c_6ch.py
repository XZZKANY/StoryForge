import json
import os
from pathlib import Path

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import SessionLocal, get_engine
from app.domains.book_runs.phase9c_narrative_smoke import run_phase9c_narrative_smoke

out = Path(os.environ["SMOKE_OUT_DIR"])
Base.metadata.create_all(get_engine())
with SessionLocal() as session:
    result = run_phase9c_narrative_smoke(
        session,
        chapter_count=6,
        token_budget=180000,
        target_word_count=7200,
        chapter_word_count_min=900,
        chapter_word_count_max=1500,
        output_dir=out,
        env=os.environ,
    )
summary = {
    "output_dir": str(out),
    "chapter_count": result.chapter_count,
    "sidecars": {k: str(v) for k, v in result.sidecar_paths.items()},
}
(out / "runner-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
