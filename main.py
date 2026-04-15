"""
RagSpyVHF — 26–76 MHz SDR signal scanner and listener for Raspberry Pi.
"""
import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import config
from api.routes_scan import router as scan_router
from api.routes_voice import router as voice_router
from api.routes_ws import router as ws_router
from sdr.device_manager import DeviceManager
from sdr.scanner import ScannerService
from sdr.voice_decoder import VoiceDecoder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("/tmp/ragspyvhf.log"),
    ],
)
log = logging.getLogger("ragspyvhf")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("RagSpyVHF starting up")

    device_manager = DeviceManager(dongle_index=config.DONGLE_INDEX)
    scanner = ScannerService(device_manager)
    voice = VoiceDecoder(device_manager)

    app.state.device_manager = device_manager
    app.state.scanner = scanner
    app.state.voice = voice

    await scanner.start()
    log.info("Scanner started — scanning 26–76 MHz")

    yield

    # Uvicorn handles SIGTERM/SIGINT and triggers this cleanup via lifespan
    log.info("RagSpyVHF shutting down")
    await _shutdown(scanner, voice, device_manager)


async def _shutdown(scanner: "ScannerService", voice: "VoiceDecoder", dm: "DeviceManager"):
    await scanner.stop()
    await voice.stop_and_release()
    await dm.shutdown()


app = FastAPI(title="RagSpyVHF", lifespan=lifespan)

app.include_router(scan_router)
app.include_router(voice_router)
app.include_router(ws_router)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/api/status")
async def status():
    return {
        "name": "RagSpyVHF",
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/")
async def index():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        log_level="info",
    )
