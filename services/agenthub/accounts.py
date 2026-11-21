"""Accounts of the people who use the Hub: password hashing and login sessions.

Passwords are kept as salted scrypt hashes (standard library). A login gives a random session token;
the Hub stores only its sha256 (store.token_hash), like the agents' tokens. The screen keeps the
token in an httpOnly cookie on its own server (agent_hub_FE), never in page script."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

SESSION_DAYS = 7
_N, _R, _P = 2**14, 8, 1  # scrypt cost: about 50 ms per check


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, n, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        found = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=_R, p=_P, dklen=32
        )
    except ValueError:
        return False
    return hmac.compare_digest(found.hex(), digest)


def new_session() -> tuple[str, datetime]:
    """A session token (shown once, to the screen's server) and when it expires."""
    return secrets.token_urlsafe(32), datetime.now(UTC) + timedelta(days=SESSION_DAYS)


def expired(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:  # SQLite gives naive datetimes back
        expires_at = expires_at.replace(tzinfo=UTC)
    return expires_at <= datetime.now(UTC)
