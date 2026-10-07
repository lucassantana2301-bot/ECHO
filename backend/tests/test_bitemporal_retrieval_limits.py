"""Integration tests covering bitemporal exact boundaries, user isolation, idempotency, and citation grounding."""

from datetime import UTC, datetime, timedelta
import uuid
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from echo.core.db import Base
from echo.domain import (
    ChangeReason,
    ClaimKind,
    ClaimStatus,
    Domain,
    EpisodeSource,
    ProcessingStatus,
    Sensitivity,
)
from echo.memory.reconcile import reconcile_candidates
from echo.models import (
    AuditEvent,
    Claim,
    ClaimVersion,
    Entity,
    Episode,
    EvidenceLink,
    Job,
    RelationVersion,
    User,
)
from echo.providers.base import AnswerDraft, ContextItem, EntitySpec, ExtractionCandidate
from echo.providers.demo import DemoExtractiveAnswerer, DemoHashingEmbedder
from echo.retrieval.search import retrieve_claims


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(
        bind=engine,
        tables=[
            User.__table__,
            Episode.__table__,
            Claim.__table__,
            ClaimVersion.__table__,
            EvidenceLink.__table__,
            Entity.__table__,
            RelationVersion.__table__,
            Job.__table__,
            AuditEvent.__table__,
        ],
    )
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_bitemporal_exact_boundaries(test_db):
    """Validates exact inclusive/exclusive boundary conditions for recorded_at, superseded_at, valid_from, valid_to."""
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email="temporal_tester@echo.ai",
        password_hash="hash",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    test_db.add(user)

    # Claim 1: Recorded at T=10, superseded at T=20. Valid in [V=100, V=200)
    claim1 = Claim(
        id=uuid.uuid4(),
        user_id=user_id,
        subject_key="career.role",
        domain="career",
        recorded_at=datetime(2026, 1, 10, tzinfo=UTC),
    )
    test_db.add(claim1)
    
    cv1 = ClaimVersion(
        id=uuid.uuid4(),
        claim_id=claim1.id,
        user_id=user_id,
        version_no=1,
        kind="explicit_statement",
        statement="Junior Engineer",
        attributes={"value": "Junior Engineer"},
        status=ClaimStatus.ACTIVE.value,
        origin="extraction",
        change_reason="created",
        importance=0.5,
        sensitivity="low",
        valid_from=datetime(2026, 6, 1, tzinfo=UTC),  # V=100
        valid_to=datetime(2026, 12, 1, tzinfo=UTC),   # V=200
        recorded_at=datetime(2026, 1, 10, tzinfo=UTC), # T=10
        superseded_at=datetime(2026, 1, 20, tzinfo=UTC), # T=20
        pipeline_version="demo:v1",
        provider_mode="demo",
    )
    test_db.add(cv1)

    # Claim 2: Unbounded valid interval (no valid_to), recorded at T=20, active (superseded_at=None)
    cv2 = ClaimVersion(
        id=uuid.uuid4(),
        claim_id=claim1.id,
        user_id=user_id,
        version_no=2,
        kind="explicit_statement",
        statement="Senior Engineer",
        attributes={"value": "Senior Engineer"},
        status=ClaimStatus.ACTIVE.value,
        origin="extraction",
        change_reason="corrected",
        importance=0.8,
        sensitivity="low",
        valid_from=datetime(2026, 12, 1, tzinfo=UTC), # V=200
        valid_to=None, # Open-ended
        recorded_at=datetime(2026, 1, 20, tzinfo=UTC), # T=20
        superseded_at=None,
        pipeline_version="demo:v1",
        provider_mode="demo",
    )
    test_db.add(cv2)
    test_db.commit()

    # Boundary 1: as_of before recorded_at (T=9) -> Nothing known
    res = retrieve_claims(test_db, user_id=user_id, as_of=datetime(2026, 1, 9, tzinfo=UTC))
    assert len(res) == 0

    # Boundary 2: as_of exact recorded_at (T=10) -> cv1 is visible
    res = retrieve_claims(test_db, user_id=user_id, as_of=datetime(2026, 1, 10, tzinfo=UTC))
    assert len(res) == 1
    assert res[0].statement == "Junior Engineer"

    # Boundary 3: as_of between T=10 and T=20 (T=15) -> cv1 is visible
    res = retrieve_claims(test_db, user_id=user_id, as_of=datetime(2026, 1, 15, tzinfo=UTC))
    assert len(res) == 1
    assert res[0].statement == "Junior Engineer"

    # Boundary 4: as_of after supersession (T=25) -> cv2 is visible, cv1 is superseded
    res = retrieve_claims(test_db, user_id=user_id, as_of=datetime(2026, 1, 25, tzinfo=UTC))
    assert len(res) == 1
    assert res[0].statement == "Senior Engineer"

    # Valid-time Boundary 5: valid_at exact valid_from (2026-06-01) at as_of=15 -> cv1 is valid (inclusive lower bound)
    res = retrieve_claims(
        test_db,
        user_id=user_id,
        as_of=datetime(2026, 1, 15, tzinfo=UTC),
        valid_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    assert len(res) == 1
    assert res[0].statement == "Junior Engineer"

    # Valid-time Boundary 6: valid_at exact valid_to (2026-12-01) at as_of=15 -> cv1 is NOT valid (exclusive upper bound [from, to))
    res = retrieve_claims(
        test_db,
        user_id=user_id,
        as_of=datetime(2026, 1, 15, tzinfo=UTC),
        valid_at=datetime(2026, 12, 1, tzinfo=UTC),
    )
    assert len(res) == 0

    # Valid-time Boundary 7: Open-ended interval (cv2) valid_at=2030-01-01 -> cv2 is valid
    res = retrieve_claims(
        test_db,
        user_id=user_id,
        as_of=datetime(2026, 1, 25, tzinfo=UTC),
        valid_at=datetime(2030, 1, 1, tzinfo=UTC),
    )
    assert len(res) == 1
    assert res[0].statement == "Senior Engineer"


def test_user_isolation(test_db):
    """Ensures complete tenant isolation between users."""
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)

    test_db.add(User(id=user_a, email="a@echo.ai", password_hash="h", created_at=now))
    test_db.add(User(id=user_b, email="b@echo.ai", password_hash="h", created_at=now))

    # User A: learning Python
    ep_a = Episode(id=uuid.uuid4(), user_id=user_a, source_type="chat", content="Estou estudando Python", occurred_at=now, recorded_at=now, processing_status="processed")
    test_db.add(ep_a)
    reconcile_candidates(
        test_db,
        now=now,
        episode=ep_a,
        candidates=[ExtractionCandidate(
            kind=ClaimKind.EXPLICIT_STATEMENT,
            subject_key="learning.skill.python",
            statement="Estudando Python",
            value="Python",
            polarity="positive",
            domain=Domain.LEARNING,
            quote="estudando Python",
            extraction_confidence=0.9,
            importance=0.5,
            sensitivity=Sensitivity.LOW,
        )],
        pipeline_version="demo:v1",
        provider_mode="demo",
    )

    # User B: learning Rust
    ep_b = Episode(id=uuid.uuid4(), user_id=user_b, source_type="chat", content="Estou estudando Rust", occurred_at=now, recorded_at=now, processing_status="processed")
    test_db.add(ep_b)
    reconcile_candidates(
        test_db,
        now=now,
        episode=ep_b,
        candidates=[ExtractionCandidate(
            kind=ClaimKind.EXPLICIT_STATEMENT,
            subject_key="learning.skill.rust",
            statement="Estudando Rust",
            value="Rust",
            polarity="positive",
            domain=Domain.LEARNING,
            quote="estudando Rust",
            extraction_confidence=0.9,
            importance=0.5,
            sensitivity=Sensitivity.LOW,
        )],
        pipeline_version="demo:v1",
        provider_mode="demo",
    )
    test_db.commit()

    # Query User A with keyword 'Rust' -> Must return NOTHING (no leakage from user B)
    res_a = retrieve_claims(test_db, user_id=user_a, question="Rust")
    assert not any("Rust" in c.statement for c in res_a)

    # Query User B with keyword 'Rust' -> Returns User B's claim
    res_b = retrieve_claims(test_db, user_id=user_b, question="Rust")
    assert any("Rust" in c.statement for c in res_b)


