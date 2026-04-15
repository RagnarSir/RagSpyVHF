"""
VoiceDecoder — wraps rtl_fm and streams raw PCM audio to connected listeners.
"""
import asyncio
import logging
import uuid
from typing import Optional

import config
from sdr.device_manager import DeviceManager, DeviceMode

log = logging.getLogger(__name__)


class VoiceDecoder:
    def __init__(self, device_manager: DeviceManager):
        self._dm = device_manager
        self._process: Optional[asyncio.subprocess.Process] = None
        self._read_task: Optional[asyncio.Task] = None
        self._audio_queues: list[asyncio.Queue] = []
        self._session_id: Optional[str] = None
        self._current_freq_mhz: Optional[float] = None
        self._current_mode: Optional[str] = None
        self._active = False

    # ------------------------------------------------------------------
    # Public properties
    # ------------------------------------------------------------------

    @property
    def active(self) -> bool:
        return self._active

    @property
    def session_id(self) -> Optional[str]:
        return self._session_id

    @property
    def current_freq_mhz(self) -> Optional[float]:
        return self._current_freq_mhz

    @property
    def current_mode(self) -> Optional[str]:
        return self._current_mode

    # ------------------------------------------------------------------
    # Tune / stop
    # ------------------------------------------------------------------

    async def tune(self, freq_hz: int, mode: str = "nfm") -> str:
        """Start rtl_fm tuned to freq_hz. Returns session_id."""
        # Stop any existing session first
        if self._active:
            await self.stop_and_release()

        acquired = await self._dm.acquire(DeviceMode.LISTENING, "voice")
        if not acquired:
            raise RuntimeError("SDR device is busy")

        self._session_id = str(uuid.uuid4())[:8]
        self._current_freq_mhz = freq_hz / 1_000_000
        self._current_mode = mode
        self._active = True

        # rtl_fm uses "fm" for narrowband FM; "nfm" is not a valid -M value
        rtl_mode = "fm" if mode == "nfm" else mode

        cmd = [
            "rtl_fm",
            "-f", str(freq_hz),
            "-M", rtl_mode,
            "-s", "200000",          # Input sample rate
            "-r", str(config.VOICE_SAMPLE_RATE),  # Output PCM rate
            "-g", str(config.DONGLE_GAIN),
            "-d", str(self._dm.dongle_index),
        ]

        log.info("Starting rtl_fm: %s Hz mode=%s", freq_hz, mode)

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        self._read_task = asyncio.create_task(
            self._read_audio_loop(), name=f"voice-audio-{self._session_id}"
        )

        # Auto-stop after timeout
        asyncio.create_task(self._auto_timeout(), name="voice-timeout")

        return self._session_id

    async def stop_and_release(self):
        """Stop rtl_fm and release the device."""
        if not self._active:
            return

        self._active = False
        log.info("Stopping voice decoder")

        if self._process:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=2.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    self._process.kill()
                except ProcessLookupError:
                    pass
            self._process = None

        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
            self._read_task = None

        # Notify audio consumers that stream ended, then clear the list
        for q in self._audio_queues:
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass
        self._audio_queues.clear()

        self._session_id = None
        self._current_freq_mhz = None
        self._current_mode = None

        await self._dm.release("voice")

    # ------------------------------------------------------------------
    # Audio streaming
    # ------------------------------------------------------------------

    def subscribe_audio(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=128)
        self._audio_queues.append(q)
        return q

    def unsubscribe_audio(self, q: asyncio.Queue):
        self._audio_queues = [x for x in self._audio_queues if x is not q]

    async def _read_audio_loop(self):
        """Reads PCM chunks from rtl_fm stdout and fans them out to all queues."""
        try:
            while self._active and self._process:
                chunk = await self._process.stdout.read(config.VOICE_PCM_CHUNK_BYTES)
                if not chunk:
                    break
                for q in list(self._audio_queues):
                    try:
                        q.put_nowait(chunk)
                    except asyncio.QueueFull:
                        pass  # Slow consumer — drop chunk
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.error("Audio read error: %s", exc)
        finally:
            log.info("Audio read loop ended")

    async def _auto_timeout(self):
        """Automatically stop voice after VOICE_TIMEOUT_SEC seconds."""
        await asyncio.sleep(config.VOICE_TIMEOUT_SEC)
        if self._active:
            log.info("Voice decoder auto-timeout after %ds", config.VOICE_TIMEOUT_SEC)
            await self.stop_and_release()
