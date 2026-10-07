"""Unit and integration tests for isolated demo session authentication flow."""

from datetime import UTC, datetime
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from echo.api.auth import get_db
from echo.api.main import app
from echo.core.config import Settings, get_settings
from echo.core.db import Base
from echo.models import AuditEvent, Claim, ClaimVersion, Embedding, Entity, Episode, EvidenceLink, Job, RelationVersion, User


@pytest.fixture
def test_client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_demo_session_creation_success(test_client):
    """Verifies POST /auth/demo-session issues a valid JWT and seeds initial demo data when mode=demo."""
    res = test_client.post("/auth/demo-session")
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "user" in data
    assert data["user"]["email"] == "demo@echo.local"

    token = data["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Verify /auth/me
    me_res = test_client.get("/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "demo@echo.local"

    # Verify seeded episodes
    ep_res = test_client.get("/episodes", headers=headers)
    assert ep_res.status_code == 200
    episodes = ep_res.json()
    assert len(episodes) >= 3

    # Verify seeded claims and graph
    claims_res = test_client.get("/claims", headers=headers)
    assert claims_res.status_code == 200
    claims = claims_res.json()
    assert len(claims) >= 1

    graph_res = test_client.get("/claims/graph/network", headers=headers)
    assert graph_res.status_code == 200
    graph_data = graph_res.json()
    assert "nodes" in graph_data
    assert "edges" in graph_data


def test_demo_session_isolation(test_client):
    """Verifies that demo user session is strictly isolated from real users' data."""
    # 1. Real user registers and ingests private episode
    reg_res = test_client.post("/auth/register", json={
        "email": "realuser@echo.ai",
        "password": "SecretPassword123!",
        "display_name": "Real User",
    })
    assert reg_res.status_code == 201

    login_res = test_client.post("/auth/login", json={
        "email": "realuser@echo.ai",
        "password": "SecretPassword123!",
    })
    real_token = login_res.json()["access_token"]
    real_headers = {"Authorization": f"Bearer {real_token}"}

    test_client.post("/episodes", json={
        "content": "Minha informação confidencial sobre compras corporativas.",
        "source_type": "note",
    }, headers=real_headers)

    # 2. Demo session is initialized
    demo_res = test_client.post("/auth/demo-session")
    assert demo_res.status_code == 200
    demo_token = demo_res.json()["access_token"]
    demo_headers = {"Authorization": f"Bearer {demo_token}"}

    # 3. Verify demo user cannot see real user's confidential episode
    demo_episodes = test_client.get("/episodes", headers=demo_headers).json()
    content_previews = [ep["content_preview"] for ep in demo_episodes if ep["content_preview"]]
    assert not any("confidencial" in text.lower() for text in content_previews)

    # 4. Verify real user cannot see demo user's episodes
    real_episodes = test_client.get("/episodes", headers=real_headers).json()
    assert len(real_episodes) == 1
    assert "confidencial" in real_episodes[0]["content_preview"].lower()


def test_demo_session_forbidden_in_live_mode(test_client):
    """Verifies POST /auth/demo-session returns HTTP 403 Forbidden when provider_mode is not demo."""
    live_settings = Settings(
        provider_mode="openai",
        llm_provider="openai",
        llm_api_key="sk-test-fake-key-for-unit-test",
    )
    app.dependency_overrides[get_settings] = lambda: live_settings

    try:
        res = test_client.post("/auth/demo-session")
        assert res.status_code == 403
        assert "only available in demo provider mode" in res.json()["detail"]
    finally:
        del app.dependency_overrides[get_settings]
