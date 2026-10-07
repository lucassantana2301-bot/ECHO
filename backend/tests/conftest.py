"""Pytest fixtures and configuration."""

import uuid
from datetime import UTC, datetime, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from echo.core.clock import SYSTEM_CLOCK
from echo.core.db import Base
from echo.core.security import create_access_token, hash_password
from echo.models import User, Episode, Claim, ClaimVersion, EvidenceLink


@pytest.fixture
def test_now() -> datetime:
    return datetime(2026, 10, 5, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def in_memory_db():
    """Provides an in-memory SQLite database configured with PostgreSQL compatibility."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    # Create all tables (excluding vector type for raw sqlite if needed)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def sample_user(in_memory_db: Session, test_now: datetime) -> User:
    user = User(
        id=uuid.uuid4(),
        email="testuser@echo.twin",
        password_hash=hash_password("SuperSecretPass123!"),
        display_name="Echo Tester",
        created_at=test_now,
    )
    in_memory_db.add(user)
    in_memory_db.commit()
    in_memory_db.refresh(user)
    return user


@pytest.fixture
def auth_token(sample_user: User) -> str:
    return create_access_token(user_id=sample_user.id, email=sample_user.email)
