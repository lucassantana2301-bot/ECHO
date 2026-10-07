"""Integration test suite exclusive to PostgreSQL + pgvector.

Requires a reachable PostgreSQL instance with pgvector extension.
If ECHO_REQUIRE_POSTGRES=1 is set and the database is unreachable, tests fail strictly.
Otherwise, when run without ECHO_REQUIRE_POSTGRES=1 and without a reachable DB, tests are skipped.
"""

from datetime import UTC, datetime, timedelta
import os
import uuid
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from echo.core.config import get_settings
from echo.core.db import Base
from echo.domain import ClaimKind, ClaimStatus, Domain, JobKind, JobStatus, Sensitivity
from echo.memory.reconcile import reconcile_candidates
from echo.models import Claim, ClaimVersion, Embedding, Episode, EvidenceLink, Job, User
from echo.providers.base import EntitySpec, ExtractionCandidate
from echo.providers.demo import DemoHashingEmbedder
from echo.retrieval.search import retrieve_claims

pytestmark = pytest.mark.db


def is_postgres_reachable(db_url: str) -> bool:
    try:
        engine = create_engine(db_url, connect_args={"connect_timeout": 2})
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def postgres_engine():
    db_url = get_settings().database_url
    require_db = os.getenv("ECHO_REQUIRE_POSTGRES", "0").lower() in ("1", "true", "yes")

    if not is_postgres_reachable(db_url):
        if require_db:
            pytest.fail(f"PostgreSQL + pgvector is unreachable at {db_url} but was explicitly required (ECHO_REQUIRE_POSTGRES=1).")
        else:
            pytest.skip(f"PostgreSQL + pgvector is unreachable at {db_url}. Integration tests not executed.")

    engine = create_engine(db_url)
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()

    Base.metadata.create_all(bind=engine)
    yield engine


@pytest.fixture
def pg_session(postgres_engine):
    SessionLocal = sessionmaker(bind=postgres_engine)
    session = SessionLocal()
    yield session
    session.rollback()
    session.close()


def test_postgres_empty_db_migration_and_extensions(postgres_engine):
    """Verifies PostgreSQL extension vector and table creation."""
    with postgres_engine.connect() as conn:
        res = conn.execute(text("SELECT extname FROM pg_extension WHERE extname = 'vector'")).fetchall()
        assert len(res) == 1
        assert res[0][0] == "vector"

        # Verify all essential tables exist
        tables = conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        ).fetchall()
        table_names = {t[0] for t in tables}
        expected = {"users", "episodes", "jobs", "claims", "claim_versions", "embeddings", "evidence_links", "relation_versions", "entities", "conflict_links", "audit_events"}
        assert expected.issubset(table_names)


def test_postgres_vector_search_and_pgvector_compatibility(pg_session):
    user_id = uuid.uuid4()
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)

    user = User(id=user_id, email=f"pg_vector_{user_id}@echo.ai", password_hash="hash", created_at=now)
    pg_session.add(user)
    pg_session.flush()

    claim = Claim(id=uuid.uuid4(), user_id=user_id, subject_key="learning.skill.rust", domain="learning", recorded_at=now)
    pg_session.add(claim)
    pg_session.flush()

    cv = ClaimVersion(
        id=uuid.uuid4(),
        claim_id=claim.id,
        user_id=user_id,
        version_no=1,
        kind="explicit_statement",
        statement="Estou aprendendo Rust para criar sistemas seguros e concorrentes",
        attributes={"value": "Rust"},
        status=ClaimStatus.ACTIVE.value,
        origin="extraction",
        change_reason="created",
        importance=0.8,
        sensitivity="low",
        valid_from=now,
        valid_to=None,
        recorded_at=now,
        superseded_at=None,
        pipeline_version="demo:v1",
        provider_mode="demo",
    )
    pg_session.add(cv)
    pg_session.flush()

    embedder = DemoHashingEmbedder(dim=256)
    vec = embedder.embed([cv.statement])[0]

    emb = Embedding(
        id=uuid.uuid4(),
        user_id=user_id,
        claim_version_id=cv.id,
        model=embedder.model,
        dim=embedder.dim,
        vector=vec,
        provider_mode=embedder.provider_name,
        recorded_at=now,
    )
    pg_session.add(emb)
    pg_session.commit()

    # Query with vector search against PostgreSQL + pgvector
    results = retrieve_claims(
        pg_session,
        user_id=user_id,
        question="Qual linguagem de sistemas estou estudando?",
        embedder=embedder,
    )
    assert len(results) >= 1
    assert "Rust" in results[0].statement


