from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

import pytest

from app.domains.retrieval.embedding_client import (
    EmbeddingResult,
    LocalEmbeddingClient,
    OpenAIEmbeddingClient,
    resolve_embedding_client,
)
from app.domains.retrieval.reranker_client import (
    CohereRerankerClient,
    LocalCrossEncoderRerankerClient,
    RerankResult,
    resolve_reranker_client,
)
from app.domains.retrieval.schemas import RetrievalHitRead


@dataclass
class _FakeResponse:
    payload: dict
    status_code: int = 200

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return self.payload


class _FakeHttpxClient:
    """最小 httpx.Client 替身，按记录的请求返回固定 payload。"""

    def __init__(self, response_payloads: Sequence[dict]) -> None:
        self._response_payloads = list(response_payloads)
        self.requests: list[dict] = []

    def __enter__(self) -> _FakeHttpxClient:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def post(self, url: str, *, json: dict | None = None, headers: dict | None = None):
        self.requests.append({"url": url, "json": json, "headers": headers})
        if not self._response_payloads:
            raise AssertionError("FakeHttpxClient 收到了超过预期的请求次数。")
        payload = self._response_payloads.pop(0)
        return _FakeResponse(payload=payload)


def test_local_embedding_client_returns_stable_vectors() -> None:
    client = LocalEmbeddingClient()
    result = client.embed_texts(["灯塔信号", "维修窗口"])
    assert len(result.vectors) == 2
    assert all(len(vector) == 4 for vector in result.vectors)
    assert result.provider_name


def test_openai_embedding_client_batches_requests_and_returns_vectors() -> None:
    response_payloads = [
        {"data": [{"embedding": [0.1, 0.2, 0.3]}, {"embedding": [0.4, 0.5, 0.6]}]},
        {"data": [{"embedding": [0.7, 0.8, 0.9]}]},
    ]
    fake_client = _FakeHttpxClient(response_payloads)
    client = OpenAIEmbeddingClient(
        api_key="sk-test",
        model_name="text-embedding-3-small",
        api_base_url="https://example.test/v1",
        batch_size=2,
        http_client_factory=lambda: fake_client,
    )

    result = client.embed_texts(["a", "b", "c"])

    assert result.provider_name == "openai"
    assert result.model_name == "text-embedding-3-small"
    assert result.credential_status == "configured"
    assert result.vectors == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]
    assert len(fake_client.requests) == 2
    first_request = fake_client.requests[0]
    assert first_request["url"] == "https://example.test/v1/embeddings"
    assert first_request["json"] == {"model": "text-embedding-3-small", "input": ["a", "b"]}
    assert first_request["headers"]["Authorization"] == "Bearer sk-test"


def test_openai_embedding_client_rejects_malformed_response() -> None:
    fake_client = _FakeHttpxClient([{"data": [{"embedding": []}]}])
    client = OpenAIEmbeddingClient(
        api_key="sk-test",
        model_name="any-model",
        http_client_factory=lambda: fake_client,
    )
    with pytest.raises(RuntimeError, match="embedding"):
        client.embed_texts(["x"])


def test_openai_embedding_client_replaces_empty_text_to_avoid_empty_input() -> None:
    fake_client = _FakeHttpxClient([{"data": [{"embedding": [0.1, 0.2]}]}])
    client = OpenAIEmbeddingClient(
        api_key="sk-test",
        model_name="m",
        http_client_factory=lambda: fake_client,
    )
    client.embed_texts([""])
    assert fake_client.requests[0]["json"]["input"] == [" "]


def test_resolve_embedding_client_defaults_to_none_for_keyword_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STORYFORGE_EMBEDDING_PROVIDER", raising=False)
    monkeypatch.delenv("STORYFORGE_EMBEDDING_API_KEY", raising=False)
    assert resolve_embedding_client() is None


def test_resolve_embedding_client_returns_local_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_EMBEDDING_PROVIDER", "local")
    client = resolve_embedding_client()
    assert isinstance(client, LocalEmbeddingClient)


def test_resolve_embedding_client_returns_fake_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_EMBEDDING_PROVIDER", "fake")
    client = resolve_embedding_client()
    assert isinstance(client, LocalEmbeddingClient)


def test_resolve_embedding_client_returns_openai_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_EMBEDDING_PROVIDER", "openai")
    monkeypatch.setenv("STORYFORGE_EMBEDDING_API_KEY", "sk-test")
    monkeypatch.setenv("STORYFORGE_EMBEDDING_MODEL", "text-embedding-3-small")
    client = resolve_embedding_client()
    assert isinstance(client, OpenAIEmbeddingClient)


def test_resolve_embedding_client_falls_back_when_key_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_EMBEDDING_PROVIDER", "openai")
    monkeypatch.delenv("STORYFORGE_EMBEDDING_API_KEY", raising=False)
    client = resolve_embedding_client()
    assert isinstance(client, LocalEmbeddingClient)


