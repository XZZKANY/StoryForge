from __future__ import annotations

import subprocess
import sys

from sqlalchemy.orm import RelationshipProperty

from app.db.base import Base
from app.domains.series.models import Series, SeriesBook, SeriesMemorySnapshot, StylePackApplication


PH2_ENTITY_CLASSES = (Series, SeriesBook, SeriesMemorySnapshot, StylePackApplication)

EXPECTED_TABLES = {
    "series",
    "series_books",
    "series_memory_snapshots",
    "style_pack_applications",
}


def test_phase2_entities_are_registered() -> None:
    """Phase 2 系列、记忆和风格包应用模型必须注册到统一元数据。"""

    assert {entity.__name__ for entity in PH2_ENTITY_CLASSES} == {
        "Series",
        "SeriesBook",
        "SeriesMemorySnapshot",
        "StylePackApplication",
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
    """记忆快照和风格包应用需要版本字段支撑回滚与审计。"""

    assert "version" in SeriesMemorySnapshot.__table__.columns
    assert "version" in StylePackApplication.__table__.columns


def test_series_relationship_chain() -> None:
    """系列、作品、记忆快照和风格包应用之间必须建立可遍历关系。"""

    assert isinstance(Series.__mapper__.relationships["books"], RelationshipProperty)
    assert isinstance(SeriesBook.__mapper__.relationships["series"], RelationshipProperty)
    assert isinstance(SeriesBook.__mapper__.relationships["book"], RelationshipProperty)
    assert isinstance(SeriesMemorySnapshot.__mapper__.relationships["series"], RelationshipProperty)
    assert isinstance(StylePackApplication.__mapper__.relationships["style_pack_asset"], RelationshipProperty)


def test_phase2_foreign_key_structure() -> None:
    """外键必须指向系列、作品、资产、连续性记录和任务运行记录。"""

    foreign_key_targets = {
        str(foreign_key.column)
        for table in Base.metadata.tables.values()
        for column in table.columns
        for foreign_key in column.foreign_keys
    }

    assert "series.id" in foreign_key_targets
    assert "books.id" in foreign_key_targets
    assert "assets.id" in foreign_key_targets
    assert "continuity_records.id" in foreign_key_targets
    assert "job_runs.id" in foreign_key_targets


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
