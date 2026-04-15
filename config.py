"""
RagSpyVHF configuration.
All values can be overridden via environment variables where noted.
"""
import os

# ---------------------------------------------------------------------------
# SDR Hardware
# ---------------------------------------------------------------------------
DONGLE_INDEX: int = int(os.environ.get("RAGSPY_DONGLE_INDEX", "0"))
DONGLE_GAIN: float = float(os.environ.get("RAGSPY_GAIN", "49.6"))  # High gain needed below 50 MHz

# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------
SCAN_INTEGRATION_SEC: float = 1.0   # rtl_power -i  (integration time per band pass)
SCAN_PAUSE_SEC: float = 1.0         # Dwell between full band rotations
PEAK_SNR_THRESHOLD_DB: float = 15.0 # Signal must be this many dB above noise floor
SIGNAL_TIMEOUT_SEC: int = 30        # Remove signal from active list if not seen
WATERFALL_MAX_ROWS: int = 200       # Per-band waterfall history depth

# ---------------------------------------------------------------------------
# Voice decoder
# ---------------------------------------------------------------------------
VOICE_SAMPLE_RATE: int = 48000
VOICE_PCM_CHUNK_BYTES: int = 4096
VOICE_TIMEOUT_SEC: int = 300        # Auto-stop after 5 min of listening

# ---------------------------------------------------------------------------
# Web server
# ---------------------------------------------------------------------------
HOST: str = os.environ.get("RAGSPY_HOST", "0.0.0.0")
PORT: int = int(os.environ.get("RAGSPY_PORT", "8080"))

# ---------------------------------------------------------------------------
# Frequency bands to scan (cycled in order)
# step_hz controls rtl_power bin size for that band
# rtl_fm_mode is the default demodulation mode when the user clicks to listen
# ---------------------------------------------------------------------------
SCAN_BANDS: list[dict] = [
    {
        "name": "cb_radio",
        "display": "CB Radio",
        "start_mhz": 26.96,
        "stop_mhz": 27.41,
        "step_hz": 10_000,
        "rtl_fm_mode": "am",
    },
    {
        "name": "amateur_10m",
        "display": "Amateur 10m",
        "start_mhz": 28.0,
        "stop_mhz": 29.7,
        "step_hz": 10_000,
        "rtl_fm_mode": "usb",
    },
    {
        "name": "land_mobile_vhf_low",
        "display": "Land Mobile / Public Safety VHF",
        "start_mhz": 29.7,
        "stop_mhz": 50.0,
        "step_hz": 25_000,
        "rtl_fm_mode": "nfm",
    },
    {
        "name": "amateur_6m",
        "display": "Amateur 6m",
        "start_mhz": 50.0,
        "stop_mhz": 54.0,
        "step_hz": 12_500,
        "rtl_fm_mode": "usb",
    },
    {
        "name": "vhf_low_utility",
        "display": "VHF Low / Utility",
        "start_mhz": 54.0,
        "stop_mhz": 76.0,
        "step_hz": 25_000,
        "rtl_fm_mode": "nfm",
    },
]
