"""pgvector 运行期判定的单一来源。

retrieval 与 story_memory 两个域共用同一套维度读取与决策原因码，
避免门控规则和回退词表在多处各写一份产生漂移。维度环境变量本身仍分域
（retrieval/memory 各对应一张表的 generated 向量列），只是读取入口统一。
"""

from __future__ import annotations

import os
from collections.abc import Sequence

from sqlalchemy.orm import Session

# pgvector 是否启用的稳定原因码，供日志与诊断直接消费。
PGVECTOR_ENGAGED = "engaged"
PGVECTOR_NO_QUERY_EMBEDDING = "no_query_embedding"
PGVECTOR_DIMENSION_MISMATCH = "dimension_mismatch"
PGVECTOR_NON_POSTGRESQL = "non_postgresql"


def pgvector_dimensions(env_name: str, default: int = 1536) -> int:
    """读取 pgvector 维度配置的唯一入口，非法或非正值回退默认。"""

    raw_value = os.getenv(env_name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default


def evaluate_pgvector_decision(
    session: Session,
    query_embedding: Sequence[float] | None,
    *,
    expected_dims: int,
) -> str:
    """判定本次召回是否可走 pgvector ANN，并返回可观测的原因码。

    判定顺序与旧 `_should_use_*` 私有逻辑保持一致：先看是否有 query 向量，
    再看维度是否匹配，最后才探测方言，确保不引入额外的绑定探测。
    """

    if query_embedding is None:
        return PGVECTOR_NO_QUERY_EMBEDDING
    if len(query_embedding) != expected_dims:
        return PGVECTOR_DIMENSION_MISMATCH
    try:
        dialect_name = session.get_bind().dialect.name
    except Exception:
        return PGVECTOR_NON_POSTGRESQL
    if dialect_name != "postgresql":
        return PGVECTOR_NON_POSTGRESQL
    return PGVECTOR_ENGAGED


def pgvector_engaged(reason: str) -> bool:
    return reason == PGVECTOR_ENGAGED
