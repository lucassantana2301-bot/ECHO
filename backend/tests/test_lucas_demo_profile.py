"""Integration tests for updated Lucas demo profile, AWS study track, idempotency, and isolation."""

from datetime import UTC, datetime
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from echo.api.auth import get_db
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


def test_lucas_demo_profile_creation_and_content(test_client):
    """Verifies Lucas profile seeding, removal of HyperSync/Principal Architect, mandatory memory, and AWS track."""
    res = test_client.post("/auth/demo-session")
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["display_name"] == "Lucas"
    token = data["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Verify /auth/me
    me_res = test_client.get("/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["display_name"] == "Lucas"

    # 2. Verify episodes count & mandatory content
    ep_res = test_client.get("/episodes", headers=headers)
    assert ep_res.status_code == 200
    episodes = ep_res.json()
    assert len(episodes) == 4

    previews = [ep["content_preview"] for ep in episodes if ep["content_preview"]]

    # Verify unconfirmed claims are NOT present
    assert not any("HyperSync" in p for p in previews)
    assert not any("Principal Architect" in p for p in previews)

    # Verify mandatory memory
    assert any(
        "Estou estudando Rust e arquitetura de backend para construir sistemas de alto desempenho e estou avançando nos estudos de AWS." in p
        for p in previews
    )
    assert any("AWS Certified Cloud Practitioner" in p for p in previews)
    assert any("AWS Certified Solutions Architect" in p for p in previews)
    assert all("SIMULAÇÃO / EM PREPARAÇÃO — não obtida" in p for p in previews if "AWS" in p and "certificação" in p)

    # 3. Verify claims
    claims_res = test_client.get("/claims", headers=headers)
    assert claims_res.status_code == 200
    claims = claims_res.json()
    assert len(claims) >= 3

    statements = [c["statement"] for c in claims if c["statement"]]
    assert not any("HyperSync" in s for s in statements)
    assert not any("Principal Architect" in s for s in statements)
    assert any("Rust" in s for s in statements)
    assert any("AWS Certified Cloud Practitioner" in s for s in statements)
    assert any("AWS Certified Solutions Architect" in s for s in statements)

    # 4. Verify retrieval / dialogue query
    ret_res = test_client.post("/retrieve", json={"question": "O que o Lucas está estudando?"}, headers=headers)
    assert ret_res.status_code == 200
    ret_data = ret_res.json()
    assert "answer" in ret_data
    assert len(ret_data["cited_claim_ids"]) >= 1

    # 5. Verify graph endpoint
    graph_res = test_client.get("/claims/graph/network", headers=headers)
    assert graph_res.status_code == 200
    graph_data = graph_res.json()
    assert len(graph_data["nodes"]) >= 3


def test_lucas_demo_profile_idempotency(test_client):
    """Verifies that re-running demo session seeding does not duplicate episodes or claims."""
    # 1st call
    res1 = test_client.post("/auth/demo-session")
    token1 = res1.json()["access_token"]
    headers1 = {"Authorization": f"Bearer {token1}"}

    ep1 = test_client.get("/episodes", headers=headers1).json()
    cl1 = test_client.get("/claims", headers=headers1).json()
    assert len(ep1) == 4

    # 2nd call
    res2 = test_client.post("/auth/demo-session")
    token2 = res2.json()["access_token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    ep2 = test_client.get("/episodes", headers=headers2).json()
    cl2 = test_client.get("/claims", headers=headers2).json()
    assert len(ep2) == 4
    assert len(cl2) == len(cl1)

    # 3rd call
    res3 = test_client.post("/auth/demo-session")
    headers3 = {"Authorization": f"Bearer {res3.json()['access_token']}"}
    ep3 = test_client.get("/episodes", headers=headers3).json()
    assert len(ep3) == 4


def test_lucas_demo_profile_isolation(test_client):
    """Verifies demo account data is strictly isolated from real user accounts."""
    # 1. Real user registers
    test_client.post("/auth/register", json={
        "email": "real_developer@echo.ai",
        "password": "StrongPassword123!",
        "display_name": "Developer Real",
    })
    login_res = test_client.post("/auth/login", json={
        "email": "real_developer@echo.ai",
        "password": "StrongPassword123!",
    })
    real_token = login_res.json()["access_token"]
    real_headers = {"Authorization": f"Bearer {real_token}"}

    # 2. Demo session
    demo_res = test_client.post("/auth/demo-session")
    demo_token = demo_res.json()["access_token"]
    demo_headers = {"Authorization": f"Bearer {demo_token}"}

    # Real user creates episode
    test_client.post("/episodes", json={
        "content": "Estou desenvolvendo o sistema bancário interno.",
        "source_type": "note",
    }, headers=real_headers)

    # Demo user cannot see real user's episode
    demo_eps = test_client.get("/episodes", headers=demo_headers).json()
    assert not any("bancário" in (ep["content_preview"] or "") for ep in demo_eps)

    # Real user cannot see Lucas's demo episodes
    real_eps = test_client.get("/episodes", headers=real_headers).json()
    assert len(real_eps) == 1
    assert "bancário" in real_eps[0]["content_preview"]
