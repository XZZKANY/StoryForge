from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.assets.schemas import AssetCreate, AssetUpdate
from app.domains.assets.service import create_asset, update_asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.series.models import Series, SeriesBook, StylePackApplication
from app.domains.style_packs.schemas import StylePackApplyCreate, StylePackCreate, StylePackUpdate


class StylePackInputError(ValueError):
    """风格包请求无法定位资产或应用范围时抛出。"""


def create_style_pack(session: Session, payload: StylePackCreate) -> Asset:
    """创建风格包资产。"""

    return create_asset(
        session,
        AssetCreate(book_id=payload.book_id, asset_type="style_pack", name=payload.name, payload=payload.payload),
    )


def update_style_pack(session: Session, asset_id: int, payload: StylePackUpdate) -> Asset:
    """更新风格包并保持 style_pack 资产类型。"""

    source = _load_style_pack(session, asset_id)
    changes = payload.model_dump(exclude_unset=True)
    merged_payload = dict(source.payload or {})
    if "payload" in changes and changes["payload"] is not None:
        merged_payload.update(changes["payload"])
    return update_asset(
        session,
        asset_id,
        AssetUpdate(
            name=changes.get("name", source.name),
            status=changes.get("status", source.status),
            payload=merged_payload,
        ),
    )


def apply_style_pack(session: Session, asset_id: int, payload: StylePackApplyCreate) -> StylePackApplication:
    """将风格包应用到系列、作品或场景范围。"""

    if asset_id != payload.style_pack_asset_id:
        raise StylePackInputError("路由风格包与请求风格包不一致。")
    _load_style_pack(session, asset_id)
    _validate_scope(session, payload)

    application = StylePackApplication(
        style_pack_asset_id=asset_id,
        series_id=payload.series_id,
        book_id=payload.book_id,
        scene_id=payload.scene_id,
        status="active",
        payload=payload.payload,
        version=1,
    )
    session.add(application)
    session.commit()
    session.refresh(application)
    return application


def get_effective_style_rules(session: Session, book_id: int, scene_id: int | None = None) -> dict:
    """按系列、作品、场景顺序合并风格规则并去重。"""

    if session.get(Book, book_id) is None:
        raise StylePackInputError("作品不存在，无法读取生效风格规则。")
    if scene_id is not None and _scene_book_id(session, scene_id) != book_id:
        raise StylePackInputError("场景不存在或不属于指定作品。")

    series_ids = session.scalars(select(SeriesBook.series_id).where(SeriesBook.book_id == book_id)).all()
    scopes = [
        StylePackApplication.series_id.in_(series_ids) if series_ids else None,
        StylePackApplication.book_id == book_id,
        StylePackApplication.scene_id == scene_id if scene_id is not None else None,
    ]
    applications: list[StylePackApplication] = []
    for scope in scopes:
        if scope is None:
            continue
        applications.extend(
            session.scalars(
                select(StylePackApplication)
                .where(scope, StylePackApplication.status == "active")
                .order_by(StylePackApplication.id)
            ).all()
        )

    rules: list[str] = []
    banned_phrases: list[str] = []
    preferred_patterns: list[str] = []
    style_pack_asset_ids: list[int] = []
    voice: str | None = None
    for application in applications:
        asset = _load_style_pack(session, application.style_pack_asset_id)
        payload = _merged_payload(asset.payload, application.payload)
        style_pack_asset_ids.append(asset.id)
        rules = _append_unique(rules, payload.get("rules", []))
        banned_phrases = _append_unique(banned_phrases, payload.get("banned_phrases", []))
        preferred_patterns = _append_unique(preferred_patterns, payload.get("preferred_patterns", []))
        if payload.get("voice"):
            voice = str(payload["voice"])

    return {
        "book_id": book_id,
        "scene_id": scene_id,
        "style_pack_asset_ids": style_pack_asset_ids,
        "rules": rules,
        "voice": voice,
        "banned_phrases": banned_phrases,
        "preferred_patterns": preferred_patterns,
    }


def _load_style_pack(session: Session, asset_id: int) -> Asset:
    asset = session.get(Asset, asset_id)
    if asset is None or asset.asset_type != "style_pack":
        raise StylePackInputError("风格包不存在，无法处理。")
    return asset


def _validate_scope(session: Session, payload: StylePackApplyCreate) -> None:
    if payload.series_id is not None and session.get(Series, payload.series_id) is None:
        raise StylePackInputError("系列不存在，无法应用风格包。")
    if payload.book_id is not None and session.get(Book, payload.book_id) is None:
        raise StylePackInputError("作品不存在，无法应用风格包。")
    if payload.scene_id is not None and _scene_book_id(session, payload.scene_id) is None:
        raise StylePackInputError("场景不存在，无法应用风格包。")


def _scene_book_id(session: Session, scene_id: int) -> int | None:
    return session.scalar(select(Chapter.book_id).join(Scene, Scene.chapter_id == Chapter.id).where(Scene.id == scene_id))


def _merged_payload(asset_payload: dict, application_payload: dict) -> dict:
    merged = dict(asset_payload or {})
    for key, value in (application_payload or {}).items():
        if key in {"rules", "banned_phrases", "preferred_patterns"}:
            merged[key] = _append_unique(list(merged.get(key, [])), value)
        else:
            merged[key] = value
    return merged


def _append_unique(values: list[str], additions) -> list[str]:
    result = list(values)
    for item in additions or []:
        text = str(item)
        if text not in result:
            result.append(text)
    return result
