from datetime import datetime, timezone
from fastapi import APIRouter, Request

import config
from models.signal import ScanResult

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.get("/signals", response_model=ScanResult)
async def get_signals(request: Request):
    scanner = request.app.state.scanner
    return ScanResult(
        timestamp=datetime.now(timezone.utc),
        signals=scanner.get_active_signals(),
        device_mode=request.app.state.device_manager.state.mode,
    )


@router.get("/waterfall")
async def get_waterfall(request: Request, band: str = "cb_radio"):
    scanner = request.app.state.scanner
    return scanner.get_waterfall_snapshot(band)


@router.post("/start")
async def start_scan(request: Request):
    await request.app.state.scanner.start()
    return {"status": "started"}


@router.post("/stop")
async def stop_scan(request: Request):
    await request.app.state.scanner.stop()
    return {"status": "stopped"}


@router.get("/bands")
async def get_bands():
    return config.SCAN_BANDS
