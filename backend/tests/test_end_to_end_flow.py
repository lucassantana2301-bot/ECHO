"""End-to-end integration test validating the entire ECHO lifecycle:
1. Register episode
2. Extract facts & entity relations
3. Reconcile to memory & persist pgvector embeddings
4. Retrieve memories with bitemporal & vector filtering
5. Compose answer grounded strictly in retrieved claim IDs & source evidence
"""

from datetime import UTC, datetime
import os
import uuid
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from echo.core.config import get_settings
from echo.core.db import Base
from echo.domain import EpisodeSource
from echo.models import Claim, ClaimVersion, Embedding, Episode, EvidenceLink, RelationVersion, User
from echo.pipeline.process import process_episode_job
from echo.providers.registry import get_providers
from echo.retrieval.answer_validation import validate_and_ground_answer
from echo.retrieval.search import retrieve_claims

pytestmark = pytest.mark.db


def is_postgres_reachable(db_url: str) -> bool:
    try:
        engine = create_engine(db_url, connect_args={"connect_timeout": 2})
        with engine.connect() as conn:
            return True
    except Exception:
        return False


@pytest.fixture(scope="module")
def pg_session_factory():
    db_url = get_settings().database_url
    if not is_postgres_reachable(db_url):
        if os.getenv("ECHO_REQUIRE_POSTGRES", "0").lower() in ("1", "true", "yes"):
            pytest.fail(f"PostgreSQL unreachable at {db_url}")
        else:
            pytest.skip(f"PostgreSQL unreachable at {db_url}")

    engine = create_engine(db_url)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)


def test_full_memory_engine_lifecycle(pg_session_factory):
    session = pg_session_factory()
    try:
        now = datetime(2026, 10, 5, 14, 30, 0, tzinfo=UTC)
        user_id = uuid.uuid4()

        # 0. User creation
        user = User(
            id=user_id,
            email=f"e2e_{user_id}@echo.ai",
            password_hash="hash",
            created_at=now,
        )
        session.add(user)
        session.commit()

        # 1. Register Episode
        content = "Estou desenvolvendo o projeto HyperSync em Rust para alta performance."
        episode = Episode(
            id=uuid.uuid4(),
            user_id=user_id,
            source_type=EpisodeSource.CHAT.value,
            content=content,
            occurred_at=now,
            recorded_at=now,
            processing_status="pending",
        )
        session.add(episode)
        session.commit()

        # 2. Pipeline: Extract facts -> Reconcile claims
        providers = get_providers()
        extractor, embedder, answerer = providers.extractor, providers.embedder, providers.answerer
        result = process_episode_job(
            session=session,
            now=now,
            episode_id=episode.id,
            extractor=extractor,
            pipeline_version="demo:v1",
        )
        session.commit()

        assert result["status"] == "processed"
        assert result["reconciled_count"] >= 1

        # Fetch the created ClaimVersion
        claim_versions = session.execute(
            select(ClaimVersion).where(ClaimVersion.user_id == user_id)
        ).scalars().all()
        assert len(claim_versions) >= 1
        claim_version = claim_versions[0]

        # Verify evidence links created
        evidences = session.execute(
            select(EvidenceLink).where(EvidenceLink.claim_version_id == claim_version.id)
        ).scalars().all()
        assert len(evidences) >= 1
        assert evidences[0].episode_id == episode.id

        # Persist pgvector embeddings for this claim version
        vector = embedder.embed([claim_version.statement])[0]
        embedding = Embedding(
            id=uuid.uuid4(),
            user_id=user_id,
            claim_version_id=claim_version.id,
            model=embedder.model,
            dim=embedder.dim,
            vector=vector,
            provider_mode=embedder.provider_name,
            recorded_at=now,
        )
        session.add(embedding)
        session.commit()

        # Verify pgvector embedding persisted
        persisted_embs = session.execute(
            select(Embedding).where(Embedding.claim_version_id == claim_version.id)
        ).scalars().all()
        assert len(persisted_embs) >= 1
        assert persisted_embs[0].dim == embedder.dim

        # 3. Retrieve Memory with vector & keyword search against pgvector
        retrieved_claims = retrieve_claims(
            session=session,
            user_id=user_id,
            question="Qual projeto em Rust estou desenvolvendo?",
            embedder=embedder,
            limit=5,
        )
        assert len(retrieved_claims) >= 1
        assert any(str(claim_version.claim_id) == cv.claim_id for cv in retrieved_claims)

        # 4. Generate grounded answer
        draft = answerer.answer(
            question="Qual projeto em Rust estou desenvolvendo?",
            context=retrieved_claims,
        )

        # 5. Strictly validate answer citations
        verified_answer, verified_citations, status_note = validate_and_ground_answer(
            draft=draft,
            context=retrieved_claims,
        )

        assert len(verified_citations) >= 1
        assert str(retrieved_claims[0].claim_id) in verified_citations
        assert len(verified_answer) > 0
        assert status_note in ("verified_citations", "extractive_fallback", "ok")
    finally:
        session.close()
