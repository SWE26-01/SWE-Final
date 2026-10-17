"""Event Collector (WBS W8-4): A2A request/response and policy decision log.

Run: uvicorn collector.main:app --port 8200
"""

from fastapi import FastAPI

app = FastAPI(title="Event Collector")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


# TODO(W8-4): POST /events (SQLite), WebSocket stream to dashboard
