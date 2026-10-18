"""Fan-out of JSON messages to WebSocket clients."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket, status

Message = dict[str, Any]
Queue = asyncio.Queue[Message | None]


class Hub:
    """Fans messages out to WebSocket subscribers. A queue that fills up is emptied and gets
    `None`, which tells its socket to close; the client reconnects for a fresh snapshot."""

    def __init__(self, queue_size: int = 1000) -> None:
        self._queue_size = queue_size
        self._queues: set[Queue] = set()

    def subscribe(self) -> Queue:
        queue: Queue = asyncio.Queue(maxsize=self._queue_size)
        self._queues.add(queue)
        return queue

    def unsubscribe(self, queue: Queue) -> None:
        self._queues.discard(queue)

    def publish(self, message: Message) -> None:
        for queue in list(self._queues):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                self._queues.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)


async def push(websocket: WebSocket, queue: Queue) -> None:
    """Send queued messages until the client disconnects or falls too far behind."""
    left = asyncio.create_task(_until_disconnect(websocket))
    get: asyncio.Task[Message | None] | None = None
    try:
        while True:
            get = asyncio.create_task(queue.get())
            await asyncio.wait({get, left}, return_when=asyncio.FIRST_COMPLETED)
            if left.done():
                return
            message = get.result()
            if message is None:
                await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
                return
            await websocket.send_json(message)
    finally:
        left.cancel()
        if get is not None:
            get.cancel()


async def _until_disconnect(websocket: WebSocket) -> None:
    while (await websocket.receive())["type"] != "websocket.disconnect":
        pass  # client messages are ignored
