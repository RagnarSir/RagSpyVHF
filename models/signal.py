from datetime import datetime
from pydantic import BaseModel


class SignalHit(BaseModel):
    freq_mhz: float
    power_db: float
    noise_floor_db: float
    snr_db: float
    signal_type: str        # e.g. "cb_radio", "amateur_10m", "land_mobile_vhf_low"
    display_name: str       # Human-readable e.g. "CB Ch 19 (27.185 MHz)"
    rtl_fm_mode: str        # "am", "nfm", "usb", "lsb"
    bandwidth_est_hz: int
    last_seen: datetime
    active: bool            # True if seen within SIGNAL_TIMEOUT_SEC


class ScanResult(BaseModel):
    timestamp: datetime
    signals: list[SignalHit]
    device_mode: str


class WaterfallRow(BaseModel):
    timestamp: datetime
    band_name: str
    freq_start_mhz: float
    freq_end_mhz: float
    bin_size_hz: int
    power_values: list[float]   # dBm per frequency bin
