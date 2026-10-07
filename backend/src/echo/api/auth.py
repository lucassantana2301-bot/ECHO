import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from echo.core.clock import SYSTEM_CLOCK
from echo.core.config import Settings, get_settings
from echo.core.db import session_scope
from echo.core.security import create_access_token, decode_access_token, hash_password, verify_password
from echo.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

DEMO_USER_EMAIL = "demo@echo.local"
DEMO_USER_NAME = "Lucas"


def get_db() -> Session:
    with session_scope() as session:
        yield session


DbSession = Annotated[Session, Depends(get_db)]


class UserRegister(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = None


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse | None = None


def seed_demo_data_if_needed(db: Session, user_id: uuid.UUID) -> None:
    """Seeds initial demonstration episodes and processes claims for Lucas's demo profile."""
    from echo.domain import EpisodeSource
    from echo.episodes.ingest import ingest_episode
    from echo.models import Claim, ClaimVersion, Episode, EvidenceLink
    from echo.pipeline.process import process_episode_job
    from echo.providers.registry import get_providers

    # Ensure display name is set to Lucas for demo user
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user and user.display_name != DEMO_USER_NAME:
        user.display_name = DEMO_USER_NAME
        db.add(user)
        db.commit()

    sample_episodes = [
        (
            "Estou estudando Rust e arquitetura de backend para construir sistemas de alto desempenho e estou avançando nos estudos de AWS.",
            EpisodeSource.CHAT,
            datetime(2026, 1, 10, 10, 0, tzinfo=UTC),
        ),
        (
            "Estou estudando a trilha de certificação AWS Certified Cloud Practitioner (SIMULAÇÃO / EM PREPARAÇÃO — não obtida).",
            EpisodeSource.CHAT,
            datetime(2026, 3, 20, 9, 0, tzinfo=UTC),
        ),
        (
            "Decidi me preparar para a certificação AWS Certified Solutions Architect – Associate (SIMULAÇÃO / EM PREPARAÇÃO — não obtida).",
            EpisodeSource.NOTE,
            datetime(2026, 4, 1, 11, 0, tzinfo=UTC),
        ),
        (
            "Estou desenvolvendo projetos de backend e arquiteturas de nuvem com AWS para serviços de alta performance.",
            EpisodeSource.CHAT,
            datetime(2026, 4, 10, 16, 0, tzinfo=UTC),
        ),
    ]

    valid_contents = {content for content, _, _ in sample_episodes}

    # Remove obsolete demo episodes & claims if present from earlier runs
    obsolete_episodes = db.execute(
        select(Episode).where(Episode.user_id == user_id, Episode.content.notin_(valid_contents))
    ).scalars().all()

    for old_ep in obsolete_episodes:
        old_links = db.execute(
            select(EvidenceLink).where(EvidenceLink.episode_id == old_ep.id)
        ).scalars().all()
        for link in old_links:
            v_id = link.claim_version_id
            c_id = link.claim_id
            db.delete(link)
            db.commit()

            remaining_links = db.execute(
                select(EvidenceLink).where(EvidenceLink.claim_version_id == v_id)
            ).scalars().all()
            if not remaining_links:
                v = db.execute(select(ClaimVersion).where(ClaimVersion.id == v_id)).scalar_one_or_none()
                if v:
                    db.delete(v)
                    db.commit()
                remaining_versions = db.execute(
                    select(ClaimVersion).where(ClaimVersion.claim_id == c_id)
                ).scalars().all()
                if not remaining_versions:
                    c = db.execute(select(Claim).where(Claim.id == c_id)).scalar_one_or_none()
                    if c:
                        db.delete(c)
                        db.commit()
        db.delete(old_ep)
        db.commit()

    providers = get_providers()
    now = SYSTEM_CLOCK.now()

    for content, source, occurred in sample_episodes:
        # Idempotency check per episode content
        existing_ep = db.execute(
            select(Episode).where(Episode.user_id == user_id, Episode.content == content)
        ).scalars().first()

        if existing_ep:
            continue

        ep = ingest_episode(
            db,
            now=now,
            user_id=user_id,
            source_type=source,
            content=content,
            occurred_at=occurred,
            is_synthetic=False,
        )
        db.commit()

        process_episode_job(
            session=db,
            now=now,
            episode_id=ep.id,
            extractor=providers.extractor,
            embedder=None,
            pipeline_version=providers.pipeline_version,
        )
        db.commit()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(req: UserRegister, db: DbSession):
    existing = db.execute(select(User).where(User.email == req.email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
        created_at=SYSTEM_CLOCK.now(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login", response_model=Token)
def login(req: LoginRequest, db: DbSession):
    user = db.execute(select(User).where(User.email == req.email)).scalar_one_or_none()
    if not user or not verify_password(user.password_hash, req.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    settings = get_settings()
    access_token, expires_in = create_access_token(user.id, settings)
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse(id=user.id, email=user.email, display_name=user.display_name),
    )


@router.post("/token", response_model=Token)
def login_for_access_token(
    req: LoginRequest,
    db: DbSession,
):
    user = db.execute(select(User).where(User.email == req.email)).scalar_one_or_none()
    if not user or not verify_password(user.password_hash, req.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    settings = get_settings()
    access_token, expires_in = create_access_token(user.id, settings)
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse(id=user.id, email=user.email, display_name=user.display_name),
    )


@router.post("/demo-session", response_model=Token)
def create_demo_session(
    db: DbSession,
    settings: Settings = Depends(get_settings),
):
    """
    Starts an isolated, authenticated demonstration session.
    Available ONLY when ECHO_PROVIDER_MODE="demo".
    Returns an authentic JWT token for an isolated demo user account.
    """
    if settings.provider_mode != "demo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo session is only available in demo provider mode",
        )

    demo_user = db.execute(select(User).where(User.email == DEMO_USER_EMAIL)).scalar_one_or_none()
    if not demo_user:
        demo_user = User(
            id=uuid.uuid4(),
            email=DEMO_USER_EMAIL,
            password_hash=hash_password(f"demo_unusable_password_{uuid.uuid4()}"),
            display_name=DEMO_USER_NAME,
            created_at=SYSTEM_CLOCK.now(),
        )
        db.add(demo_user)
        db.commit()
        db.refresh(demo_user)
    elif demo_user.display_name != DEMO_USER_NAME:
        demo_user.display_name = DEMO_USER_NAME
        db.add(demo_user)
        db.commit()
        db.refresh(demo_user)

    seed_demo_data_if_needed(db, demo_user.id)

    access_token, expires_in = create_access_token(demo_user.id, settings)
    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse(id=demo_user.id, email=demo_user.email, display_name=demo_user.display_name),
    )


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: DbSession) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        settings = get_settings()
        user_id = decode_access_token(token, settings)
    except Exception:
        raise credentials_exception

    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/me", response_model=UserResponse)
def get_me(user: CurrentUser):
    return user
