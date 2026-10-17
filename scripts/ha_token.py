"""Onboard a fresh Home Assistant and mint a long-lived access token.

  python scripts/ha_token.py <ha_url> <password>   → prints the token on stdout

Only works before HA's owner account exists; otherwise create the token in the UI
(Profile → Security → Long-lived access tokens).
"""

import asyncio
import json
import sys

import httpx
import websockets


async def main(url: str, password: str) -> str:
    client_id = f"{url}/"
    async with httpx.AsyncClient(base_url=url, timeout=30) as http:
        r = await http.post("/api/onboarding/users", json={
            "client_id": client_id, "name": "Ambient Admin", "username": "admin", "password": password, "language": "ko",
        })
        if r.status_code == 403:
            sys.exit("HA is already onboarded; create a long-lived token in the UI and put it in .env as HA_TOKEN")
        r.raise_for_status()
        tok = (await http.post("/auth/token", data={"grant_type": "authorization_code", "code": r.json()["auth_code"], "client_id": client_id})).json()
        auth = {"Authorization": f"Bearer {tok['access_token']}"}
        # Finish the remaining wizard steps so the UI opens straight to the dashboard (best effort).
        await http.post("/api/onboarding/core_config", headers=auth, json={})
        await http.post("/api/onboarding/analytics", headers=auth, json={})
        await http.post("/api/onboarding/integration", headers=auth, json={"client_id": client_id, "redirect_uri": f"{url}/?auth_callback=1"})

    async with websockets.connect(url.replace("http", "ws", 1) + "/api/websocket") as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": tok["access_token"]}))
        if json.loads(await ws.recv())["type"] != "auth_ok":
            sys.exit("HA websocket auth failed")
        await ws.send(json.dumps({"id": 1, "type": "auth/long_lived_access_token", "client_name": "ambient-a2a", "lifespan": 3650}))
        res = json.loads(await ws.recv())
        if not res.get("success"):
            sys.exit(f"token creation failed: {res}")
        return res["result"]


if __name__ == "__main__":
    print(asyncio.run(main(sys.argv[1].rstrip("/"), sys.argv[2])))
