"""
DeviceManager — serialises access to the single RTL-SDR dongle.

State machine:  IDLE → SCANNING → LISTENING
                        ↑_____________↓  (VOICE ends → scanner retries)

Acquisition rules:
  - SCANNING: granted only when IDLE; returns False if LISTENING (scanner retries)
  - LISTENING: signals preemption, waits up to 3s for device to become IDLE, then acquires
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
        self._idle_event = asyncio.Event()
        self._idle_event.set()   # Starts IDLE
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

        SCANNING: granted if IDLE, rejected (False) if LISTENING.
        LISTENING: signals preemption, waits up to 3s for IDLE, then acquires.
        """
        if mode == DeviceMode.LISTENING:
            # Tell the scanner to stop its current sweep
            self._preempt_event.set()
            try:
                await asyncio.wait_for(self._idle_event.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                log.warning("Device did not become IDLE in 3s — forcing acquisition")

        async with self._lock:
            if self._mode == DeviceMode.LISTENING and mode == DeviceMode.SCANNING:
                # Don't let the scanner preempt an active voice session
                return False
            self._idle_event.clear()
            self._set_mode(mode, requester)
            return True

    async def release(self, requester: str):
        """Release the device. Sets mode to IDLE and unblocks any waiters."""
        async with self._lock:
            if self._locked_by != requester:
                log.warning("release() called by %s but locked_by=%s", requester, self._locked_by)
            log.info("%s releasing device", requester)
            self._preempt_event.clear()
            self._set_mode(DeviceMode.IDLE, None)
            self._idle_event.set()

    # ------------------------------------------------------------------
    # Scanner preemption helper
    # ------------------------------------------------------------------

    @property
    def preempt_requested(self) -> bool:
        """Scanner checks this to know it should abort the current sweep."""
        return self._preempt_event.is_set()

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
                pass

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    async def shutdown(self):
        self._preempt_event.set()
        self._idle_event.set()   # Unblock any waiters

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
