"""
DeviceManager — serialises access to the single RTL-SDR dongle.

State machine:  IDLE → SCANNING → LISTENING
                        ↑_____________↓  (VOICE ends → scanner resumes)
"""
import asyncio
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from models.device import DeviceState

log = logging.getLogger(__name__)


class DeviceMode(str, Enum):
    IDLE = "IDLE"
    SCANNING = "SCANNING"
    LISTENING = "LISTENING"


class DeviceManager:
    def __init__(self, dongle_index: int = 0):
        self.dongle_index = dongle_index
        self._mode = DeviceMode.IDLE
        self._locked_by: Optional[str] = None
        self._since = datetime.now(timezone.utc)
        self._lock = asyncio.Lock()
        self._preempt_event = asyncio.Event()
        self._resume_event = asyncio.Event()
        self._listeners: list[asyncio.Queue] = []

    # ------------------------------------------------------------------
    # Public state
    # ------------------------------------------------------------------

    @property
    def state(self) -> DeviceState:
        return DeviceState(
            mode=self._mode.value,
            locked_by=self._locked_by,
            since=self._since,
        )

    @property
    def mode(self) -> DeviceMode:
        return self._mode

    # ------------------------------------------------------------------
    # Acquisition
    # ------------------------------------------------------------------

    async def acquire(self, mode: DeviceMode, requester: str) -> bool:
        """
        Try to acquire the device for the given mode.
        If SCANNING, signal the scanner to yield and wait up to 3s.
        Returns True on success, False if device is busy with LISTENING.
        """
        async with self._lock:
            if self._mode == DeviceMode.IDLE:
                self._set_mode(mode, requester)
                return True

            if self._mode == DeviceMode.SCANNING and mode == DeviceMode.LISTENING:
                # Signal scanner to pause; it checks this event each integration interval
                log.info("Voice requesting device — signalling scanner to yield")
                self._preempt_event.set()
                self._resume_event.clear()

            elif self._mode == DeviceMode.LISTENING:
                log.warning("Device already in use for LISTENING — rejecting %s", requester)
                return False

        # Wait outside the lock for scanner to release (up to 3s)
        if self._mode == DeviceMode.SCANNING:
            try:
                await asyncio.wait_for(self._resume_event.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                log.warning("Scanner did not yield in time — forcing acquisition")

        async with self._lock:
            self._set_mode(mode, requester)
            return True

    async def release(self, requester: str):
        """Release the device. Called by scanner or voice decoder when done."""
        async with self._lock:
            if self._locked_by != requester:
                log.warning("release() called by %s but locked by %s", requester, self._locked_by)
            log.info("%s releasing device", requester)
            self._set_mode(DeviceMode.IDLE, None)
            self._preempt_event.clear()
            self._resume_event.set()   # Unblock any waiters (e.g. scanner resuming)

    # ------------------------------------------------------------------
    # Scanner preemption helpers
    # ------------------------------------------------------------------

    @property
    def preempt_requested(self) -> bool:
        """Scanner checks this to know it should yield the device."""
        return self._preempt_event.is_set()

    def scanner_released(self):
        """Called by scanner after it has stopped rtl_power and is yielding."""
        self._resume_event.set()
        self._preempt_event.clear()

    async def wait_for_resume(self):
        """Scanner calls this to block until it should resume scanning."""
        self._resume_event.clear()
        await self._resume_event.wait()

    # ------------------------------------------------------------------
    # Pub/sub for WebSocket state broadcasts
    # ------------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=32)
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._listeners = [l for l in self._listeners if l is not q]

    def _broadcast(self, event: dict):
        for q in self._listeners:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # Slow consumer — drop event

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    async def shutdown(self):
        self._resume_event.set()   # Unblock any waiting coroutines
        self._preempt_event.set()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _set_mode(self, mode: DeviceMode, locked_by: Optional[str]):
        self._mode = mode
        self._locked_by = locked_by
        self._since = datetime.now(timezone.utc)
        log.info("Device mode: %s (locked_by=%s)", mode.value, locked_by)
        self._broadcast({
            "type": "device_state",
            "mode": mode.value,
            "locked_by": locked_by,
            "since": self._since,
        })