def test_postgres_bitemporal_retrieval_and_limits(pg_session):
    """Validates bitemporal filtering directly on PostgreSQL."""
    user_id = uuid.uuid4()
    pg_session.add(User(id=user_id, email=f"pg_bt_{user_id}@echo.ai", password_hash="hash", created_at=datetime.now(UTC)))
    pg_session.flush()

    t0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    t1 = datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC)
    t2 = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)

    claim = Claim(id=uuid.uuid4(), user_id=user_id, subject_key="profile.city", domain="profile", recorded_at=t0)
    pg_session.add(claim)
    pg_session.flush()

    # v1: Paris (recorded t0, superseded t1, valid t0..t1)
    v1 = ClaimVersion(
        id=uuid.uuid4(), claim_id=claim.id, user_id=user_id, version_no=1, kind="explicit_statement",
        statement="Moro em Paris", attributes={"city": "Paris"}, status="active", origin="extraction",
        change_reason="created", importance=0.7, sensitivity="low", valid_from=t0, valid_to=t1,
        recorded_at=t0, superseded_at=t1, pipeline_version="v1", provider_mode="demo"
    )
    # v2: Tokyo (recorded t1, current, valid t1..None)
    v2 = ClaimVersion(
        id=uuid.uuid4(), claim_id=claim.id, user_id=user_id, version_no=2, kind="explicit_statement",
        statement="Moro em Tóquio", attributes={"city": "Tokyo"}, status="active", origin="extraction",
        change_reason="superseded", importance=0.7, sensitivity="low", valid_from=t1, valid_to=None,
        recorded_at=t1, superseded_at=None, pipeline_version="v1", provider_mode="demo"
    )
    pg_session.add_all([v1, v2])
    pg_session.commit()

    # As of t0 -> Paris
    res_t0 = retrieve_claims(pg_session, user_id=user_id, question="Moro", as_of=t0, valid_at=t0)
    assert len(res_t0) == 1
    assert "Paris" in res_t0[0].statement

    # As of t2 -> Tokyo
    res_t2 = retrieve_claims(pg_session, user_id=user_id, question="Moro", as_of=t2, valid_at=t2)
    assert len(res_t2) == 1
    assert "Tóquio" in res_t2[0].statement


def test_postgres_user_isolation(pg_session):
    """Ensures complete data isolation between separate users."""
    u1 = uuid.uuid4()
    u2 = uuid.uuid4()
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)

    pg_session.add(User(id=u1, email=f"u1_{u1}@echo.ai", password_hash="h", created_at=now))
    pg_session.add(User(id=u2, email=f"u2_{u2}@echo.ai", password_hash="h", created_at=now))
    pg_session.flush()

    c1 = Claim(id=uuid.uuid4(), user_id=u1, subject_key="secret.u1", domain="other", recorded_at=now)
    pg_session.add(c1)
    pg_session.flush()

    pg_session.add(ClaimVersion(
        id=uuid.uuid4(), claim_id=c1.id, user_id=u1, version_no=1, kind="explicit_statement",
        statement="Segredo confidencial de Alice", attributes={}, status="active", origin="extraction",
        change_reason="created", importance=0.9, sensitivity="high", valid_from=now, valid_to=None,
        recorded_at=now, superseded_at=None, pipeline_version="v1", provider_mode="demo"
    ))
    pg_session.commit()

    # User 2 must never access User 1's claims
    res = retrieve_claims(pg_session, user_id=u2, question="confidencial")
    assert len(res) == 0


def test_postgres_reconcile_idempotency_and_evidence(pg_session):
    """Ensures reprocessing a job against PostgreSQL produces no duplicate records."""
    user_id = uuid.uuid4()
    episode_id = uuid.uuid4()
    job_id = uuid.uuid4()
    now = datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)

    user = User(id=user_id, email=f"idemp_{user_id}@echo.ai", password_hash="h", created_at=now)
    pg_session.add(user)
    pg_session.flush()

    episode = Episode(
        id=episode_id,
        user_id=user_id,
        source_type="chat",
        content="Eu adoro programar em Python.",
        occurred_at=now,
        recorded_at=now,
        processing_status="processed",
    )
    job = Job(
        id=job_id,
        user_id=user_id,
        kind=JobKind.PROCESS_EPISODE.value,
        payload={"episode_id": str(episode_id)},
        idempotency_key=f"ep:{episode_id}",
        status=JobStatus.SUCCEEDED.value,
        max_attempts=3,
        run_after=now,
        created_at=now,
        updated_at=now,
    )
    pg_session.add_all([episode, job])
    pg_session.commit()

    candidate = ExtractionCandidate(
        kind=ClaimKind.PREFERENCE,
        subject_key="preferences.programming.python",
        statement="Adora programar em Python",
        value="Python",
        domain=Domain.OTHER,
        quote="Eu adoro programar em Python.",
        span_start=0,
        span_end=28,
        extraction_confidence=0.95,
        importance=0.8,
        sensitivity=Sensitivity.LOW,
        valid_from=now,
        valid_to=None,
        entities=[EntitySpec(kind="technology", name="Python")],
    )

    # First reconciliation
    v_first = reconcile_candidates(
        session=pg_session,
        now=now,
        episode=episode,
        candidates=[candidate],
        pipeline_version="v1",
        provider_mode="demo",
    )
    pg_session.commit()

    # Re-run same episode reconciliation (Idempotency)
    v_second = reconcile_candidates(
        session=pg_session,
        now=now,
        episode=episode,
        candidates=[candidate],
        pipeline_version="v1",
        provider_mode="demo",
    )
    pg_session.commit()

    assert len(v_first) == 1
    assert len(v_second) == 1
    assert v_first[0].id == v_second[0].id

    # Check evidence link count
    ev_links = pg_session.execute(
        select(EvidenceLink).where(EvidenceLink.claim_version_id == v_first[0].id)
    ).scalars().all()
    assert len(ev_links) == 1

