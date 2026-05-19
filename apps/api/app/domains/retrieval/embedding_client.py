from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.domains.provider_gateway.runtime_config import load_runtime_provider_config


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


def _stable_embedding(text: str) -> list[float]:
    """生成稳定轻量向量，便于本地测试和缺密钥降级。"""

    buckets = [0.0, 0.0, 0.0, 0.0]
    for index, char in enumerate(text):
        buckets[index % len(buckets)] += float(ord(char) % 97) / 97
    total = sum(buckets) or 1.0
    return [round(bucket / total, 6) for bucket in buckets]
