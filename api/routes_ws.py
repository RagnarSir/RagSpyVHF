import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

router = APIRouter(tags=["websocket"])

KEEPALIVE_INTERVAL = 20.0   # Seconds between pings when no events arrive


def _default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Not serializable: {type(obj)}")


def _dumps(data: dict) -> str:
    return json.dumps(data, default=_default)


async def _ws_event_loop(websocket: WebSocket, queue: asyncio.Queue):
    """
    Pumps events from queue to the WebSocket.
    Sends a keepalive ping if no event arrives within KEEPALIVE_INTERVAL seconds
    so the connection doesn't time out while the scanner is paused.
    """
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_INTERVAL)
            await websocket.send_text(_dumps(event))
        except asyncio.TimeoutError:
            # Send a lightweight ping to keep the connection alive
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.send_text('{"type":"ping"}')
        except WebSocketDisconnect:
            break
        except Exception:
            break


@router.websocket("/ws/scan")
async def ws_scan(websocket: WebSocket):
    await websocket.accept()
    scanner = websocket.app.state.scanner
    queue = scanner.subscribe()
    try:
        await _ws_event_loop(websocket, queue)
    finally:
        scanner.unsubscribe(queue)


@router.websocket("/ws/device")
async def ws_device(websocket: WebSocket):
    await websocket.accept()
    dm = websocket.app.state.device_manager
    queue = dm.subscribe()
    try:
        await _ws_event_loop(websocket, queue)
    finally:
        dm.unsubscribe(queue)
