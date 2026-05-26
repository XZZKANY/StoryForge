from __future__ import annotations

import logging
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.domains.provider_gateway.runtime_config import load_runtime_provider_config
from app.domains.retrieval.schemas import RetrievalHitRead

logger = logging.getLogger(__name__)

DEFAULT_RERANKER_TIMEOUT_SECONDS = 30.0


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


class LocalCrossEncoderRerankerClient:
    """无外部服务依赖的本地重排器，用查询字符重叠度模拟 cross-encoder 排序。"""

    def __init__(self, *, model_name: str = "local-cross-encoder") -> None:
        self._model_name = model_name

    def rerank(self, query: str, hits: Sequence[RetrievalHitRead]) -> RerankResult:
        query_terms = _normalized_char_terms(query)
        scored_items = [
            RerankItem(chunk_id=hit.chunk_id, score=_local_overlap_score(query_terms, hit.excerpt))
            for hit in hits
        ]
        scored_items.sort(key=lambda item: item.score, reverse=True)
        return RerankResult(
            provider_name="cross-encoder",
            model_name=self._model_name,
            credential_status="local",
            items=scored_items,
        )


class CohereRerankerClient:
    """调用 Cohere /rerank 端点的真实重排客户端。"""

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str,
        api_base_url: str = "https://api.cohere.com/v1",
        provider_name: str = "cohere",
        timeout_seconds: float = DEFAULT_RERANKER_TIMEOUT_SECONDS,
        http_client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("Cohere reranker 客户端需要 api_key。")
        self._api_key = api_key
        self._model_name = model_name
        self._provider_name = provider_name
        self._api_base_url = api_base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._http_client_factory = http_client_factory or (
            lambda: httpx.Client(timeout=self._timeout_seconds)
        )

    def rerank(self, query: str, hits: Sequence[RetrievalHitRead]) -> RerankResult:
        if not hits:
            return RerankResult(
                provider_name=self._provider_name,
                model_name=self._model_name,
                credential_status="configured",
                items=[],
            )
        documents = [hit.excerpt for hit in hits]
        with self._http_client_factory() as client:
            response = client.post(
                f"{self._api_base_url}/rerank",
                json={
                    "model": self._model_name,
                    "query": query,
                    "documents": documents,
                    "top_n": len(documents),
                },
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
        results = data.get("results")
        if not isinstance(results, list):
            raise RuntimeError("Cohere reranker 响应缺少 results 字段。")
        items: list[RerankItem] = []
        for entry in results:
            if not isinstance(entry, dict):
                continue
            index = entry.get("index")
            score = entry.get("relevance_score")
            if not isinstance(index, int) or index < 0 or index >= len(hits):
                continue
            if not isinstance(score, int | float):
                continue
            items.append(RerankItem(chunk_id=hits[index].chunk_id, score=float(score)))
        return RerankResult(
            provider_name=self._provider_name,
            model_name=self._model_name,
            credential_status="configured",
            items=items,
        )


def resolve_reranker_client(
    explicit_client: RerankerClient | None = None,
) -> RerankerClient | None:
    """按 STORYFORGE_RERANKER_PROVIDER 选择重排实现，缺密钥或未启用时返回 None。"""

    if explicit_client is not None:
        return explicit_client
    provider = (os.getenv("STORYFORGE_RERANKER_PROVIDER") or "").strip().lower()
    if provider in ("", "disabled", "none"):
        return None
    if provider == "cross-encoder":
        model = (os.getenv("STORYFORGE_RERANKER_MODEL") or "local-cross-encoder").strip()
        return LocalCrossEncoderRerankerClient(model_name=model)
    if provider == "cohere":
        api_key = (os.getenv("STORYFORGE_RERANKER_API_KEY") or "").strip()
        if not api_key:
            logger.warning("STORYFORGE_RERANKER_PROVIDER=cohere 但缺少 API key，禁用重排。")
            return None
        model = (os.getenv("STORYFORGE_RERANKER_MODEL") or "rerank-multilingual-v3.0").strip()
        base_url = (os.getenv("STORYFORGE_RERANKER_API_BASE_URL") or "https://api.cohere.com/v1").strip()
        timeout = _positive_float_env("STORYFORGE_RERANKER_TIMEOUT_SECONDS", DEFAULT_RERANKER_TIMEOUT_SECONDS)
        return CohereRerankerClient(
            api_key=api_key,
            model_name=model,
            api_base_url=base_url,
            timeout_seconds=timeout,
        )
    logger.warning("STORYFORGE_RERANKER_PROVIDER=%s 暂不支持，禁用重排。", provider)
    return None


def _normalized_char_terms(text: str) -> set[str]:
    return {char.lower() for char in text if not char.isspace()}


def _local_overlap_score(query_terms: set[str], text: str) -> float:
    if not query_terms:
        return 0.0
    text_terms = _normalized_char_terms(text)
    overlap = len(query_terms & text_terms)
    return round(overlap / len(query_terms), 6)


def _positive_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = float(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default
