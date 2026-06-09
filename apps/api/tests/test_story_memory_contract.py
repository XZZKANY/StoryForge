from __future__ import annotations

from collections.abc import Sequence

import pytest
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter
from app.domains.retrieval.embedding_client import EmbeddingResult
from app.domains.story_memory import service as story_memory_service
from app.domains.story_memory.guard import check_story_memory_continuity
from app.domains.story_memory.schemas import AgentProposal, MemoryAtom, Progression
from app.domains.story_memory.service import (
    arbitrate_proposal,
    atoms_active_at_chapter,
    create_memory_atom,
    detect_memory_conflicts,
    recall_scene_memory_atoms,
)


class SemanticMemoryEmbeddingClient:
    """测试用 embedding 客户端，制造无关键词重叠但语义相近的记忆召回场景。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        vectors: list[list[float]] = []
        for text in texts:
            if "旧协议要求隐藏伤员" in text or "维修窗口" in text:
                vectors.append([1.0, 0.0])
            else:
                vectors.append([0.0, 1.0])
        return EmbeddingResult(
            provider_name="semantic-memory-unit",
            model_name="semantic-memory-vector-v1",
            credential_status="configured",
            vectors=vectors,
        )


class FixedMemoryEmbeddingClient:
    """测试用固定 embedding 客户端，用于验证写入时持久化向量。"""

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        return EmbeddingResult(
            provider_name="fixed-memory-unit",
            model_name="fixed-memory-vector-v1",
            credential_status="configured",
            vectors=[[0.25, 0.75] for _ in texts],
        )


class QueryOnlyEmbeddingClient:
    """测试用 embedding 客户端，确认召回时优先复用已持久化 atom 向量。"""

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def embed_texts(self, texts: Sequence[str]) -> EmbeddingResult:
        batch = list(texts)
        self.calls.append(batch)
        assert all("旧协议要求隐藏伤员" not in text for text in batch)
        return EmbeddingResult(
            provider_name="query-only-memory-unit",
            model_name="query-only-memory-vector-v1",
            credential_status="configured",
            vectors=[[1.0, 0.0] for _ in batch],
        )


def test_memory_atoms_support_chapter_scoped_progression() -> None:
    """同一角色状态可以随章节演化，查询时只返回当前章节有效事实。"""

    atoms = [
        MemoryAtom(
            memory_id="m1",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="appearance",
            value="左臂完好",
            source_ref="chapter:1",
            valid_from_chapter=1,
            valid_to_chapter=4,
        ),
        MemoryAtom(
            memory_id="m2",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="appearance",
            value="左臂有旧伤",
            source_ref="chapter:5",
            valid_from_chapter=5,
        ),
    ]
    progression = Progression(
        progression_id="p1",
        novel_id=1,
        entity_id="linlan",
        fact_type="appearance",
        atoms=atoms,
    )

    assert [atom.value for atom in atoms_active_at_chapter(progression.atoms, 3)] == ["左臂完好"]
    assert [atom.value for atom in atoms_active_at_chapter(progression.atoms, 8)] == ["左臂有旧伤"]


def test_create_memory_atom_persists_embedding_when_client_is_available(session: Session) -> None:
    """写入 memory atom 时应持久化 embedding，避免召回阶段反复按需嵌入全部事实。"""

    from app.domains.story_memory.models import MemoryAtomRecord

    book = Book(title="记忆向量持久化", status="draft", premise="验证 memory embedding。")
    session.add(book)
    session.commit()

    atom = create_memory_atom(
        session,
        MemoryAtom(
            memory_id="memory-vector",
            novel_id=book.id,
            entity_type="world_rule",
            entity_id="灯塔规约",
            fact_type="rule",
            value="入港船只必须登记灯塔许可",
            source_ref="chapter:1",
            valid_from_chapter=1,
            immutable=True,
        ),
        embedding_client=FixedMemoryEmbeddingClient(),
    )

    saved = session.get(MemoryAtomRecord, int(atom.memory_id.removeprefix("memory:")))

    assert saved is not None
    assert saved.embedding == [0.25, 0.75]


def test_memory_conflict_detection_flags_overlapping_different_values() -> None:
    """重叠章节区间的不同事实值必须生成冲突报告。"""

    atoms = [
        MemoryAtom(
            memory_id="m-left",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="公开身份是机械师",
            source_ref="chapter:2",
            valid_from_chapter=2,
            valid_to_chapter=8,
            immutable=True,
        ),
        MemoryAtom(
            memory_id="m-right",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="公开身份是舰队指挥官",
            source_ref="chapter:4",
            valid_from_chapter=4,
            valid_to_chapter=6,
        ),
        MemoryAtom(
            memory_id="m-other",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="relationship",
            value="信任副官",
            source_ref="chapter:4",
            valid_from_chapter=4,
        ),
    ]

    conflicts = detect_memory_conflicts(atoms)

    assert len(conflicts) == 1
    assert conflicts[0].severity == "blocking"
    assert conflicts[0].left_memory_id == "m-left"
    assert conflicts[0].right_memory_id == "m-right"
    assert "重叠章节区间" in conflicts[0].reason


def test_arbitrator_blocks_high_risk_agent_proposal() -> None:
    """Agent 提案遇到高风险事实冲突时只能进入人工审批。"""

    conflict = detect_memory_conflicts(
        [
            MemoryAtom(
                memory_id="m1",
                novel_id=1,
                entity_type="world_rule",
                entity_id="magic-rule",
                fact_type="rule",
                value="超光速跃迁需要灯塔许可",
                source_ref="chapter:1",
                valid_from_chapter=1,
                immutable=True,
            ),
            MemoryAtom(
                memory_id="m2",
                novel_id=1,
                entity_type="world_rule",
                entity_id="magic-rule",
                fact_type="rule",
                value="超光速跃迁无需任何许可",
                source_ref="draft:agent",
                valid_from_chapter=3,
            ),
        ]
    )
    proposal = AgentProposal(
        proposal_id="proposal-1",
        run_id="run-1",
        agent_name="plot_agent",
        target_type="memory",
        target_id="magic-rule",
        target_revision=1,
        operation="update",
        diff={"value": "超光速跃迁无需任何许可"},
        evidence_ids=["draft:agent"],
        severity="high",
        confidence=0.8,
    )

    decision = arbitrate_proposal(proposal, conflict)

    assert decision.decision == "needs_human"
    assert decision.blocked_by_conflict_ids == [conflict[0].conflict_id]


def test_memory_extract_bridge_writes_auditable_atoms_without_provider_credentials(session: Session) -> None:
    """memory_extract 写入桥应把章节抽取结果写入 Story Memory，并过滤 Provider 凭据。"""

    book = Book(title="写入桥", status="draft", premise="验证 memory_extract 写入。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=2, title="雾港旧伤", status="approved", summary="林岚公开旧伤。")
    session.add(chapter)
    session.commit()

    atoms = story_memory_service.write_memory_extract_atoms(
        session,
        book_id=book.id,
        chapter_id=chapter.id,
        approved_scene_id=88,
        extraction={
            "chapter_summary": {"summary": "林岚在雾港公开左臂旧伤。"},
            "character_states": [
                {"entity_id": "林岚", "status": "公开左臂旧伤", "confidence": 0.91},
            ],
            "world_facts": [
                {"entity_id": "雾港规约", "rule": "入港船只必须登记灯塔许可", "immutable": True},
            ],
            "foreshadow_refs": [
                {"entity_id": "旧伤线", "value": "左臂旧伤将牵出灯塔事故", "confidence": 0.76},
            ],
            "provider_api_key": "sk" + "-should-not-persist",
            "authorization": "Bearer" + " should-not-persist",
        },
    )

    assert [(atom.entity_type, atom.fact_type) for atom in atoms] == [
        ("subplot", "plot_thread"),
        ("character", "status"),
        ("world_rule", "rule"),
        ("subplot", "plot_thread"),
    ]
    assert {atom.source_chapter_id for atom in atoms} == {chapter.id}
    assert {atom.valid_from_chapter for atom in atoms} == {chapter.ordinal}
    assert all(f"chapter:{chapter.id}#approved_scene:88#memory_extract:" in atom.source_ref for atom in atoms)
    persisted_text = " ".join(f"{atom.value} {atom.source_ref}" for atom in atoms)
    assert "sk" + "-should-not-persist" not in persisted_text
    assert "Bearer" + " should-not-persist" not in persisted_text


def test_story_memory_recall_uses_embedding_when_keywords_do_not_overlap(session: Session) -> None:
    """关键词没有重叠时，Story Memory 仍应能通过语义向量召回相关事实。"""

    book = Book(title="语义记忆召回", status="draft", premise="验证 memory recall。")
    session.add(book)
    session.flush()
    chapter = Chapter(
        book_id=book.id,
        ordinal=6,
        title="午夜检修",
        status="draft",
        summary="林岚争取维修窗口。",
        pov="林岚",
        location="雾港",
    )
    session.add(chapter)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="semantic-hidden-injury",
            novel_id=book.id,
            entity_type="world_rule",
            entity_id="旧协议",
            fact_type="rule",
            value="旧协议要求隐藏伤员。",
            source_ref="chapter:2",
            valid_from_chapter=2,
            immutable=True,
            confidence=0.95,
        ),
    )
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="semantic-unrelated",
            novel_id=book.id,
            entity_type="location",
            entity_id="远方城市",
            fact_type="rule",
            value="远方城市正在举行烟火庆典。",
            source_ref="chapter:2",
            valid_from_chapter=2,
        ),
    )

    recalled = recall_scene_memory_atoms(
        session,
        book_id=book.id,
        chapter=chapter,
        assets=[],
        continuity_records=[],
        embedding_client=SemanticMemoryEmbeddingClient(),
    )

    assert [atom.entity_id for atom in recalled] == ["旧协议"]


def test_story_memory_recall_reuses_persisted_atom_embeddings(session: Session) -> None:
    """memory atom 已有持久化 embedding 时，召回阶段不应重新嵌入 atom 正文。"""

    from app.domains.story_memory.models import MemoryAtomRecord

    book = Book(title="复用持久化向量", status="draft", premise="验证 memory recall。")
    session.add(book)
    session.flush()
    chapter = Chapter(
        book_id=book.id,
        ordinal=6,
        title="午夜检修",
        status="draft",
        summary="林岚争取维修窗口。",
        pov="林岚",
        location="雾港",
    )
    session.add(chapter)
    session.flush()
    record = MemoryAtomRecord(
        book_id=book.id,
        entity_type="world_rule",
        entity_id="旧协议",
        fact_type="rule",
        value="旧协议要求隐藏伤员。",
        valid_from_chapter=2,
        immutable=True,
        confidence=0.95,
        revision=1,
        embedding=[1.0, 0.0],
        source_ref="chapter:2",
        source_chapter_id=None,
    )
    session.add(record)
    session.commit()

    embedding_client = QueryOnlyEmbeddingClient()

    recalled = recall_scene_memory_atoms(
        session,
        book_id=book.id,
        chapter=chapter,
        assets=[],
        continuity_records=[],
        embedding_client=embedding_client,
    )

    assert [atom.entity_id for atom in recalled] == ["旧协议"]
    assert embedding_client.calls == [["林岚 雾港 林岚争取维修窗口。"]]


def test_story_memory_pgvector_candidate_loader_orders_postgresql_embeddings() -> None:
    """PostgreSQL 记忆召回应能用 memory_atoms embedding_vector 做候选裁剪。"""

    import json
    from types import SimpleNamespace

    from sqlalchemy import select as sqlalchemy_select

    from app.domains.story_memory.models import MemoryAtomRecord

    class EmptyScalarResult:
        def all(self) -> list[MemoryAtomRecord]:
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
        sqlalchemy_select(MemoryAtomRecord)
        .where(MemoryAtomRecord.book_id == 1)
        .order_by(MemoryAtomRecord.entity_type, MemoryAtomRecord.entity_id, MemoryAtomRecord.fact_type, MemoryAtomRecord.id)
    )
    query_embedding = [0.1] * story_memory_service.DEFAULT_MEMORY_PGVECTOR_DIMENSIONS

    records = story_memory_service._load_memory_atom_candidates(
        session,
        statement,
        query_embedding=query_embedding,
        limit=3,
    )

    assert records == []
    assert json.loads(session.params["query_embedding"]) == query_embedding
    compiled_sql = str(session.statement)
    assert "memory_atoms.embedding_vector <=> CAST(:query_embedding AS vector)" in compiled_sql
    assert "ORDER BY memory_atoms.entity_type" not in compiled_sql
    assert "LIMIT" in compiled_sql


def test_story_memory_guard_flags_active_high_confidence_fact_violation(session: Session) -> None:
    """active 高置信长期事实被明显违反时，应输出 NovelLoop 静态质量端口兼容 issue。"""

    book = Book(title="跨卷记忆检查", status="draft", premise="验证 Story Memory guard。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=8, title="灯塔回声", status="draft", summary="林岚回到灯塔。")
    session.add(chapter)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="linlan-dead",
            novel_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="status",
            value="林岚已经死亡。",
            source_ref="chapter:4",
            valid_from_chapter=4,
            immutable=True,
            confidence=0.96,
        ),
    )

    issues = check_story_memory_continuity(
        session,
        book_id=book.id,
        chapter_id=chapter.id,  # Phase 2: 传入 chapter.id (PK)，函数内部会查询 ordinal
        draft="林岚推开舱门，呼吸一顿，随后开口说她会亲自带队穿越灯塔。",
    )

    assert len(issues) == 1
    assert set(issues[0]) == {"dimension", "severity", "snippet", "message", "suggestion", "revision_strategy"}
    assert issues[0]["dimension"] == "连续性"
    assert issues[0]["severity"] == "high"
    assert "林岚已经死亡" in issues[0]["snippet"]
    assert issues[0]["revision_strategy"] == "regenerate"


def test_story_memory_guard_ignores_non_violating_active_fact(session: Session) -> None:
    """草稿延续 active 长期事实时不应产生误杀。"""

    book = Book(title="记忆无误杀", status="draft", premise="验证 Story Memory guard。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=6, title="雾港规约", status="draft", summary="灯塔许可生效。")
    session.add(chapter)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="beacon-permit",
            novel_id=book.id,
            entity_type="world_rule",
            entity_id="灯塔许可",
            fact_type="rule",
            value="超光速跃迁需要灯塔许可。",
            source_ref="chapter:2",
            valid_from_chapter=2,
            immutable=True,
            confidence=0.93,
        ),
    )

    issues = check_story_memory_continuity(
        session,
        book_id=book.id,
        chapter_id=chapter.ordinal,
        draft="舰桥广播再次确认灯塔许可，超光速跃迁窗口才缓缓打开。",
    )

    assert issues == []


def test_story_memory_guard_ignores_expired_fact(session: Session) -> None:
    """过期事实即使被草稿反向书写，也不能阻断当前章节。"""

    book = Book(title="过期事实", status="draft", premise="验证 Story Memory guard。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=9, title="星港", status="draft", summary="林岚抵达星港。")
    session.add(chapter)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="linlan-fog-port",
            novel_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="location",
            value="林岚被困在雾港。",
            source_ref="chapter:3",
            valid_from_chapter=3,
            valid_to_chapter=5,
            immutable=True,
            confidence=0.91,
        ),
    )

    issues = check_story_memory_continuity(
        session,
        book_id=book.id,
        chapter_id=chapter.ordinal,
        draft="林岚离开雾港后在星港现身，亲自接收新的航图。",
    )

    assert issues == []


def test_progression_rejects_mixed_entities() -> None:
    """Progression 必须只描述同一实体同一事实类型，避免动态故事百科变成杂物箱。"""

    with pytest.raises(ValueError, match="同一实体"):
        Progression(
            progression_id="bad",
            novel_id=1,
            entity_id="linlan",
            fact_type="appearance",
            atoms=[
                MemoryAtom(
                    memory_id="m1",
                    novel_id=1,
                    entity_type="character",
                    entity_id="linlan",
                    fact_type="appearance",
                    value="左臂完好",
                    source_ref="chapter:1",
                ),
                MemoryAtom(
                    memory_id="m2",
                    novel_id=1,
                    entity_type="character",
                    entity_id="deputy",
                    fact_type="appearance",
                    value="戴黑色手套",
                    source_ref="chapter:1",
                ),
            ],
        )
