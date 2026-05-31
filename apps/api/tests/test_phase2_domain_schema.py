from __future__ import annotations

import subprocess
import sys

from sqlalchemy.orm import RelationshipProperty

from app.db.base import Base
from app.domains.series.models import Series, SeriesMemory, SeriesMemoryEvidence

PH2_ENTITY_CLASSES = (Series, SeriesMemory, SeriesMemoryEvidence)

EXPECTED_TABLES = {
    "series",
    "series_memories",
    "series_memory_evidence",
}


def test_phase2_entities_are_registered() -> None:
    """Phase 2 系列和系列记忆模型必须注册到统一元数据。"""

    assert {entity.__name__ for entity in PH2_ENTITY_CLASSES} == {
        "Series",
        "SeriesMemory",
        "SeriesMemoryEvidence",
    }
    assert EXPECTED_TABLES.issubset(set(Base.metadata.tables))


def test_phase2_entities_have_common_columns() -> None:
    """所有 Phase 2 实体沿用统一主键和审计时间字段。"""

    for entity in PH2_ENTITY_CLASSES:
        columns = entity.__table__.columns
        assert "id" in columns, entity.__name__
        assert "created_at" in columns, entity.__name__
        assert "updated_at" in columns, entity.__name__


def test_phase2_versioned_entities_have_version_column() -> None:
    """系列记忆按谱系保留版本，供跨书设定回溯。"""

    assert "version" in SeriesMemory.__table__.columns
    assert "version" not in SeriesMemoryEvidence.__table__.columns


def test_series_relationship_chain() -> None:
    """系列、记忆和证据之间必须建立可遍历关系。"""

    assert isinstance(Series.__mapper__.relationships["memories"], RelationshipProperty)
    assert isinstance(SeriesMemory.__mapper__.relationships["series"], RelationshipProperty)
    assert isinstance(SeriesMemory.__mapper__.relationships["evidence"], RelationshipProperty)
    assert isinstance(SeriesMemoryEvidence.__mapper__.relationships["memory"], RelationshipProperty)


def test_phase2_foreign_key_structure() -> None:
    """外键必须指向系列和系列记忆事实源。"""

    foreign_key_targets = {
        str(foreign_key.column)
        for table in Base.metadata.tables.values()
        for column in table.columns
        for foreign_key in column.foreign_keys
    }

    assert "series.id" in foreign_key_targets
    assert "series_memories.id" in foreign_key_targets


def test_phase2_domain_modules_configure_mappers_independently() -> None:
    """单独导入系列领域模型时也能完成 SQLAlchemy mapper 配置。"""

    modules = ["app.domains.series.models"]
    for module_name in modules:
        script = (
            "from sqlalchemy.orm import configure_mappers\n"
            f"__import__({module_name!r})\n"
            "configure_mappers()\n"
            f"print('已完成独立映射配置: {module_name}')\n"
        )
        completed = subprocess.run(
            [sys.executable, "-c", script],
            check=True,
            capture_output=True,
            text=True,
        )
        assert module_name in completed.stdout
