"""Authoritative opening seat. Resuming a rack must never call this again."""

import secrets


def choose_breaker() -> int:
    return secrets.randbelow(2)
