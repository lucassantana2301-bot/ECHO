"""Integration tests for FastAPI endpoints."""

from datetime import UTC, datetime
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from echo.api.auth import get_db
from echo.api.main import app
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
        ]
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
    yield client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_health_check(test_client):
    res = test_client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_auth_flow(test_client):
    # 1. Register
    reg_payload = {
        "email": "twin_owner@echo.ai",
        "password": "StrongPassword123!",
        "display_name": "Echo Pilot",
    }
    reg_res = test_client.post("/auth/register", json=reg_payload)
    assert reg_res.status_code == 201
    data = reg_res.json()
    assert data["email"] == "twin_owner@echo.ai"

    # 2. Login
    login_payload = {
        "email": "twin_owner@echo.ai",
        "password": "StrongPassword123!",
    }
    login_res = test_client.post("/auth/login", json=login_payload)
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert "access_token" in token_data
    token = token_data["access_token"]

    # 3. Get Me
    headers = {"Authorization": f"Bearer {token}"}
    me_res = test_client.get("/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "twin_owner@echo.ai"


def test_episodes_and_retrieval_flow(test_client):
    # 1. Register user
    reg_res = test_client.post("/auth/register", json={
        "email": "user2@echo.ai",
        "password": "Password123!",
        "display_name": "User Two",
    })
    assert reg_res.status_code == 201

    # 2. Login
    login_res = test_client.post("/auth/login", json={
        "email": "user2@echo.ai",
        "password": "Password123!",
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 3. Ingest episode
    ep_payload = {
        "content": "Estou estudando Rust para criar sistemas de alta performance.",
        "source_type": "chat",
    }
    ep_res = test_client.post("/episodes", json=ep_payload, headers=headers)
    assert ep_res.status_code == 200
    ep_data = ep_res.json()
    assert ep_data["processing_status"] in ("pending", "processed")
    assert "id" in ep_data

    # 4. Query retrieval endpoint
    ret_res = test_client.post("/retrieve", json={"question": "O que você está estudando?"}, headers=headers)
    assert ret_res.status_code == 200
    ret_data = ret_res.json()
    assert "answer" in ret_data
    assert "cited_claim_ids" in ret_data
