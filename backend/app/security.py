"""
Optional shared-secret guard for the storage service.

The browser no longer talks to this service directly — the Next.js app proxies
every call and attaches ``API_TOKEN`` from its own server-side environment. Set
the same value here and the service stops answering anyone else, which is what
you want the moment it is reachable from anything but localhost.

Left unset, the service behaves as before, so local development and the
existing offline-first flow keep working with no configuration.
"""

import hmac
import os

from fastapi import Header, HTTPException


def require_api_token(x_api_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("API_TOKEN", "")
    if not expected:
        return  # Unconfigured: open, as before.
    if not x_api_token or not hmac.compare_digest(x_api_token, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API token")
