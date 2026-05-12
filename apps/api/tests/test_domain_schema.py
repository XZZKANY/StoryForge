from __future__ import annotations

from sqlalchemy.orm import RelationshipProperty

from app.db.base import Base
from app.domains.assets.models import Asset, EvidenceLink
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch


ENTITY_CLASSES = (
    Book,
    Chapter,
    Scene,
    Asset,
    ContinuityRecord,
    ScenePacket,
    JudgeIssue,
    RepairPatch,
    JobRun,
    EvidenceLink,
)

VERSIONED_CLASSES = (Asset, ContinuityRecord, ScenePacket, RepairPatch)

EXPECTED_TABLES = {
    "books",
    "chapters",
    "scenes",
    "assets",
    "continuity_records",
    "scene_packets",
    "judge_issues",
    "repair_patches",
    "job_runs",
    "evidence_links",
}


def test_entities_are_importable_and_registered() -> None:
    assert {entity.__name__ for entity in ENTITY_CLASSES} == {
        "Book",
        "Chapter",
        "Scene",
        "Asset",
        "ContinuityRecord",
        "ScenePacket",
        "JudgeIssue",
        "RepairPatch",
        "JobRun",
        "EvidenceLink",
    }
    assert EXPECTED_TABLES.issubset(set(Base.metadata.tables))


def test_entities_have_common_columns() -> None:
    for entity in ENTITY_CLASSES:
        columns = entity.__table__.columns
        assert "id" in columns, entity.__name__
        assert "created_at" in columns, entity.__name__
        assert "updated_at" in columns, entity.__name__


def test_versioned_entities_have_version_column() -> None:
    for entity in VERSIONED_CLASSES:
        assert "version" in entity.__table__.columns, entity.__name__


def test_book_chapter_scene_relationship_chain() -> None:
    book_relationships = Book.__mapper__.relationships
    chapter_relationships = Chapter.__mapper__.relationships
    scene_relationships = Scene.__mapper__.relationships

    assert isinstance(book_relationships["chapters"], RelationshipProperty)
    assert isinstance(chapter_relationships["book"], RelationshipProperty)
    assert isinstance(chapter_relationships["scenes"], RelationshipProperty)
    assert isinstance(scene_relationships["chapter"], RelationshipProperty)

    assert Chapter.__table__.columns["book_id"].foreign_keys
    assert Scene.__table__.columns["chapter_id"].foreign_keys


def test_metadata_foreign_key_structure() -> None:
    foreign_key_targets = {
        str(foreign_key.column)
        for table in Base.metadata.tables.values()
        for column in table.columns
        for foreign_key in column.foreign_keys
    }

    assert "books.id" in foreign_key_targets
    assert "chapters.id" in foreign_key_targets
    assert "scenes.id" in foreign_key_targets
    assert "assets.id" in foreign_key_targets
    assert "scene_packets.id" in foreign_key_targets
    assert "judge_issues.id" in foreign_key_targets
    assert "job_runs.id" in foreign_key_targets


def test_core_status_and_payload_columns() -> None:
    assert "status" in Book.__table__.columns
    assert "content" in Scene.__table__.columns
    assert "payload" in Asset.__table__.columns
    assert "packet" in ScenePacket.__table__.columns
    assert "issue_type" in JudgeIssue.__table__.columns
    assert "patch" in RepairPatch.__table__.columns
    assert "progress" in JobRun.__table__.columns
    assert "evidence_type" in EvidenceLink.__table__.columns
