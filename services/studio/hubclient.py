"""Studio's calls to the Agent Hub, with the Studio service token (STUDIO_TOKEN)."""

from __future__ import annotations

from typing import Any

import httpx


class HubError(Exception):
    def __init__(self, status: int, detail: Any) -> None:
        self.status = status
        self.detail = detail
        super().__init__(f"Hub answered {status}: {detail}")


class HubClient:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    @classmethod
    def connect(cls, base_url: str, token: str | None) -> HubClient:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return cls(httpx.Client(base_url=base_url.rstrip("/"), headers=headers, timeout=10))

    def _call(self, method: str, path: str, **kw: Any) -> Any:
        try:
            r = self._client.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise HubError(503, f"Hub unreachable: {e.__class__.__name__}") from e
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except ValueError:
                detail = r.text[:200]
            raise HubError(r.status_code, detail)
        return r.json()

    def ownership(self) -> dict[str, str | None]:
        return self._call("GET", "/ownership")

    def register(self, registration: dict[str, Any]) -> dict[str, Any]:
        return self._call("POST", "/agents", json=registration)

    def close(self) -> None:
        self._client.close()
