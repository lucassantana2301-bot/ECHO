"""Unit tests for bitemporal logic and filters."""

from datetime import UTC, datetime, timedelta
import pytest
from echo.core.temporal import is_valid_at


def test_is_valid_at_unbounded():
    t = datetime(2026, 1, 1, tzinfo=UTC)
    assert is_valid_at(None, None, t) is True


def test_is_valid_at_half_bounded_start():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    before = datetime(2025, 12, 31, tzinfo=UTC)
    after = datetime(2026, 1, 2, tzinfo=UTC)
    
    assert is_valid_at(start, None, before) is False
    assert is_valid_at(start, None, start) is True
    assert is_valid_at(start, None, after) is True


def test_is_valid_at_half_bounded_end():
    end = datetime(2026, 6, 1, tzinfo=UTC)
    before = datetime(2026, 5, 31, tzinfo=UTC)
    at_end = datetime(2026, 6, 1, tzinfo=UTC)
    after = datetime(2026, 6, 2, tzinfo=UTC)

    assert is_valid_at(None, end, before) is True
    assert is_valid_at(None, end, at_end) is False  # interval is [from, to)
    assert is_valid_at(None, end, after) is False


def test_is_valid_at_bounded():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    end = datetime(2026, 6, 1, tzinfo=UTC)

    assert is_valid_at(start, end, datetime(2025, 12, 31, tzinfo=UTC)) is False
    assert is_valid_at(start, end, datetime(2026, 1, 1, tzinfo=UTC)) is True
    assert is_valid_at(start, end, datetime(2026, 3, 15, tzinfo=UTC)) is True
    assert is_valid_at(start, end, datetime(2026, 6, 1, tzinfo=UTC)) is False
    assert is_valid_at(start, end, datetime(2026, 6, 2, tzinfo=UTC)) is False
