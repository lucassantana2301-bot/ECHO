"""Unit tests for password hashing, token creation, validation, and expiration."""

import uuid
from datetime import UTC, datetime, timedelta
import pytest
import jwt

from echo.core.config import Settings
from echo.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_hashing():
    pwd = "MySecretPassword!2026"
    pwd_hash = hash_password(pwd)
    
    assert pwd_hash != pwd
    assert verify_password(pwd_hash, pwd) is True
    assert verify_password(pwd_hash, "WrongPassword") is False


def test_token_creation_and_decoding():
    user_id = uuid.uuid4()
    settings = Settings(jwt_secret="a" * 32, jwt_ttl_minutes=60)
    
    token, expires_in = create_access_token(user_id, settings)
    assert isinstance(token, str)
    assert expires_in == 3600
    
    decoded_user_id = decode_access_token(token, settings)
    assert decoded_user_id == user_id


def test_token_expired():
    user_id = uuid.uuid4()
    settings = Settings(jwt_secret="b" * 32, jwt_ttl_minutes=-10)  # already expired
    
    token, _ = create_access_token(user_id, settings)
    
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token, settings)


def test_token_invalid_signature():
    user_id = uuid.uuid4()
    settings_a = Settings(jwt_secret="a" * 32, jwt_ttl_minutes=60)
    settings_b = Settings(jwt_secret="b" * 32, jwt_ttl_minutes=60)
    
    token, _ = create_access_token(user_id, settings_a)
    
    with pytest.raises(jwt.InvalidSignatureError):
        decode_access_token(token, settings_b)
