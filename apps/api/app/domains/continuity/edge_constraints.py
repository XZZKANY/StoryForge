"""结构化连续性边的写入前矛盾校验引擎（纯函数，不挂 HTTP 端点）。

与 story_memory 的字面撞词检测互补：这里用递归可达性 + 时间窗交叠，
判定只能靠结构才能发现的矛盾——关系成环、时间线倒错、状态时间窗冲突。
所有 SQL 写成 SQLite / PostgreSQL 双兼容子集（标准 WITH RECURSIVE）。
"""

from __future__ import annotations

from hashlib import sha1
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

ConflictSeverity = Literal["low", "medium", "high", "blocking"]
EdgeKind = Literal["relationship", "timeline_order", "status"]

# 递归回溯的最大深度护栏：即便历史数据已存在环，也能保证查询终止。
_MAX_REACH_DEPTH = 64
_OPEN_WINDOW = 10**9


class ContinuityEdgeCandidate(BaseModel):
    """写入前的候选边，承载一次结构判定所需的全部字段。"""

    edge_kind: EdgeKind
    subject_ref: str = Field(min_length=1, max_length=160)
    predicate: str = Field(min_length=1, max_length=80)
    object_ref: str = Field(min_length=1, max_length=160)
    valid_from_chapter: int = Field(default=1, ge=1)
    valid_to_chapter: int | None = Field(default=None, ge=1)


class ContinuityConflict(BaseModel):
    """结构矛盾报告，字段约定镜像 story_memory 的 MemoryConflict。"""

    conflict_id: str
    book_id: int
    edge_kind: EdgeKind
    subject_ref: str
    object_ref: str
    severity: ConflictSeverity
    reason: str
    source_refs: list[str]


def _conflict_id(parts: list[str]) -> str:
    raw = "|".join(parts)
    return f"continuity_{sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def _ranges_overlap(
    left_from: int,
    left_to: int | None,
    right_from: int,
    right_to: int | None,
) -> bool:
    """章节区间交叠判定，等价 story_memory._ranges_overlap，避免跨域 import 私有符号。"""

    left_end = left_to if left_to is not None else _OPEN_WINDOW
    right_end = right_to if right_to is not None else _OPEN_WINDOW
    return max(left_from, right_from) <= min(left_end, right_end)


def _is_reachable(session: Session, *, book_id: int, edge_kind: str, start: str, target: str) -> bool:
    """沿同 edge_kind 的有向边（subject_ref -> object_ref）从 start 回溯，判定能否到达 target。"""

    statement = text(
        """
        WITH RECURSIVE reach(node, depth) AS (
            SELECT object_ref, 1
            FROM continuity_edges
            WHERE book_id = :book_id AND edge_kind = :edge_kind AND subject_ref = :start
            UNION ALL
            SELECT e.object_ref, r.depth + 1
            FROM continuity_edges e
            JOIN reach r ON e.subject_ref = r.node
            WHERE e.book_id = :book_id AND e.edge_kind = :edge_kind AND r.depth < :max_depth
        )
        SELECT 1 FROM reach WHERE node = :target LIMIT 1
        """
    )
    row = session.execute(
        statement,
        {
            "book_id": book_id,
            "edge_kind": edge_kind,
            "start": start,
            "target": target,
            "max_depth": _MAX_REACH_DEPTH,
        },
    ).first()
    return row is not None