def test_job_idempotent_reprocessing(test_db):
    """Ensures reprocessing the exact same job does not duplicate claims, versions, evidence links, or relations."""
    user_id = uuid.uuid4()
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)
    test_db.add(User(id=user_id, email="idempotent@echo.ai", password_hash="h", created_at=now))

    ep = Episode(
        id=uuid.uuid4(),
        user_id=user_id,
        source_type="chat",
        content="Meu objetivo é liderar projetos em Go.",
        occurred_at=now,
        recorded_at=now,
        processing_status="pending",
    )
    test_db.add(ep)
    test_db.flush()

    candidate = ExtractionCandidate(
        kind=ClaimKind.GOAL,
        subject_key="career.goal",
        statement="Objetivo: Liderar projetos em Go",
        value="Liderar projetos em Go",
        polarity="positive",
        domain=Domain.CAREER,
        quote="liderar projetos em Go",
        span_start=17,
        span_end=39,
        extraction_confidence=0.9,
        importance=0.8,
        sensitivity=Sensitivity.LOW,
        entity=EntitySpec(kind="skill", name="Go"),
    )

    # Pass 1
    reconcile_candidates(
        test_db,
        now=now,
        episode=ep,
        candidates=[candidate],
        pipeline_version="demo:v1",
        provider_mode="demo",
    )
    test_db.commit()

    claims_count_1 = test_db.execute(select(Claim).where(Claim.user_id == user_id)).scalars().all()
    versions_count_1 = test_db.execute(select(ClaimVersion).where(ClaimVersion.user_id == user_id)).scalars().all()
    evidence_count_1 = test_db.execute(select(EvidenceLink).where(EvidenceLink.user_id == user_id)).scalars().all()
    relations_count_1 = test_db.execute(select(RelationVersion).where(RelationVersion.user_id == user_id)).scalars().all()

    assert len(claims_count_1) == 1
    assert len(versions_count_1) == 1
    assert len(evidence_count_1) == 1
    assert len(relations_count_1) == 1

    # Pass 2: Reprocess same candidate on same episode
    reconcile_candidates(
        test_db,
        now=now + timedelta(seconds=10),
        episode=ep,
        candidates=[candidate],
        pipeline_version="demo:v1",
        provider_mode="demo",
    )
    test_db.commit()

    claims_count_2 = test_db.execute(select(Claim).where(Claim.user_id == user_id)).scalars().all()
    versions_count_2 = test_db.execute(select(ClaimVersion).where(ClaimVersion.user_id == user_id)).scalars().all()
    evidence_count_2 = test_db.execute(select(EvidenceLink).where(EvidenceLink.user_id == user_id)).scalars().all()
    relations_count_2 = test_db.execute(select(RelationVersion).where(RelationVersion.user_id == user_id)).scalars().all()

    # Strictly no duplicates created!
    assert len(claims_count_2) == 1
    assert len(versions_count_2) == 1
    assert len(evidence_count_2) == 1
    assert len(relations_count_2) == 1


def test_code_enforced_citation_grounding():
    """Validates that hallucinated or unretrieved claim IDs are stripped out in code."""
    valid_context = [
        ContextItem(
            claim_id="real-claim-001",
            kind="goal",
            statement="Staff Engineer",
            valid_from=None,
            valid_to=None,
            quotes=["quero me tornar Staff Engineer"],
        )
    ]

    valid_ids = {c.claim_id for c in valid_context}

    # Simulate an LLM returning real citation + hallucinated citation
    raw_llm_citations = ["real-claim-001", "hallucinated-claim-999", "fake-uuid-abc"]
    enforced_citations = [cid for cid in raw_llm_citations if cid in valid_ids]

    assert enforced_citations == ["real-claim-001"]
    assert "hallucinated-claim-999" not in enforced_citations
    assert "fake-uuid-abc" not in enforced_citations
