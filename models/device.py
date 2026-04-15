from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class DeviceState(BaseModel):
    mode: str                           # "IDLE", "SCANNING", "LISTENING"
    current_freq_mhz: Optional[float] = None
    current_band: Optional[str] = None  # Band name being scanned
    locked_by: Optional[str] = None     # "scanner" or "voice"
    since: datetime


class TuneRequest(BaseModel):
    freq_hz: int
    mode: str = "nfm"   # am, nfm, fm, wbfm, usb, lsb


class TuneResponse(BaseModel):
    session_id: str
    freq_mhz: float
    mode: str
    stream_url: str