def _check_reachability_cycle(
    session: Session,
    *,
    book_id: int,
    candidate: ContinuityEdgeCandidate,
) -> ContinuityConflict | None:
    """关系成环 / 时间线倒错：候选边 subject->object 若使 object 已可达 subject，则成环。"""

    if candidate.subject_ref == candidate.object_ref:
        reason = "候选边自指（subject_ref 等于 object_ref），构成最小环"
    elif _is_reachable(
        session,
        book_id=book_id,
        edge_kind=candidate.edge_kind,
        start=candidate.object_ref,
        target=candidate.subject_ref,
    ):
        if candidate.edge_kind == "timeline_order":
            reason = (
                f"时间线倒错：已存在 {candidate.object_ref} → … → {candidate.subject_ref} 的先后链，"
                f"候选 {candidate.subject_ref} {candidate.predicate} {candidate.object_ref} 会构成环"
            )
        else:
            reason = (
                f"关系成环：已存在 {candidate.object_ref} → … → {candidate.subject_ref} 的关系链，"
                f"候选 {candidate.subject_ref} {candidate.predicate} {candidate.object_ref} 会闭合环"
            )
    else:
        return None

    return ContinuityConflict(
        conflict_id=_conflict_id(
            [str(book_id), candidate.edge_kind, candidate.subject_ref, candidate.predicate, candidate.object_ref]
        ),
        book_id=book_id,
        edge_kind=candidate.edge_kind,
        subject_ref=candidate.subject_ref,
        object_ref=candidate.object_ref,
        severity="blocking",
        reason=reason,
        source_refs=[
            f"{candidate.edge_kind}:{candidate.subject_ref}-{candidate.predicate}->{candidate.object_ref}"
        ],
    )


def _check_status_window(
    session: Session,
    *,
    book_id: int,
    candidate: ContinuityEdgeCandidate,
) -> list[ContinuityConflict]:
    """状态时间窗冲突：同 subject_ref + predicate、不同 object_ref，且章节窗口交叠。"""

    statement = text(
        """
        SELECT subject_ref, predicate, object_ref, valid_from_chapter, valid_to_chapter
        FROM continuity_edges
        WHERE book_id = :book_id
          AND edge_kind = 'status'
          AND subject_ref = :subject_ref
          AND predicate = :predicate
          AND object_ref <> :object_ref
        """
    )
    rows = session.execute(
        statement,
        {
            "book_id": book_id,
            "subject_ref": candidate.subject_ref,
            "predicate": candidate.predicate,
            "object_ref": candidate.object_ref,
        },
    ).all()

    conflicts: list[ContinuityConflict] = []
    for row in rows:
        if not _ranges_overlap(
            candidate.valid_from_chapter,
            candidate.valid_to_chapter,
            row.valid_from_chapter,
            row.valid_to_chapter,
        ):
            continue
        conflicts.append(
            ContinuityConflict(
                conflict_id=_conflict_id(
                    [
                        str(book_id),
                        "status",
                        candidate.subject_ref,
                        candidate.predicate,
                        candidate.object_ref,
                        row.object_ref,
                    ]
                ),
                book_id=book_id,
                edge_kind="status",
                subject_ref=candidate.subject_ref,
                object_ref=candidate.object_ref,
                severity="high",
                reason=(
                    f"状态时间窗冲突：{candidate.subject_ref} 的 {candidate.predicate} 在重叠章节窗口内"
                    f"同时为 {row.object_ref} 与 {candidate.object_ref}"
                ),
                source_refs=[
                    f"status:{candidate.subject_ref}-{candidate.predicate}->{candidate.object_ref}",
                    f"status:{row.subject_ref}-{row.predicate}->{row.object_ref}",
                ],
            )
        )
    return conflicts


def check_edge_constraints(
    session: Session,
    *,
    book_id: int,
    candidate: ContinuityEdgeCandidate,
    chapter_ordinal: int | None = None,
) -> list[ContinuityConflict]:
    """对候选边在写入前做结构矛盾校验，返回稳定的冲突列表（无冲突即空列表，不静默吞掉）。

    chapter_ordinal 为当前推进章节上下文；candidate 自带窗口时以 candidate 为准。
    """

    if chapter_ordinal is not None and candidate.valid_from_chapter <= 1:
        candidate = candidate.model_copy(update={"valid_from_chapter": chapter_ordinal})

    conflicts: list[ContinuityConflict] = []
    if candidate.edge_kind in ("relationship", "timeline_order"):
        cycle = _check_reachability_cycle(session, book_id=book_id, candidate=candidate)
        if cycle is not None:
            conflicts.append(cycle)
    elif candidate.edge_kind == "status":
        conflicts.extend(_check_status_window(session, book_id=book_id, candidate=candidate))
    return conflicts
