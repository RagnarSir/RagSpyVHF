import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])


def _default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Not serializable: {type(obj)}")


def _dumps(data: dict) -> str:
    return json.dumps(data, default=_default)


@router.websocket("/ws/scan")
async def ws_scan(websocket: WebSocket):
    await websocket.accept()
    scanner = websocket.app.state.scanner
    queue = scanner.subscribe()
    try:
        while True:
            event = await queue.get()
            await websocket.send_text(_dumps(event))
    except WebSocketDisconnect:
        pass
    finally:
        scanner.unsubscribe(queue)


@router.websocket("/ws/device")
async def ws_device(websocket: WebSocket):
    await websocket.accept()
    dm = websocket.app.state.device_manager
    queue = dm.subscribe()
    try:
        while True:
            event = await queue.get()
            await websocket.send_text(_dumps(event))
    except WebSocketDisconnect:
        pass
    finally:
        dm.unsubscribe(queue)
