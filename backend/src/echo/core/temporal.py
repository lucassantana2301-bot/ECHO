"""Bitemporal eligibility predicates.

Every read path that can feed an LLM, a profile or an export MUST build its
WHERE clause from these helpers. The temporal cut is applied in SQL, before any
context is assembled — never by asking a model to ignore "future" information.

- ``as_of``   : recorded-time cut ("what did ECHO know at T?"). ``None`` = now.
- ``valid_at``: valid-time filter ("what was true in the user's life at V?").
"""

from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, and_, or_, true


def version_visible(model: Any, as_of: datetime | None) -> ColumnElement[bool]:
    """A version row known at ``as_of`` and not yet superseded at ``as_of``."""
    if as_of is None:
        return model.superseded_at.is_(None)
    return and_(
        model.recorded_at <= as_of,
        or_(model.superseded_at.is_(None), model.superseded_at > as_of),
    )


def recorded_visible(model: Any, as_of: datetime | None) -> ColumnElement[bool]:
    """An append-only row (episode, embedding, conflict...) known at ``as_of``."""
    if as_of is None:
        return true()
    return model.recorded_at <= as_of


def evidence_visible(model: Any, as_of: datetime | None) -> ColumnElement[bool]:
    if as_of is None:
        return model.invalidated_at.is_(None)
    return and_(
        model.recorded_at <= as_of,
        or_(model.invalidated_at.is_(None), model.invalidated_at > as_of),
    )


def valid_at_filter(model: Any, valid_at: datetime | None) -> ColumnElement[bool]:
    if valid_at is None:
        return true()
    return and_(
        or_(model.valid_from.is_(None), model.valid_from <= valid_at),
        or_(model.valid_to.is_(None), model.valid_to > valid_at),
    )


def is_valid_at(valid_from: datetime | None, valid_to: datetime | None, at: datetime) -> bool:
    return (valid_from is None or valid_from <= at) and (valid_to is None or valid_to > at)
