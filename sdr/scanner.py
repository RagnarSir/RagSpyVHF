"""
ScannerService — drives rtl_power sweeps across the configured band groups,
detects signal peaks, and broadcasts waterfall + signal updates.
"""
import asyncio
import logging
import re
from collections import deque
from datetime import datetime, timezone
from typing import Optional

import config
from models.signal import SignalHit, WaterfallRow
from sdr.device_manager import DeviceManager, DeviceMode
from sdr.signal_classifier import SignalClassifier

log = logging.getLogger(__name__)

# rtl_power CSV line format:
#   date, time, hz_low, hz_high, hz_step, samples, dB, dB, ...
_CSV_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2}), (\d{2}:\d{2}:\d{2}), "
    r"(\d+), (\d+), ([\d.]+), (\d+), (.+)"
)


class ScannerService:
    def __init__(self, device_manager: DeviceManager):
        self._dm = device_manager
        self._classifier = SignalClassifier()
        self._running = False
        self._task: Optional[asyncio.Task] = None

        # freq_mhz → SignalHit
        self._signals: dict[float, SignalHit] = {}

        # band_name → deque of WaterfallRow
        self._waterfall: dict[str, deque] = {
            b["name"]: deque(maxlen=config.WATERFALL_MAX_ROWS)
            for b in config.SCAN_BANDS
        }

        self._listeners: list[asyncio.Queue] = []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._sweep_loop(), name="scanner-sweep")
        log.info("ScannerService started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("ScannerService stopped")

    # ------------------------------------------------------------------
    # Public data accessors
    # ------------------------------------------------------------------

    def get_active_signals(self) -> list[SignalHit]:
        now = datetime.now(timezone.utc)
        active = []
        stale_keys = []
        for key, sig in list(self._signals.items()):
            age = (now - sig.last_seen).total_seconds()
            if age < config.SIGNAL_TIMEOUT_SEC:
                sig.active = True
                active.append(sig)
            else:
                sig.active = False
                # Prune entries older than 2x the timeout to cap memory usage
                if age > config.SIGNAL_TIMEOUT_SEC * 2:
                    stale_keys.append(key)
        for key in stale_keys:
            del self._signals[key]
        return sorted(active, key=lambda s: s.freq_mhz)

    def get_waterfall_snapshot(self, band_name: str) -> list[WaterfallRow]:
        buf = self._waterfall.get(band_name, deque())
        return list(buf)

    # ------------------------------------------------------------------
    # Pub/sub
    # ------------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
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
    # Sweep loop
    # ------------------------------------------------------------------

    async def _sweep_loop(self):
        band_index = 0
        while self._running:
            band = config.SCAN_BANDS[band_index % len(config.SCAN_BANDS)]
            band_index += 1

            acquired = False
            try:
                acquired = await self._dm.acquire(DeviceMode.SCANNING, "scanner")
                if not acquired:
                    # Device is held by voice decoder — wait and retry
                    await asyncio.sleep(1.0)
                    band_index -= 1   # Retry the same band
                    continue

                await self._run_band_sweep(band)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.error("Sweep error on band %s: %s", band["name"], exc)
                await asyncio.sleep(2.0)
            finally:
                if acquired and self._dm.mode == DeviceMode.SCANNING:
                    await self._dm.release("scanner")

            await asyncio.sleep(config.SCAN_PAUSE_SEC / len(config.SCAN_BANDS))

    async def _run_band_sweep(self, band: dict):
        """Run one rtl_power integration pass over a single band."""
        start_hz = int(band["start_mhz"] * 1_000_000)
        stop_hz = int(band["stop_mhz"] * 1_000_000)
        step_hz = band["step_hz"]

        cmd = [
            "rtl_power",
            "-f", f"{start_hz}:{stop_hz}:{step_hz}",
            "-g", str(config.DONGLE_GAIN),
            "-i", str(config.SCAN_INTEGRATION_SEC),
            "-1",            # Exit after one sweep
            "-d", str(self._dm.dongle_index),
        ]

        log.debug("Running: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        rows: list[dict] = []
        try:
            async for raw_line in proc.stdout:
                if self._dm.preempt_requested:
                    proc.terminate()
                    break
                line = raw_line.decode(errors="ignore").strip()
                row = self._parse_line(line)
                if row:
                    rows.append(row)
        finally:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
            await proc.wait()

        if rows:
            self._process_sweep(band, rows)

    # ------------------------------------------------------------------
    # CSV parsing
    # ------------------------------------------------------------------

    def _parse_line(self, line: str) -> Optional[dict]:
        m = _CSV_RE.match(line)
        if not m:
            return None
        hz_low = int(m.group(3))
        hz_high = int(m.group(4))
        hz_step = float(m.group(5))
        power_str = m.group(7)
        try:
            powers = [float(x) for x in power_str.split(",")]
        except ValueError:
            return None
        return {
            "hz_low": hz_low,
            "hz_high": hz_high,
            "hz_step": hz_step,
            "powers": powers,
        }

    # ------------------------------------------------------------------
    # Peak detection & signal update
    # ------------------------------------------------------------------

    def _process_sweep(self, band: dict, rows: list[dict]):
        # Merge all rows into a single freq→power map
        freq_power: dict[float, float] = {}
        for row in rows:
            hz_low = row["hz_low"]
            hz_step = row["hz_step"]
            for i, pwr in enumerate(row["powers"]):
                freq_hz = hz_low + i * hz_step
                freq_mhz = freq_hz / 1_000_000
                freq_power[freq_mhz] = pwr

        if not freq_power:
            return

        freqs = sorted(freq_power.keys())
        powers = [freq_power[f] for f in freqs]

        # Noise floor = 25th percentile
        sorted_powers = sorted(powers)
        noise_floor = sorted_powers[len(sorted_powers) // 4]
        threshold = noise_floor + config.PEAK_SNR_THRESHOLD_DB

        # Build waterfall row
        wf_row = WaterfallRow(
            timestamp=datetime.now(timezone.utc),
            band_name=band["name"],
            freq_start_mhz=freqs[0],
            freq_end_mhz=freqs[-1],
            bin_size_hz=band["step_hz"],
            power_values=powers,
        )
        self._waterfall[band["name"]].append(wf_row)

        # Find peaks: contiguous bins above threshold
        peaks = self._find_peaks(freqs, powers, noise_floor, threshold)

        now = datetime.now(timezone.utc)
        for peak_freq, peak_power, bw_hz in peaks:
            snr = peak_power - noise_floor
            signal_type, display_name, fm_mode = self._classifier.classify(
                peak_freq, bw_hz, band
            )
            sig = SignalHit(
                freq_mhz=peak_freq,
                power_db=peak_power,
                noise_floor_db=noise_floor,
                snr_db=snr,
                signal_type=signal_type,
                display_name=display_name,
                rtl_fm_mode=fm_mode,
                bandwidth_est_hz=bw_hz,
                last_seen=now,
                active=True,
            )
            self._signals[round(peak_freq, 4)] = sig

        # Broadcast to WebSocket subscribers
        self._broadcast({
            "type": "scan_update",
            "band": band["name"],
            "signals": [s.model_dump(mode="json") for s in self.get_active_signals()],
            "waterfall_row": wf_row.model_dump(mode="json"),
        })

    def _find_peaks(
        self,
        freqs: list[float],
        powers: list[float],
        noise_floor: float,
        threshold: float,
    ) -> list[tuple[float, float, int]]:
        """
        Returns list of (centroid_freq_mhz, peak_power_db, bandwidth_hz).
        Merges contiguous above-threshold bins; drops peaks < 2 bins wide.

        Weights for centroid are relative to noise floor (always positive),
        because raw dBm values are negative and produce incorrect centroids.
        """
        peaks = []
        in_peak = False
        peak_bins: list[tuple[float, float]] = []

        def _emit(bins):
            if len(bins) < 2:
                return
            # Weight = SNR above noise floor (always > 0 since bins are above threshold)
            total_w = sum(p - noise_floor for _, p in bins)
            if total_w <= 0:
                centroid = sum(f for f, _ in bins) / len(bins)
            else:
                centroid = sum(f * (p - noise_floor) for f, p in bins) / total_w
            peak_pwr = max(p for _, p in bins)
            bw_hz = int((bins[-1][0] - bins[0][0]) * 1_000_000)
            bw_hz = max(bw_hz, 5_000)
            peaks.append((round(centroid, 4), peak_pwr, bw_hz))

        for freq, pwr in zip(freqs, powers):
            if pwr >= threshold:
                if not in_peak:
                    in_peak = True
                    peak_bins = []
                peak_bins.append((freq, pwr))
            else:
                if in_peak:
                    in_peak = False
                    _emit(peak_bins)

        # Handle peak reaching end of scan
        if in_peak:
            _emit(peak_bins)

        # Merge peaks within 25 kHz of each other
        merged = []
        for peak in peaks:
            if merged and abs(peak[0] - merged[-1][0]) < 0.025:
                prev = merged[-1]
                if peak[1] > prev[1]:
                    merged[-1] = peak
            else:
                merged.append(peak)

        return merged
