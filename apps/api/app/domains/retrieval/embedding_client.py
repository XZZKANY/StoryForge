from __future__ import annotations

import logging
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.common.llm_client import post_json_with_retry
from app.domains.provider_gateway.runtime_config import load_runtime_provider_config

logger = logging.getLogger(__name__)


DEFAULT_OPENAI_BATCH_SIZE = 96
DEFAULT_OPENAI_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class EmbeddingResult:
    """embedding 客户端批量返回的向量和运行时元数据。"""

    provider_name: str
    model_name: str
    credential_status: str
    vectors: list[list[float]]


class EmbeddingClient(Protocol):
    """检索刷新依赖的最小 embedding 客户端接口。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        """批量生成文本向量，调用方负责保存 chunk 引用和元数据。"""


class LocalEmbeddingClient:
    """无真实密钥时使用的本地稳定 embedding 实现。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        runtime_config = load_runtime_provider_config("embedding")
        return EmbeddingResult(
            provider_name=runtime_config.provider_name,
            model_name=runtime_config.model_name,
            credential_status=runtime_config.credential_status,
            vectors=[_stable_embedding(text) for text in texts],
        )


class OpenAIEmbeddingClient:
    """调用 OpenAI 兼容 embedding API 的真实客户端，分批请求并合并向量。"""

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str,
        provider_name: str = "openai",
        api_base_url: str = "https://api.openai.com/v1",
        batch_size: int = DEFAULT_OPENAI_BATCH_SIZE,
        timeout_seconds: float = DEFAULT_OPENAI_TIMEOUT_SECONDS,
        post_json: Callable[..., dict[str, object]] = post_json_with_retry,
    ) -> None:
        if not api_key:
            raise ValueError("OpenAI embedding 客户端需要 api_key。")
        if batch_size <= 0:
            raise ValueError("OpenAI embedding 批量大小必须大于 0。")
        self._api_key = api_key
        self._model_name = model_name
        self._provider_name = provider_name
        self._api_base_url = api_base_url.rstrip("/")
        self._batch_size = batch_size
        self._timeout_seconds = timeout_seconds
        self._post_json = post_json

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        normalized = [text if text else " " for text in texts]
        vectors: list[list[float]] = []
        if not normalized:
            return EmbeddingResult(
                provider_name=self._provider_name,
                model_name=self._model_name,
                credential_status="configured",
                vectors=vectors,
            )
        for batch_start in range(0, len(normalized), self._batch_size):
            batch = normalized[batch_start : batch_start + self._batch_size]
            vectors.extend(self._embed_batch(batch))
        return EmbeddingResult(
            provider_name=self._provider_name,
            model_name=self._model_name,
            credential_status="configured",
            vectors=vectors,
        )

    def _embed_batch(self, batch: Sequence[str]) -> list[list[float]]:
        data = self._post_json(
            f"{self._api_base_url}/embeddings",
            {"model": self._model_name, "input": list(batch)},
            {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            timeout_seconds=self._timeout_seconds,
            service_label="embedding 服务",
        )
        items = data.get("data")
        if not isinstance(items, list) or len(items) != len(batch):
            raise RuntimeError("OpenAI embedding 响应缺少 data 字段或长度不匹配。")
        vectors: list[list[float]] = []
        for item in items:
            embedding = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(embedding, list) or not embedding:
                raise RuntimeError("OpenAI embedding 响应缺少有效的 embedding 数组。")
            vectors.append([float(value) for value in embedding])
        return vectors


def resolve_embedding_client(
    explicit_client: EmbeddingClient | None = None,
) -> EmbeddingClient | None:
    """按 STORYFORGE_EMBEDDING_PROVIDER 选择真实 embedding 客户端，缺密钥时回退本地。

    返回 None 表示调用方使用关键词路径（保持既有搜索语义不变）。
    """

    if explicit_client is not None:
        return explicit_client
    provider = (os.getenv("STORYFORGE_EMBEDDING_PROVIDER") or "").strip().lower()
    if provider == "openai":
        api_key = (os.getenv("STORYFORGE_EMBEDDING_API_KEY") or "").strip()
        if not api_key:
            logger.warning("STORYFORGE_EMBEDDING_PROVIDER=openai 但缺少 API key，回退到本地 embedding。")
            return LocalEmbeddingClient()
        model = (os.getenv("STORYFORGE_EMBEDDING_MODEL") or "text-embedding-3-small").strip()
        base_url = (os.getenv("STORYFORGE_EMBEDDING_API_BASE_URL") or "https://api.openai.com/v1").strip()
        timeout = _positive_float_env("STORYFORGE_EMBEDDING_TIMEOUT_SECONDS", DEFAULT_OPENAI_TIMEOUT_SECONDS)
        batch_size = _positive_int_env("STORYFORGE_EMBEDDING_BATCH_SIZE", DEFAULT_OPENAI_BATCH_SIZE)
        return OpenAIEmbeddingClient(
            api_key=api_key,
            model_name=model,
            provider_name="openai",
            api_base_url=base_url,
            batch_size=batch_size,
            timeout_seconds=timeout,
        )
    if provider in ("local", "fake"):
        return LocalEmbeddingClient()
    return None


def _stable_embedding(text: str) -> list[float]:
    """生成稳定轻量向量，便于本地测试和缺密钥降级。"""

    buckets = [0.0, 0.0, 0.0, 0.0]
    for index, char in enumerate(text):
        buckets[index % len(buckets)] += float(ord(char) % 97) / 97
    total = sum(buckets) or 1.0
    return [round(bucket / total, 6) for bucket in buckets]


def _positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = float(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default
