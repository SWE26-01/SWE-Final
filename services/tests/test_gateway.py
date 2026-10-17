from fastapi.testclient import TestClient

from gateway.main import app


def test_devices_have_single_owner():
    devices = TestClient(app).get("/devices").json()
    assert devices and all(d["owner"] for d in devices)
