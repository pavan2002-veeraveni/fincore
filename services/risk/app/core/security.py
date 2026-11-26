"""
Service-token verification for internal (service-to-service) calls.

The token is compared in constant time to avoid timing side-channels.
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.core.config import settings


async def verify_service_token(
    x_service_token: str | None = Header(default=None, alias="X-Service-Token"),
) -> str:
    """Validate the X-Service-Token header in constant time."""
    if not x_service_token or not hmac.compare_digest(
        x_service_token, settings.effective_service_token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing service token.",
        )
    return x_service_token
