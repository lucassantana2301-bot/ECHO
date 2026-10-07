"""Regression test for GET /claims/{claim_id} endpoint with evidence links and version history."""

from datetime import UTC, datetime
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from echo.api.auth import get_db, create_access_token
from echo.api.main import app
from echo.core.config import Settings
from echo.core.db import Base
from echo.models import AuditEvent, Claim, ClaimVersion, Entity, Episode, EvidenceLink, Job, RelationVersion, User


@pytest.fixture
def test_client():
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
    TestingSessionLocal = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client, TestingSessionLocal
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_get_claim_details_with_evidences_and_versions(test_client):
    client, session_factory = test_client
    db = session_factory()
    now = datetime.now(UTC)

    # 1. Create two users to test user isolation
    user1 = User(
        id=uuid.uuid4(),
        email="user1@echo.local",
        password_hash="hash",
        display_name="User One",
        created_at=now,
    )
    user2 = User(
        id=uuid.uuid4(),
        email="user2@echo.local",
        password_hash="hash",
        display_name="User Two",
        created_at=now,
    )
    db.add_all([user1, user2])
    db.commit()

    # 2. Create an episode for user 1
    episode1 = Episode(
        id=uuid.uuid4(),
        user_id=user1.id,
        source_type="chat",
        content="Estou estudando Rust para criar sistemas de alta performance.",
        occurred_at=now,
        recorded_at=now,
        processing_status="processed",
    )
    db.add(episode1)
    db.commit()

    # 3. Create a claim for user 1
    claim1 = Claim(
        id=uuid.uuid4(),
        user_id=user1.id,
        subject_key="user",
        domain="CAREER",
        recorded_at=now,
    )
    db.add(claim1)
    db.commit()

    # 4. Create claim versions for claim 1 (version 1 superseded, version 2 current)
    v1 = ClaimVersion(
        id=uuid.uuid4(),
        claim_id=claim1.id,
        user_id=user1.id,
        version_no=1,
        kind="LEARNING",
        statement="Usuário está aprendendo Python",
        attributes={},
        status="ACTIVE",
        origin="EXTRACTED",
        change_reason="CREATED",
        extraction_confidence=0.9,
        importance=0.8,
        sensitivity="LOW",
        recorded_at=now,
        superseded_at=now,
        pipeline_version="1.0",
        provider_mode="demo",
        source_episode_id=episode1.id,
    )
    v2 = ClaimVersion(
        id=uuid.uuid4(),
        claim_id=claim1.id,
        user_id=user1.id,
        version_no=2,
        kind="LEARNING",
        statement="Usuário está estudando Rust para criar sistemas de alta performance",
        attributes={},
        status="ACTIVE",
        origin="EXTRACTED",
        change_reason="UPDATED",
        extraction_confidence=0.95,
        importance=0.9,
        sensitivity="LOW",
        recorded_at=now,
        superseded_at=None,
        pipeline_version="1.0",
        provider_mode="demo",
        source_episode_id=episode1.id,
    )
    db.add_all([v1, v2])
    db.commit()

    # 5. Create evidence links for version 2
    ev_link = EvidenceLink(
        id=uuid.uuid4(),
        user_id=user1.id,
        claim_id=claim1.id,
        claim_version_id=v2.id,
        episode_id=episode1.id,
        span_start=0,
        span_end=20,
        quote="Estou estudando Rust",
        stance="SUPPORTS",
        is_independent=True,
        recorded_at=now,
    )
    db.add(ev_link)
    db.commit()
    u1_id = user1.id
    u2_id = user2.id
    claim1_id = claim1.id
    v2_id = v2.id
    ev_link_id = ev_link.id
    episode1_id = episode1.id
    db.close()

    # 6. Generate auth tokens
    settings = Settings()
    token_u1, _ = create_access_token(u1_id, settings)
    token_u2, _ = create_access_token(u2_id, settings)

    # 7. Request GET /claims/{claim_id} as User 1
    res = client.get(f"/claims/{claim1_id}", headers={"Authorization": f"Bearer {token_u1}"})
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    
    data = res.json()
    assert data["id"] == str(claim1_id)
    assert data["subject_key"] == "user"
    assert data["domain"] == "CAREER"
    
    # Check current version
    assert data["current_version"] is not None
    assert data["current_version"]["version_id"] == str(v2_id)
    assert data["current_version"]["version_no"] == 2
    assert len(data["current_version"]["evidences"]) == 1
    
    ev = data["current_version"]["evidences"][0]
    assert ev["link_id"] == str(ev_link_id)
    assert ev["episode_id"] == str(episode1_id)
    assert ev["quote"] == "Estou estudando Rust"
    assert ev["span_start"] == 0
    assert ev["span_end"] == 20
    assert ev["source_type"] == "chat"
    assert ev["confidence"] == 0.95
    assert ev["stance"] == "SUPPORTS"

    # Check all versions returned
    assert len(data["versions"]) == 2

    # 8. User isolation test: User 2 requesting User 1's claim must get 404
    res_u2 = client.get(f"/claims/{claim1_id}", headers={"Authorization": f"Bearer {token_u2}"})
    assert res_u2.status_code == 404
