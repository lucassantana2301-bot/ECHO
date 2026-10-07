"""The background worker loop."""

import logging
import time
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from echo.core.clock import SYSTEM_CLOCK
from echo.core.config import get_settings
from echo.core.db import session_scope
from echo.domain import JobKind
from echo.jobs.queue import claim_job, mark_job_failed, mark_job_succeeded
from echo.pipeline.process import process_episode_job
from echo.providers.registry import get_providers

logger = logging.getLogger(__name__)


def run_worker_iteration(session: Session, now: datetime) -> bool:
    """Runs one iteration of the worker. Returns True if a job was processed."""
    settings = get_settings()
    job = claim_job(session, now=now, lease_seconds=settings.job_lease_seconds)
    if not job:
        return False
        
    logger.info(f"Claimed job {job.id} (kind={job.kind})")
    
    try:
        providers = get_providers()
        result = None
        
        if job.kind == JobKind.PROCESS_EPISODE.value:
            import uuid
            episode_id = uuid.UUID(job.payload["episode_id"])
            result = process_episode_job(
                session, 
                now=now,
                episode_id=episode_id,
                extractor=providers.extractor,
                embedder=providers.embedder,
                pipeline_version=providers.pipeline_version,
            )
        else:
            raise NotImplementedError(f"Unknown job kind: {job.kind}")
            
        mark_job_succeeded(session, job, now=now, result=result)
        session.commit()
        logger.info(f"Job {job.id} succeeded.")
    except Exception as e:
        session.rollback()
        logger.exception(f"Job {job.id} failed: {e}")
        # Need a fresh session to update the job status
        with session_scope() as error_session:
            # Re-fetch job to update it
            from echo.models import Job
            failed_job = error_session.get(Job, job.id)
            if failed_job:
                # Retry backoff: 5, 25, 125 seconds etc
                retry_in = 5 ** failed_job.attempts if failed_job.attempts < failed_job.max_attempts else None
                mark_job_failed(error_session, failed_job, now=now, error=str(e), retry_in_seconds=retry_in)
                error_session.commit()
                
    return True


def start_worker_loop() -> None:
    settings = get_settings()
    logger.info("Starting ECHO worker loop...")
    while True:
        try:
            with session_scope() as session:
                processed = run_worker_iteration(session, SYSTEM_CLOCK.now())
            if not processed:
                time.sleep(settings.worker_poll_seconds)
        except KeyboardInterrupt:
            logger.info("Worker stopped.")
            break
        except Exception as e:
            logger.error(f"Worker iteration failed: {e}")
            time.sleep(settings.worker_poll_seconds)
