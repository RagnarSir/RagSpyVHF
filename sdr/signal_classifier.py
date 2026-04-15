"""
SignalClassifier — maps a detected frequency to a signal type, display name,
and recommended rtl_fm demodulation mode.
"""
import json
from pathlib import Path


_CB_CHANNELS: dict[float, str] = {}


def _load_cb_channels():
    path = Path(__file__).parent.parent / "data" / "band_allocations.json"
    try:
        allocations = json.loads(path.read_text())
        for band in allocations:
            if band["name"] == "cb_radio":
                for freq_str, label in band.get("channels", {}).items():
                    _CB_CHANNELS[round(float(freq_str), 3)] = label
    except Exception:
        pass


_load_cb_channels()


class SignalClassifier:
    def classify(
        self,
        freq_mhz: float,
        bandwidth_hz: int,
        band: dict,
    ) -> tuple[str, str, str]:
        """
        Returns (signal_type, display_name, rtl_fm_mode).
        Falls back to band defaults for unknown signals.
        """
        band_name = band["name"]
        default_mode = band.get("rtl_fm_mode", "nfm")

        # CB radio — look up channel label
        if band_name == "cb_radio":
            rounded = round(freq_mhz, 3)
            # Find nearest CB channel within 5 kHz
            best = None
            best_dist = float("inf")
            for ch_freq, ch_label in _CB_CHANNELS.items():
                dist = abs(rounded - ch_freq)
                if dist < best_dist:
                    best_dist = dist
                    best = (ch_freq, ch_label)
            if best and best_dist < 0.005:
                label = f"{best[1]} ({best[0]:.3f} MHz)"
            else:
                label = f"CB {freq_mhz:.3f} MHz"
            return "cb_radio", label, "am"

        # Amateur 10m — distinguish SSB from FM simplex
        if band_name == "amateur_10m":
            if freq_mhz >= 29.5:
                mode = "nfm"   # 29.6 MHz FM simplex
            else:
                mode = "usb"
            return "amateur_10m", f"Amateur 10m {freq_mhz:.3f} MHz", mode

        # Amateur 6m — distinguish SSB from FM
        if band_name == "amateur_6m":
            if freq_mhz < 50.3:
                mode = "usb"
            else:
                mode = "nfm"
            return "amateur_6m", f"Amateur 6m {freq_mhz:.3f} MHz", mode

        # Land mobile VHF low
        if band_name == "land_mobile_vhf_low":
            return "land_mobile", f"Land Mobile {freq_mhz:.4f} MHz", "nfm"

        # VHF low / utility
        if band_name == "vhf_low_utility":
            return "vhf_utility", f"VHF {freq_mhz:.4f} MHz", "nfm"

        # Fallback
        return band_name, f"{freq_mhz:.4f} MHz", default_mode
