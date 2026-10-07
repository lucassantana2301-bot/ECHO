"""Job queue over PostgreSQL using SELECT ... FOR UPDATE SKIP LOCKED.

Guarantees exactly-once dispatch without needing Redis. Jobs are locked to a
specific worker (via locked_by) and remain locked until finished or error.
"""

import socket
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from echo.core.clock import Clock
from echo.domain import JobStatus
from echo.models import Job

_WORKER_ID = f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


def enqueue_job(
    session: Session,
    *,
    now: datetime,
    user_id: uuid.UUID | None,
    kind: str,
    payload: dict[str, Any],
    idempotency_key: str,
    max_attempts: int = 5,
    run_after: datetime | None = None,
) -> Job:
    """Enqueues a job or returns an existing one by idempotency_key."""
    existing = (
        session.execute(select(Job).filter_by(idempotency_key=idempotency_key))
        .scalar_one_or_none()
    )
    if existing:
        return existing

    job = Job(
        user_id=user_id,
        kind=kind,
        payload=payload,
        idempotency_key=idempotency_key,
        status=JobStatus.QUEUED.value,
        max_attempts=max_attempts,
        run_after=run_after or now,
        created_at=now,
        updated_at=now,
    )
    session.add(job)
    return job


def claim_job(session: Session, *, now: datetime, lease_seconds: int = 300) -> Job | None:
    """Claims one pending job using SKIP LOCKED."""
    # Find a job that is either QUEUED and ready, or RUNNING but its lease expired.
    lease_cutoff = now - timedelta(seconds=lease_seconds)

    # 1. Select the job ID
    stmt = (
        select(Job.id)
        .where(
            Job.status.in_([JobStatus.QUEUED.value, JobStatus.RUNNING.value]),
            Job.run_after <= now,
            Job.attempts < Job.max_attempts,
            # If running, lease must be expired
            (Job.status == JobStatus.QUEUED.value) | (Job.locked_at < lease_cutoff),
        )
        .order_by(Job.run_after.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    job_id = session.execute(stmt).scalar_one_or_none()
    if not job_id:
        return None

    # 2. Update to RUNNING
    update_stmt = (
        update(Job)
        .where(Job.id == job_id)
        .values(
            status=JobStatus.RUNNING.value,
            attempts=Job.attempts + 1,
            locked_at=now,
            locked_by=_WORKER_ID,
            updated_at=now,
        )
        .returning(Job)
    )
    job = session.execute(update_stmt).scalar_one()
    return job


def mark_job_succeeded(session: Session, job: Job, *, now: datetime, result: dict | None) -> None:
    job.status = JobStatus.SUCCEEDED.value
    job.result = result
    job.updated_at = now
    job.finished_at = now
    job.locked_at = None
    job.locked_by = None


def mark_job_failed(
    session: Session, job: Job, *, now: datetime, error: str, retry_in_seconds: int | None = None
) -> None:
    job.last_error = error
    job.updated_at = now
    job.locked_at = None
    job.locked_by = None
    if job.attempts >= job.max_attempts or retry_in_seconds is None:
        job.status = JobStatus.FAILED.value
        job.finished_at = now
    else:
        job.status = JobStatus.QUEUED.value
        job.run_after = now + timedelta(seconds=retry_in_seconds)
