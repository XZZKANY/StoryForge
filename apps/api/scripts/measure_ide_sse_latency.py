from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Generator, Sequence
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from app.main import app
from tests.test_book_runs import seed_locked_blueprint

TARGET_P95_MS = 500
BLOCKING_P95_MS = 1200


def percentile_95(values: Sequence[float]) -> float:
    """使用 nearest-rank 计算 p95，样本少时保持可解释。"""

    if not values:
        raise ValueError("至少需要 1 个延迟样本。")
    ordered = sorted(values)
    index = max(0, int((len(ordered) * 0.95) + 0.999999) - 1)
    return ordered[min(index, len(ordered) - 1)]


def classify_latency(p95_ms: float) -> str:
    """按 master plan 阈值分类 SSE p95 状态。"""

    if p95_ms > BLOCKING_P95_MS:
        return "block"
    if p95_ms > TARGET_P95_MS:
        return "warn"
    return "pass"


def extract_sse_events(body: str) -> list[str]:
    """从 SSE 文本中提取 event 名称，用于报告证明测到的是目标事件流。"""

    events: list[str] = []
    for line in body.splitlines():
        if line.startswith("event: "):
            events.append(line.removeprefix("event: ").strip())
    return events


def measure_ide_sse_latency(
    client: TestClient,
    book_run_id: int,
    *,
    samples: int = 25,
    output_path: Path | None = None,
) -> dict[str, object]:
    """多次读取 IDE SSE 快照端点并输出本地 TestClient p95 基线。"""

    if samples < 1:
        raise ValueError("samples 必须大于等于 1。")

    route = f"/api/ide/runs/{book_run_id}/events"
    latencies_ms: list[float] = []
    content_type = ""
    body = ""
    for _ in range(samples):
        start = perf_counter()
        response = client.get(route)
        elapsed_ms = (perf_counter() - start) * 1000
        if response.status_code != 200:
            raise RuntimeError(f"SSE 端点返回 {response.status_code}: {response.text}")
        latencies_ms.append(round(elapsed_ms, 3))
        content_type = response.headers.get("content-type", "")
        body = response.text

    p95_ms = round(percentile_95(latencies_ms), 3)
    report: dict[str, object] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "method": "FastAPI TestClient 本地请求 /api/ide/runs/{id}/events；不等同真实浏览器 EventSource 或网络 e2e。",
        "route": route,
        "samples": samples,
        "target_p95_ms": TARGET_P95_MS,
        "blocking_p95_ms": BLOCKING_P95_MS,
        "p95_ms": p95_ms,
        "min_ms": min(latencies_ms),
        "max_ms": max(latencies_ms),
        "latencies_ms": latencies_ms,
        "status": classify_latency(p95_ms),
        "content_type": content_type,
        "events": extract_sse_events(body),
    }

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def _create_client() -> tuple[TestClient, sessionmaker[Session]]:
    """为 CLI 构造与 pytest 夹具一致的内存数据库和 TestClient。"""

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    def override_get_session() -> Generator[Session, None, None]:
        db_session = session_factory()
        try:
            yield db_session
        finally:
            db_session.close()

    app.dependency_overrides[get_session] = override_get_session
    api_key = os.getenv("STORYFORGE_API_KEY", "local-dev-key")
    return TestClient(app, headers={"X-StoryForge-API-Key": api_key}), session_factory


def _seed_completed_book_run(client: TestClient, session_factory: sessionmaker[Session]) -> int:
    """创建带 checkpoint/budget/completed 事件的 BookRun，作为 CLI 默认测量样本。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 500}).json()
    with session_factory() as session:
        apply_book_run_progress(
            session,
            int(created["id"]),
            BookRunProgressUpdate(
                status="completed",
                current_chapter_index=3,
                progress={
                    "completed_chapters": [
                        {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                        {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                        {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
                    ],
                    "budget": {"tokens_used": 420, "estimated_cost": 0.25},
                },
            ),
        )
    return int(created["id"])


def main(argv: Sequence[str] | None = None) -> int:
    """CLI 入口：生成 IDE SSE p95 本地基线报告。"""

    parser = argparse.ArgumentParser(description="测量 IDE SSE 本地 TestClient p95 延迟。")
    parser.add_argument("--samples", type=int, default=25)
    parser.add_argument("--out", type=Path, default=Path("../../.codex/ide-sse-latency-baseline.json"))
    args = parser.parse_args(argv)

    client, session_factory = _create_client()
    try:
        book_run_id = _seed_completed_book_run(client, session_factory)
        report = measure_ide_sse_latency(client, book_run_id, samples=args.samples, output_path=args.out)
        print(
            f"IDE SSE p95：{report['p95_ms']}ms，状态 {report['status']}，样本 {report['samples']}，报告 {args.out}"
        )
        return 1 if report["status"] == "block" else 0
    finally:
        client.close()
        app.dependency_overrides.clear()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
