"""Unit and integration tests for memory reconciliation, supersession, and idempotency."""

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
    RelationVersion,
    User,
)
from echo.providers.base import EntitySpec, ExtractionCandidate


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Create tables
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
            AuditEvent.__table__,
        ]
    )
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_reconcile_initial_claim(db_session):
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)
    user_id = uuid.uuid4()
    
    episode = Episode(
        id=uuid.uuid4(),
        user_id=user_id,
        source_type=EpisodeSource.CHAT.value,
        content="Meu objetivo é me tornar Staff Engineer.",
        occurred_at=now,
        recorded_at=now,
        processing_status=ProcessingStatus.PENDING.value,
    )
    db_session.add(episode)
    db_session.flush()

    candidate = ExtractionCandidate(
        kind=ClaimKind.GOAL,
        subject_key="career.goal",
        statement="Objetivo: Staff Engineer",
        value="Staff Engineer",
        polarity="positive",
        domain=Domain.CAREER,
        quote="me tornar Staff Engineer",
        span_start=17,
        span_end=41,
        extraction_confidence=0.9,
        importance=0.8,
        sensitivity=Sensitivity.LOW,
        entity=EntitySpec(kind="role", name="Staff Engineer"),
    )

    versions = reconcile_candidates(
        db_session,
        now=now,
        episode=episode,
        candidates=[candidate],
        pipeline_version="demo:rule-v1",
        provider_mode="demo",
    )

    assert len(versions) == 1
    v = versions[0]
    assert v.version_no == 1
    assert v.statement == "Objetivo: Staff Engineer"
    assert v.status == ClaimStatus.ACTIVE.value
    assert v.change_reason == ChangeReason.CREATED.value
    assert v.superseded_at is None

    # Verify Claim root
    claim = db_session.execute(select(Claim).where(Claim.id == v.claim_id)).scalar_one()
    assert claim.subject_key == "career.goal"

    # Verify EvidenceLink
    evidence = db_session.execute(select(EvidenceLink).where(EvidenceLink.claim_id == claim.id)).scalar_one()
    assert evidence.quote == "me tornar Staff Engineer"
    assert evidence.span_start == 17
    assert evidence.span_end == 41

    # Verify Entity & Relation
    entity = db_session.execute(select(Entity).where(Entity.name == "Staff Engineer")).scalar_one()
    assert entity.kind == "role"
    
    rel = db_session.execute(select(RelationVersion).where(RelationVersion.claim_id == claim.id)).scalar_one()
    assert rel.entity_id == entity.id
    assert rel.superseded_at is None


def test_reconcile_supersession_on_change(db_session):
    now1 = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)
    now2 = datetime(2026, 10, 6, 12, 0, 0, tzinfo=UTC)
    user_id = uuid.uuid4()
    
    # 1. First episode: Role = Software Engineer
    ep1 = Episode(
        id=uuid.uuid4(),
        user_id=user_id,
        source_type=EpisodeSource.CHAT.value,
        content="Trabalho como Software Engineer.",
        occurred_at=now1,
        recorded_at=now1,
        processing_status=ProcessingStatus.PROCESSED.value,
    )
    db_session.add(ep1)
    db_session.flush()

    cand1 = ExtractionCandidate(
        kind=ClaimKind.EXPLICIT_STATEMENT,
        subject_key="career.role",
        statement="Função atual: Software Engineer",
        value="Software Engineer",
        polarity="positive",
        domain=Domain.CAREER,
        quote="Software Engineer",
        span_start=14,
        span_end=31,
        extraction_confidence=0.9,
        importance=0.7,
        sensitivity=Sensitivity.LOW,
    )
    reconcile_candidates(
        db_session,
        now=now1,
        episode=ep1,
        candidates=[cand1],
        pipeline_version="demo:rule-v1",
        provider_mode="demo",
    )

    # Verify version 1 is active
    v1 = db_session.execute(
        select(ClaimVersion).where(ClaimVersion.superseded_at.is_(None))
    ).scalar_one()
    assert v1.version_no == 1
    assert v1.attributes["value"] == "Software Engineer"

    # 2. Second episode: Changed to Tech Lead
    ep2 = Episode(
        id=uuid.uuid4(),
        user_id=user_id,
        source_type=EpisodeSource.CHAT.value,
        content="Mudei de cargo, agora trabalho como Tech Lead.",
        occurred_at=now2,
        recorded_at=now2,
        processing_status=ProcessingStatus.PENDING.value,
    )
    db_session.add(ep2)
    db_session.flush()

    cand2 = ExtractionCandidate(
        kind=ClaimKind.EXPLICIT_STATEMENT,
        subject_key="career.role",
        statement="Função atual: Tech Lead",
        value="Tech Lead",
        polarity="positive",
        domain=Domain.CAREER,
        quote="Tech Lead",
        span_start=37,
        span_end=46,
        signals_change=True,
        extraction_confidence=0.95,
        importance=0.8,
        sensitivity=Sensitivity.LOW,
    )
    reconcile_candidates(
        db_session,
        now=now2,
        episode=ep2,
        candidates=[cand2],
        pipeline_version="demo:rule-v1",
        provider_mode="demo",
    )

    # Verify version 1 is superseded at now2
    db_session.refresh(v1)
    assert v1.superseded_at is not None
    assert (v1.superseded_at.replace(tzinfo=UTC) if v1.superseded_at.tzinfo is None else v1.superseded_at) == now2

    # Verify version 2 is active
    v2 = db_session.execute(
        select(ClaimVersion).where(ClaimVersion.superseded_at.is_(None))
    ).scalar_one()
    assert v2.version_no == 2
    assert v2.attributes["value"] == "Tech Lead"
    assert v2.change_reason == ChangeReason.ENDED.value
    assert (v2.recorded_at.replace(tzinfo=UTC) if v2.recorded_at.tzinfo is None else v2.recorded_at) == now2
    assert v2.claim_id == v1.claim_id