def test_resolve_embedding_client_honors_explicit_injection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_EMBEDDING_PROVIDER", "openai")
    sentinel = LocalEmbeddingClient()
    assert resolve_embedding_client(sentinel) is sentinel


def test_cohere_reranker_client_posts_documents_and_remaps_scores() -> None:
    hits = [
        RetrievalHitRead(
            source_id=1,
            chunk_id=10,
            source_ref="r:1:10",
            book_id=1,
            series_id=None,
            title="t1",
            excerpt="灯塔信号每七分钟",
            score=1.0,
            rank=1,
        ),
        RetrievalHitRead(
            source_id=1,
            chunk_id=11,
            source_ref="r:1:11",
            book_id=1,
            series_id=None,
            title="t2",
            excerpt="维修窗口",
            score=0.5,
            rank=2,
        ),
    ]
    fake_client = _FakeHttpxClient(
        [
            {
                "results": [
                    {"index": 1, "relevance_score": 0.95},
                    {"index": 0, "relevance_score": 0.42},
                ]
            }
        ]
    )
    client = CohereRerankerClient(
        api_key="cohere-key",
        model_name="rerank-multilingual-v3.0",
        api_base_url="https://example.test/v1",
        http_client_factory=lambda: fake_client,
    )

    result = client.rerank("灯塔", hits)

    assert isinstance(result, RerankResult)
    assert result.provider_name == "cohere"
    assert result.credential_status == "configured"
    assert [item.chunk_id for item in result.items] == [11, 10]
    assert result.items[0].score == 0.95
    request = fake_client.requests[0]
    assert request["url"] == "https://example.test/v1/rerank"
    assert request["json"]["query"] == "灯塔"
    assert request["json"]["documents"] == ["灯塔信号每七分钟", "维修窗口"]
    assert request["headers"]["Authorization"] == "Bearer cohere-key"


def test_cohere_reranker_client_returns_empty_for_no_hits() -> None:
    client = CohereRerankerClient(
        api_key="cohere-key",
        model_name="m",
        http_client_factory=lambda: _FakeHttpxClient([]),
    )
    result = client.rerank("q", [])
    assert result.items == []


def test_resolve_reranker_client_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STORYFORGE_RERANKER_PROVIDER", raising=False)
    assert resolve_reranker_client() is None


def test_resolve_reranker_client_disabled_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_RERANKER_PROVIDER", "disabled")
    assert resolve_reranker_client() is None


def test_resolve_reranker_client_returns_cross_encoder_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STORYFORGE_RERANKER_PROVIDER", "cross-encoder")
    monkeypatch.setenv("STORYFORGE_RERANKER_MODEL", "local-cross-encoder")
    assert isinstance(resolve_reranker_client(), LocalCrossEncoderRerankerClient)


def test_local_cross_encoder_reranker_scores_query_overlap() -> None:
    hits = [
        RetrievalHitRead(
            source_id=1,
            chunk_id=10,
            source_ref="r:1:10",
            book_id=1,
            series_id=None,
            title="t1",
            excerpt="灯塔信号每七分钟响起",
            score=0.1,
            rank=1,
        ),
        RetrievalHitRead(
            source_id=1,
            chunk_id=11,
            source_ref="r:1:11",
            book_id=1,
            series_id=None,
            title="t2",
            excerpt="港口维修窗口关闭",
            score=0.9,
            rank=2,
        ),
    ]
    result = LocalCrossEncoderRerankerClient(model_name="local-cross-encoder").rerank("灯塔信号", hits)
    assert [item.chunk_id for item in result.items] == [10, 11]
    assert result.items[0].score > result.items[1].score


def test_resolve_reranker_client_falls_back_when_key_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_RERANKER_PROVIDER", "cohere")
    monkeypatch.delenv("STORYFORGE_RERANKER_API_KEY", raising=False)
    assert resolve_reranker_client() is None


def test_resolve_reranker_client_returns_cohere_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_RERANKER_PROVIDER", "cohere")
    monkeypatch.setenv("STORYFORGE_RERANKER_API_KEY", "cohere-key")
    assert isinstance(resolve_reranker_client(), CohereRerankerClient)


def test_resolve_reranker_client_unknown_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORYFORGE_RERANKER_PROVIDER", "unknown-vendor")
    monkeypatch.setenv("STORYFORGE_RERANKER_API_KEY", "x")
    assert resolve_reranker_client() is None


def test_embedding_result_is_serializable_for_logging() -> None:
    result = EmbeddingResult(
        provider_name="openai",
        model_name="m",
        credential_status="configured",
        vectors=[[0.1, 0.2]],
    )
    payload = {
        "provider_name": result.provider_name,
        "model_name": result.model_name,
        "credential_status": result.credential_status,
        "vector_count": len(result.vectors),
    }
    assert json.dumps(payload)
