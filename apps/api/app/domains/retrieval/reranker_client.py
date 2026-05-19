from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.domains.provider_gateway.runtime_config import load_runtime_provider_config
from app.domains.retrieval.schemas import RetrievalHitRead


@dataclass(frozen=True)
class RerankItem:
    """单条检索命中的重排分数。"""

    chunk_id: int
    score: float


@dataclass(frozen=True)
class RerankResult:
    """reranker 客户端返回的重排结果和运行时元数据。"""

    provider_name: str
    model_name: str
    credential_status: str
    items: list[RerankItem]


class RerankerClient(Protocol):
    """检索搜索依赖的最小 reranker 客户端接口。"""

    def rerank(self, query: str, hits: Sequence[RetrievalHitRead]) -> RerankResult:
        """按查询和候选命中返回重排分数。"""


class DisabledRerankerClient:
    """未启用真实 reranker 时保持原始稳定排序。"""

    def rerank(self, query: str, hits: Sequence[RetrievalHitRead]) -> RerankResult:
        runtime_config = load_runtime_provider_config("reranker")
        return RerankResult(
            provider_name=runtime_config.provider_name,
            model_name=runtime_config.model_name,
            credential_status=runtime_config.credential_status,
            items=[],
        )
