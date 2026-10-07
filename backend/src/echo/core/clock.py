"""Injectable clock.

Recorded time (when the system learned something) always comes from a Clock,
never from the client. Tests and the synthetic seed use FrozenClock to build
deterministic histories.
"""

from datetime import UTC, datetime, timedelta
from typing import Protocol


def ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError("naive datetimes are not allowed; include a timezone")
    return dt.astimezone(UTC)


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FrozenClock:
    def __init__(self, at: datetime) -> None:
        self._at = ensure_aware(at)

    def now(self) -> datetime:
        return self._at

    def set(self, at: datetime) -> None:
        self._at = ensure_aware(at)

    def advance(self, **kwargs: float) -> datetime:
        self._at = self._at + timedelta(**kwargs)
        return self._at


SYSTEM_CLOCK = SystemClock()
