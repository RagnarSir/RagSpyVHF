import asyncio
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse

import config
from models.device import TuneRequest, TuneResponse

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/tune", response_model=TuneResponse)
async def tune(request: Request, body: TuneRequest):
    voice = request.app.state.voice
    try:
        session_id = await voice.tune(body.freq_hz, body.mode)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    freq_mhz = body.freq_hz / 1_000_000
    return TuneResponse(
        session_id=session_id,
        freq_mhz=freq_mhz,
        mode=body.mode,
        stream_url=f"/api/voice/stream/{session_id}",
    )


@router.post("/stop")
async def stop_voice(request: Request, session_id: str):
    await request.app.state.voice.stop_and_release()
    return {"status": "stopped"}


@router.get("/status")
async def voice_status(request: Request):
    voice = request.app.state.voice
    return {
        "active": voice.active,
        "freq_mhz": voice.current_freq_mhz,
        "mode": voice.current_mode,
    }


@router.get("/stream/{session_id}")
async def audio_stream(request: Request, session_id: str):
    voice = request.app.state.voice
    if not voice.active or voice.session_id != session_id:
        raise HTTPException(status_code=404, detail="Session not found or inactive")

    queue = voice.subscribe_audio()

    async def pcm_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=2.0)
                    if chunk is None:
                        break
                    yield chunk
                except asyncio.TimeoutError:
                    continue
        finally:
            voice.unsubscribe_audio(queue)

    return StreamingResponse(
        pcm_generator(),
        media_type="audio/x-raw;rate=48000;format=S16LE;channels=1",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
