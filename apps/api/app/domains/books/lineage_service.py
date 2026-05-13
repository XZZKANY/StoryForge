from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset, EvidenceLink
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord


class ChapterWritebackError(ValueError):
    """批准回写无法定位作品、章节、场景或资产时抛出。"""


@dataclass(frozen=True)
class ChapterWritebackApproval:
    """人工批准后的章节正文和可追溯回写信息。"""

    book_id: int
    chapter_id: int
    approved_content: str
    diff_summary: str
    approved_by: str = "人工审批"
    source_asset_ids: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class ChapterWritebackResult:
    """批准回写后返回关键记录标识，避免调用方读取 ORM 延迟关系。"""

    chapter_id: int
    scene_id: int
    final_asset_id: int
    diff_asset_id: int
    evidence_link_id: int
    continuity_record_id: int


def approve_chapter_writeback(session: Session, payload: ChapterWritebackApproval) -> ChapterWritebackResult:
    """将批准正文、版本资产、差异摘要、证据和连续性记录作为一个事务写入。"""

    try:
        book = session.get(Book, payload.book_id)
        if book is None:
            raise ChapterWritebackError("作品不存在，无法批准回写。")

        chapter = session.get(Chapter, payload.chapter_id)
        if chapter is None or chapter.book_id != book.id:
            raise ChapterWritebackError("章节不存在或不属于指定作品，无法批准回写。")

        scene = session.scalars(
            select(Scene).where(Scene.chapter_id == chapter.id).order_by(Scene.ordinal, Scene.id).limit(1)
        ).first()
        if scene is None:
            raise ChapterWritebackError("章节下没有场景，无法批准回写。")

        source_assets = _load_source_assets(session, payload, scene.id)
        for asset in source_assets:
            asset.status = "approved"

        scene.content = payload.approved_content
        scene.status = "approved"
        chapter.status = "approved"

        final_asset = Asset(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="chapter_version",
            lineage_key=f"chapter:{chapter.id}:approved_text",
            name=f"{chapter.title} 最终正文",
            status="approved",
            payload={
                "chapter_id": chapter.id,
                "scene_id": scene.id,
                "content": payload.approved_content,
                "approved_by": payload.approved_by,
                "source_asset_ids": [asset.id for asset in source_assets],
            },
            version=_next_asset_version(session, f"chapter:{chapter.id}:approved_text"),
        )
        session.add(final_asset)
        session.flush()

        diff_asset = Asset(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="asset_diff",
            lineage_key=f"chapter:{chapter.id}:diff_summary",
            name=f"{chapter.title} 批准差异摘要",
            status="approved",
            payload={
                "chapter_id": chapter.id,
                "scene_id": scene.id,
                "summary": payload.diff_summary,
                "final_asset_id": final_asset.id,
                "source_asset_ids": [asset.id for asset in source_assets],
            },
            version=_next_asset_version(session, f"chapter:{chapter.id}:diff_summary"),
        )
        session.add(diff_asset)
        session.flush()

        evidence_link = EvidenceLink(
            asset_id=final_asset.id,
            scene_id=scene.id,
            evidence_type="approval_writeback",
            source_ref=f"chapter:{chapter.id}:approved",
            rationale=payload.diff_summary,
        )
        session.add(evidence_link)
        session.flush()

        continuity_record = ContinuityRecord(
            book_id=book.id,
            scene_id=scene.id,
            record_type="chapter_approval",
            subject=chapter.title,
            status="active",
            payload={
                "chapter_id": chapter.id,
                "approved_content": payload.approved_content,
                "diff_summary": payload.diff_summary,
                "approved_by": payload.approved_by,
                "final_asset_id": final_asset.id,
                "diff_asset_id": diff_asset.id,
                "evidence_link_id": evidence_link.id,
            },
            version=1,
        )
        session.add(continuity_record)
        session.flush()

        result = ChapterWritebackResult(
            chapter_id=chapter.id,
            scene_id=scene.id,
            final_asset_id=final_asset.id,
            diff_asset_id=diff_asset.id,
            evidence_link_id=evidence_link.id,
            continuity_record_id=continuity_record.id,
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


def _load_source_assets(session: Session, payload: ChapterWritebackApproval, scene_id: int) -> list[Asset]:
    """按请求顺序读取同作品同场景或全局资产，避免跨作品状态污染。"""

    requested_ids = list(dict.fromkeys(payload.source_asset_ids))
    if not requested_ids:
        return []
    assets = session.scalars(
        select(Asset).where(
            Asset.id.in_(requested_ids),
            Asset.book_id == payload.book_id,
            (Asset.scene_id == scene_id) | Asset.scene_id.is_(None),
        )
    ).all()
    asset_by_id = {asset.id: asset for asset in assets}
    if len(asset_by_id) != len(requested_ids):
        raise ChapterWritebackError("存在无法回写的来源资产，无法批准回写。")
    return [asset_by_id[asset_id] for asset_id in requested_ids]


def _next_asset_version(session: Session, lineage_key: str) -> int:
    """读取同一谱系的下一版本号，保持章节版本和差异摘要可追溯。"""

    latest_version = session.scalar(select(func.max(Asset.version)).where(Asset.lineage_key == lineage_key))
    return int(latest_version or 0) + 1
