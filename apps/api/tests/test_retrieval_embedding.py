from __future__ import annotations

import inspect
from collections.abc import Sequence

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.retrieval.embedding_client import EmbeddingResult
from app.domains.retrieval.models import RetrievalChunk
from app.domains.retrieval.reranker_client import RerankItem, RerankResult
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalRefreshRunCreate,
    RetrievalSearchCreate,
    RetrievalSourceCreate,
)
from app.domains.retrieval.service import create_retrieval_refresh_run, create_retrieval_source


class StaticEmbeddingClient:
    """测试用 embedding 客户端，模拟真实客户端批量返回向量和元数据。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        return EmbeddingResult(
            provider_name="unit-embedding",
            model_name="unit-vector-v1",
            credential_status="configured",
            vectors=[[float(index), float(len(text))] for index, text in enumerate(texts, start=1)],
        )


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


def test_keywords_preserve_order_without_duplicate_candidates() -> None:
    """关键词生成应使用集合去重并保留首次出现顺序。"""

    from app.domains.retrieval import service as retrieval_service

    keywords = retrieval_service._keywords("灯塔灯塔 灯塔灯塔")

    assert keywords == list(dict.fromkeys(keywords))
    assert keywords[:3] == ["灯塔灯塔", "灯塔", "塔灯"]
    assert "seen: set[str]" in inspect.getsource(retrieval_service._keywords)


def test_score_chunk_uses_keyword_set_for_overlap(session: Session) -> None:
    """评分热路径应将 chunk 关键词转为集合，避免每个查询词都线性扫描列表。"""

    from app.domains.retrieval import service as retrieval_service

    book = Book(title="评分热路径", status="draft", premise="验证关键词集合。")
    session.add(book)
    session.commit()
    source = create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="灯塔资料",
            content_text="灯塔信号每七分钟重复一次。旧协议要求隐藏伤员。",
        ),
    )
    chunk = session.scalars(select(RetrievalChunk).where(RetrievalChunk.source_id == source.id)).first()

    assert chunk is not None
    score = retrieval_service._score_chunk(chunk, ["灯塔", "旧协议"], "灯塔 旧协议")

    assert score[0] > 0
    assert "chunk_keywords = set(chunk.keywords)" in inspect.getsource(retrieval_service._score_chunk)


def test_cosine_similarity_uses_single_pass_without_slice_allocations() -> None:
    """向量相似度应保持既有结果，同时避免切片分配和多次遍历。"""

    from app.domains.retrieval import service as retrieval_service

    assert retrieval_service._cosine_similarity([1.0, 0.0, 9.0], [1.0, 0.0]) == 1.0
    assert retrieval_service._cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0

    source = inspect.getsource(retrieval_service._cosine_similarity)

    assert "left_slice" not in source
    assert "right_slice" not in source
    assert "for left_value, right_value in zip" in source


def test_keyword_search_prefilters_candidates_before_python_scoring(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """关键词检索应先在数据库侧裁剪候选，避免 Python 评分遍历同作用域全部 chunk。"""

    from app.domains.retrieval import service as retrieval_service

    book = Book(title="候选裁剪", status="draft", premise="验证数据库侧预过滤。")
    session.add(book)
    session.commit()
    matching_source = create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="灯塔协议",
            content_text="灯塔信号每七分钟重复一次。林岚需要隐藏旧伤。",
        ),
    )
    for index in range(4):
        create_retrieval_source(
            session,
            RetrievalSourceCreate(
                book_id=book.id,
                source_type="reference_doc",
                title=f"无关资料 {index}",
                content_text=f"港口仓单记录编号 {index}。议会例行会议纪要 {index}。",
            ),
        )
    total_chunks = session.scalars(select(RetrievalChunk).join(RetrievalChunk.source).where(RetrievalChunk.source.has(book_id=book.id))).all()
    score_calls = 0
    original_score_chunk = retrieval_service._score_chunk

    def counted_score_chunk(*args, **kwargs):
        nonlocal score_calls
        score_calls += 1
        return original_score_chunk(*args, **kwargs)

    monkeypatch.setattr(retrieval_service, "_score_chunk", counted_score_chunk)

    hits = retrieval_service.search_retrieval(session, RetrievalSearchCreate(book_id=book.id, query="灯塔", limit=3))

    assert hits
    assert hits[0].source_id == matching_source.id
    assert score_calls < len(total_chunks)


def test_search_candidate_loader_reports_prefilter_metadata(session: Session) -> None:
    """候选加载 helper 应返回预过滤摘要，便于后续接入日志或指标。"""

    from sqlalchemy import select as sqlalchemy_select
    from sqlalchemy.orm import selectinload as sqlalchemy_selectinload

    from app.domains.retrieval import service as retrieval_service
    from app.domains.retrieval.models import RetrievalSource

    book = Book(title="候选摘要", status="draft", premise="验证候选裁剪摘要。")
    session.add(book)
    session.commit()
    create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="灯塔摘要资料",
            content_text="灯塔信号需要被候选裁剪命中。",
        ),
    )
    create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="港口摘要资料",
            content_text="港口会议没有目标关键词。",
        ),
    )
    statement = (
        sqlalchemy_select(RetrievalChunk)
        .options(sqlalchemy_selectinload(RetrievalChunk.source))
        .join(RetrievalSource, RetrievalChunk.source_id == RetrievalSource.id)
        .where(RetrievalSource.status == "active", RetrievalSource.book_id == book.id)
        .order_by(RetrievalSource.id, RetrievalChunk.chunk_index, RetrievalChunk.id)
    )

    candidate_load = retrieval_service._load_search_candidates(
        session,
        statement,
        "灯塔",
        retrieval_service._keywords("灯塔"),
        use_keyword_prefilter=True,
    )

    assert candidate_load.prefilter_enabled is True
    assert candidate_load.prefilter_terms
    assert candidate_load.filtered_count == len(candidate_load.chunks)
    assert candidate_load.fallback_used is False
    assert len(candidate_load.chunks) == 1



def test_pgvector_candidate_loader_orders_postgresql_embeddings_with_bound_vector() -> None:
    """PostgreSQL 语义检索应使用 pgvector 距离排序并限制候选规模。"""

    import json
    from types import SimpleNamespace

    from sqlalchemy import select as sqlalchemy_select
    from sqlalchemy.orm import selectinload as sqlalchemy_selectinload

    from app.domains.retrieval import service as retrieval_service
    from app.domains.retrieval.models import RetrievalSource

    class EmptyScalarResult:
        def all(self) -> list[RetrievalChunk]:
            return []

    class PostgreSQLCaptureSession:
        def __init__(self) -> None:
            self.statement = None
            self.params = None

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def scalars(self, statement, params=None):
            self.statement = statement
            self.params = params
            return EmptyScalarResult()

    session = PostgreSQLCaptureSession()
    statement = (
        sqlalchemy_select(RetrievalChunk)
        .options(sqlalchemy_selectinload(RetrievalChunk.source))
        .join(RetrievalSource, RetrievalChunk.source_id == RetrievalSource.id)
        .where(RetrievalSource.status == "active")
        .order_by(RetrievalSource.id, RetrievalChunk.chunk_index, RetrievalChunk.id)
    )
    query_embedding = [0.1] * retrieval_service.DEFAULT_PGVECTOR_DIMENSIONS

    candidate_load = retrieval_service._load_search_candidates(
        session,
        statement,
        "灯塔",
        retrieval_service._keywords("灯塔"),
        use_keyword_prefilter=False,
        query_embedding=query_embedding,
        limit=3,
    )

    assert candidate_load.pgvector_enabled is True
    assert candidate_load.vector_candidate_limit == 32
    assert json.loads(session.params["query_embedding"]) == query_embedding
    compiled_sql = str(session.statement)
    assert "embedding_vector <=> CAST(:query_embedding AS vector)" in compiled_sql
    assert "retrieval_sources.id, retrieval_chunks.chunk_index" not in compiled_sql
    assert "LIMIT" in compiled_sql



def test_search_retrieval_logs_candidate_load_summary_without_query_text(
    session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """检索搜索应记录候选加载摘要，但不能泄露查询原文。"""

    import logging

    from app.domains.retrieval import service as retrieval_service
    from app.domains.retrieval.service import search_retrieval

    book = Book(title="候选日志", status="draft", premise="验证日志摘要。")
    session.add(book)
    session.commit()
    create_retrieval_source(
        session,
        RetrievalSourceCreate(
            book_id=book.id,
            source_type="reference_doc",
            title="灯塔日志资料",
            content_text="灯塔信号每七分钟重复一次。",
        ),
    )

    secret_query = "灯塔-不可写入日志"
    with caplog.at_level(logging.INFO, logger=retrieval_service.__name__):
        hits = search_retrieval(session, RetrievalSearchCreate(book_id=book.id, query=secret_query, limit=3))

    assert hits
    records = [record for record in caplog.records if record.message == "检索候选加载摘要"]
    assert len(records) == 1
    record = records[0]
    assert record.candidate_count == 1
    assert record.filtered_count == 1
    assert record.prefilter_enabled is True
    assert record.fallback_used is False
    assert record.pgvector_enabled is False
    assert record.vector_candidate_limit is None
    assert secret_query not in caplog.text



def test_vector_candidate_limit_uses_environment_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    """pgvector 候选上限应允许通过环境变量按数据规模调优。"""

    from app.domains.retrieval import service as retrieval_service

    monkeypatch.setenv("STORYFORGE_RETRIEVAL_VECTOR_CANDIDATE_MULTIPLIER", "3")
    monkeypatch.setenv("STORYFORGE_RETRIEVAL_VECTOR_MIN_CANDIDATES", "10")

    assert retrieval_service._vector_candidate_limit(2) == 10
    assert retrieval_service._vector_candidate_limit(5) == 15
    assert retrieval_service._vector_candidate_limit(None) == 10


def test_vector_candidate_limit_falls_back_for_invalid_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """pgvector 候选上限配置非法时应回退默认值，避免启动后检索异常。"""

    from app.domains.retrieval import service as retrieval_service

    monkeypatch.setenv("STORYFORGE_RETRIEVAL_VECTOR_CANDIDATE_MULTIPLIER", "not-a-number")
    monkeypatch.setenv("STORYFORGE_RETRIEVAL_VECTOR_MIN_CANDIDATES", "0")

    assert retrieval_service._vector_candidate_limit(5) == 40
    assert retrieval_service._vector_candidate_limit(None) == 32



def test_pgvector_candidate_dimension_uses_environment_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """pgvector 启用维度应可配置，以便重建索引后无需改代码。"""

    from types import SimpleNamespace

    from app.domains.retrieval import service as retrieval_service

    class PostgreSQLSession:
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

    monkeypatch.setenv("STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS", "3")

    assert retrieval_service._should_use_pgvector_candidates(PostgreSQLSession(), [0.1, 0.2, 0.3]) is True
    assert retrieval_service._should_use_pgvector_candidates(PostgreSQLSession(), [0.1, 0.2]) is False


def test_pgvector_candidate_dimension_falls_back_for_invalid_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """pgvector 维度配置非法时应回退当前默认维度。"""

    from types import SimpleNamespace

    from app.domains.retrieval import service as retrieval_service

    class PostgreSQLSession:
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

    monkeypatch.setenv("STORYFORGE_RETRIEVAL_PGVECTOR_DIMENSIONS", "invalid")
    default_embedding = [0.1] * retrieval_service.DEFAULT_PGVECTOR_DIMENSIONS

    assert retrieval_service._should_use_pgvector_candidates(PostgreSQLSession(), default_embedding) is True
    assert retrieval_service._should_use_pgvector_candidates(PostgreSQLSession(), default_embedding[:-1]) is False
