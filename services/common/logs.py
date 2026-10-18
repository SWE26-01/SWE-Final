"""Keep tokens out of the server logs.

Browsers pass the dashboard token in the WebSocket URL (`/ws?token=...`), and uvicorn logs request
lines, so the token would end up in `docker compose logs`.
"""

import logging
import re

_TOKEN = re.compile(r"(token=)[^&\s\"']+")


def hide_token(text: str) -> str:
    return _TOKEN.sub(r"\1***", text)


class HideTokens(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(hide_token(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.msg, str):
            record.msg = hide_token(record.msg)
        return True


def hide_tokens_in_server_logs() -> None:
    """Add the filter to uvicorn's request and WebSocket loggers (once)."""
    for name in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, HideTokens) for f in logger.filters):
            logger.addFilter(HideTokens())
