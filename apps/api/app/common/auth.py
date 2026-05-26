"""Dual-mode authentication: static API Key (service-to-service) and JWT Bearer Token (user sessions)."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import jwt


_JWT_ALGORITHM = "HS256"
_JWT_ISSUER = "storyforge"


def _jwt_secret() -> str:
    return os.getenv("STORYFORGE_JWT_SECRET", "")


def _jwt_expiry_seconds() -> int:
    raw = os.getenv("STORYFORGE_JWT_EXPIRY_SECONDS", "3600")
    try:
        val = int(raw)
    except ValueError:
        return 3600
    return val if val > 0 else 3600


@dataclass(frozen=True, slots=True)
class TokenPayload:
    user_id: str
    role: str
    exp: int
    iss: str = _JWT_ISSUER


def create_access_token(user_id: str, role: str = "user") -> str:
    secret = _jwt_secret()
    if not secret:
        raise RuntimeError("STORYFORGE_JWT_SECRET is not configured.")
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "iss": _JWT_ISSUER,
        "iat": now,
        "exp": now + _jwt_expiry_seconds(),
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)


class InvalidTokenError(Exception):
    pass


def verify_access_token(token: str) -> TokenPayload:
    secret = _jwt_secret()
    if not secret:
        raise InvalidTokenError("JWT authentication is not configured.")
    try:
        data = jwt.decode(
            token,
            secret,
            algorithms=[_JWT_ALGORITHM],
            issuer=_JWT_ISSUER,
            options={"require": ["sub", "role", "exp", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise InvalidTokenError("Token has expired.")
    except jwt.InvalidTokenError as exc:
        raise InvalidTokenError(str(exc))
    return TokenPayload(
        user_id=data["sub"],
        role=data["role"],
        exp=data["exp"],
    )
