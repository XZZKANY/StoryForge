from __future__ import annotations

from collections.abc import Generator, Sequence

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.books.models import Book
from app.domains.retrieval.embedding_client import EmbeddingResult
from app.domains.retrieval.models import RetrievalChunk
from app.domains.retrieval.reranker_client import RerankItem, RerankResult
from app.domains.retrieval.schemas import RetrievalHitRead, RetrievalRefreshRunCreate, RetrievalSearchCreate, RetrievalSourceCreate
from app.domains.retrieval.service import create_retrieval_refresh_run, create_retrieval_source

import pytest


class StaticEmbeddingClient:
    """测试用 embedding 客户端，模拟真实客户端批量返回向量和元数据。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        return EmbeddingResult(
            provider_name="unit-embedding",
            model_name="unit-vector-v1",
            credential_status="configured",
            vectors=[[float(index), float(len(text))] for index, text in enumerate(texts, start=1)],
        )


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    """使用 SQLite 内存库验证检索 embedding 刷新闭环。"""

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with factory() as db_session:
        yield db_session
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_refresh_run_uses_injected_embedding_client_and_records_chunk_refs(session: Session) -> None:
    """检索刷新应通过可注入 embedding 客户端写入向量，并记录 chunk 引用而非复制全文。"""

    book = Book(title="检索向量闭环", status="draft", premise="验证 embedding 刷新。")
    session.add(book)
    session.commit()

    source = create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="灯塔档案",
            content_text="灯塔信号每七分钟重复一次。旧协议要求隐藏伤员。",
        ),
    )

    refresh_run = create_retrieval_refresh_run(
        session,
        RetrievalRefreshRunCreate(source_id=source.id),
        embedding_client=StaticEmbeddingClient(),
    )

    chunks = session.scalars(select(RetrievalChunk).order_by(RetrievalChunk.chunk_index)).all()
    assert chunks
    assert chunks[0].embedding == [1.0, float(len(chunks[0].content))]
    assert refresh_run.payload["embedding_provider"] == "unit-embedding"
    assert refresh_run.payload["embedding_model"] == "unit-vector-v1"
    assert refresh_run.payload["credential_status"] == "configured"
    assert refresh_run.payload["chunk_refs"] == [
        {"source_id": chunk.source_id, "chunk_id": chunk.id, "chunk_index": chunk.chunk_index} for chunk in chunks
    ]
    assert "content_text" not in refresh_run.payload


class SemanticEmbeddingClient:
    """测试用语义 embedding 客户端，制造无关键词重叠但向量相近的场景。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        vectors: list[list[float]] = []
        for text in texts:
            if "旧协议要求隐藏伤员" in text or "维修窗口" in text:
                vectors.append([1.0, 0.0])
            else:
                vectors.append([0.0, 1.0])
        return EmbeddingResult(
            provider_name="semantic-unit",
            model_name="semantic-vector-v1",
            credential_status="configured",
            vectors=vectors,
        )


def test_search_uses_query_embedding_when_keywords_do_not_overlap(session: Session) -> None:
    """关键词没有重叠时，检索搜索仍应能通过 query embedding 找到语义相近 chunk。"""

    book = Book(title="语义检索闭环", status="draft", premise="验证向量得分。")
    session.add(book)
    session.commit()
    source = create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="旧港档案",
            content_text="旧协议要求隐藏伤员。灯塔信号每七分钟重复一次。",
        ),
        embedding_client=SemanticEmbeddingClient(),
    )

    from app.domains.retrieval.schemas import RetrievalSearchCreate
    from app.domains.retrieval.service import search_retrieval

    hits = search_retrieval(
        session,
        RetrievalSearchCreate(book_id=book.id, query="维修窗口", limit=3),
        embedding_client=SemanticEmbeddingClient(),
    )

    assert hits
    assert hits[0].source_id == source.id
    assert hits[0].score > 0
    assert hits[0].score_source == "embedding"
    assert hits[0].keyword_score == 0
    assert hits[0].embedding_score > 0.25


class ReverseRerankerClient:
    """测试用 reranker 客户端，模拟真实重排服务返回新的排序分数。"""

    def rerank(self, query: str, hits: Sequence[RetrievalHitRead]) -> RerankResult:
        return RerankResult(
            provider_name="unit-reranker",
            model_name="unit-rerank-v1",
            credential_status="configured",
            items=[
                RerankItem(chunk_id=hit.chunk_id, score=float(len(hits) - index + 1))
                for index, hit in enumerate(reversed(hits), start=1)
            ],
        )


def test_search_applies_optional_reranker_and_records_rerank_metadata(session: Session) -> None:
    """启用 reranker 时，检索结果应按重排分数排序并保留重排证据。"""

    book = Book(title="重排检索闭环", status="draft", premise="验证 reranker。")
    session.add(book)
    session.commit()
    create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="港口资料",
            content_text=(
                "灯塔信号每七分钟重复一次，港口守卫会在钟楼阴影下核对旧协议和维修名单。"
                "灯塔旧协议要求隐藏伤员，副官必须绕开议会记录并保留备用通道。"
                "灯塔维修窗口只在午夜开放，林岚需要利用潮汐噪声完成谈判。"
            ),
        ),
    )

    from app.domains.retrieval.service import search_retrieval

    baseline_hits = search_retrieval(session, RetrievalSearchCreate(book_id=book.id, query="灯塔", limit=3))
    reranked_hits = search_retrieval(
        session,
        RetrievalSearchCreate(book_id=book.id, query="灯塔", limit=3),
        reranker_client=ReverseRerankerClient(),
    )

    assert [hit.chunk_id for hit in reranked_hits] == list(reversed([hit.chunk_id for hit in baseline_hits]))
    assert reranked_hits[0].rerank_score == 1.0
    assert reranked_hits[0].rerank_provider == "unit-reranker"
    assert reranked_hits[0].rerank_model == "unit-rerank-v1"
    assert reranked_hits[0].score_source == "rerank"
