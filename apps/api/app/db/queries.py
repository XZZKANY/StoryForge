from __future__ import annotations

from sqlalchemy import func, select


def latest_by_lineage(model, *, filters=None):
    """返回按 lineage_key 分组的最新版本子查询，可直接 join。"""

    statement = select(model.lineage_key, func.max(model.version).label("latest_version"))
    if filters:
        statement = statement.where(*filters)
    return statement.group_by(model.lineage_key).subquery()
