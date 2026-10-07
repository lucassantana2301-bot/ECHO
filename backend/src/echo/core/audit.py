import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from echo.models import AuditEvent

# Audit events are kept after erasure requests, so they must never carry personal content.
_FORBIDDEN_KEYS = {"content", "statement", "quote", "text", "value", "email", "note", "reason"}


def record_audit(
    session: Session,
    *,
    now: datetime,
    user_id: uuid.UUID | None,
    actor: str,
    action: str,
    target_type: str,
    target_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    details = details or {}
    leaked = _FORBIDDEN_KEYS.intersection(details)
    if leaked:
        raise ValueError(f"audit details must not contain personal content keys: {sorted(leaked)}")
    session.add(
        AuditEvent(
            user_id=user_id,
            actor=actor,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            recorded_at=now,
        )
    )
