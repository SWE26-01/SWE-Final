"""Logging proxy between OpenClaw and model backends (OpenAI chat-completions).

  python training/proxy.py            # listens on 127.0.0.1:8300, logs to ~/.ambient-a2a/training/calls.jsonl

Model ids that OpenClaw asks for (provider `lab`, see lab-models.json5) map to backends:
  haiku       -> OpenRouter anthropic/claude-haiku-5.5
  sonnet      -> OpenRouter anthropic/claude-sonnet-5-5
  exaone      -> local llama-server :8090 (base EXAONE 4.0 1.2B)
  exaone-dpo  -> local llama-server :8091 (SFT + DPO)
  exaone-sft  -> local llama-server :8092 (SFT only)
Every call is appended as {ts, tag, model, request, response, usage}; response is the reassembled
assistant message (content + tool_calls) even when the client streamed.
Set the tag (which scenario is running) with:  curl -X POST 127.0.0.1:8300/tag -d 'scenario-id'
"""

import argparse
import json
import os
import time
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

BACKENDS = {
    "haiku": ("https://openrouter.ai/api/v1", "anthropic/claude-haiku-5.5", "OPENROUTER_API_KEY"),
    "sonnet": ("https://openrouter.ai/api/v1", "anthropic/claude-sonnet-5-5", "OPENROUTER_API_KEY"),
    "exaone": ("http://127.0.0.1:8090/v1", "exaone", None),
    "exaone-dpo": ("http://127.0.0.1:8091/v1", "exaone", None),
    "exaone-sft": ("http://127.0.0.1:8092/v1", "exaone", None),
}
state = {"tag": "", "log": str(Path.home() / ".ambient-a2a/training/calls.jsonl")}
client = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10))


def log(model, req, msg, usage):
    with open(state["log"], "a") as f:
        f.write(json.dumps({"ts": time.time(), "tag": state["tag"], "model": model, "request": req,
                            "response": msg, "usage": usage}, ensure_ascii=False) + "\n")


def merge_delta(msg, delta):
    if delta.get("content"):
        msg["content"] = (msg.get("content") or "") + delta["content"]
    for tc in delta.get("tool_calls") or []:
        calls = msg.setdefault("tool_calls", [])
        i = tc.get("index", len(calls))
        while len(calls) <= i:
            calls.append({"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
        c = calls[i]
        c["id"] = tc.get("id") or c["id"]
        fn = tc.get("function") or {}
        c["function"]["name"] += fn.get("name") or ""
        c["function"]["arguments"] += fn.get("arguments") or ""


async def chat(request: Request):
    req = await request.json()
    alias = req.get("model", "").split("/")[-1]
    if alias not in BACKENDS:
        return JSONResponse({"error": {"message": f"unknown model {alias}"}}, status_code=400)
    base, real, key_env = BACKENDS[alias]
    body = {**req, "model": real}
    headers = {"content-type": "application/json"}
    if key_env:
        headers["authorization"] = f"Bearer {os.environ[key_env]}"
    if not req.get("stream"):
        r = await client.post(f"{base}/chat/completions", json=body, headers=headers)
        data = r.json()
        if r.status_code == 200 and data.get("choices"):
            log(alias, req, data["choices"][0]["message"], data.get("usage"))
        return JSONResponse(data, status_code=r.status_code)

    upstream = await client.send(client.build_request("POST", f"{base}/chat/completions", json=body, headers=headers), stream=True)

    async def relay():
        msg, usage, buf = {"role": "assistant", "content": None}, None, ""
        try:
            async for chunk in upstream.aiter_text():
                yield chunk
                buf += chunk
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    if not line.startswith("data:") or line.strip() == "data: [DONE]":
                        continue
                    try:
                        ev = json.loads(line[5:])
                    except json.JSONDecodeError:
                        continue
                    usage = ev.get("usage") or usage
                    for ch in ev.get("choices") or []:
                        merge_delta(msg, ch.get("delta") or {})
        finally:
            await upstream.aclose()
            if upstream.status_code == 200:
                log(alias, req, msg, usage)

    return StreamingResponse(relay(), status_code=upstream.status_code, media_type="text/event-stream")


async def models(_):
    return JSONResponse({"object": "list", "data": [{"id": k, "object": "model"} for k in BACKENDS]})


async def tag(request: Request):
    state["tag"] = (await request.body()).decode().strip()
    return Response(state["tag"])


app = Starlette(routes=[Route("/v1/chat/completions", chat, methods=["POST"]), Route("/v1/models", models),
                        Route("/tag", tag, methods=["POST"])])

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=state["log"])
    ap.add_argument("--port", type=int, default=8300)
    a = ap.parse_args()
    state["log"] = a.log
    Path(a.log).parent.mkdir(parents=True, exist_ok=True)
    uvicorn.run(app, host="127.0.0.1", port=a.port, log_level="warning")
