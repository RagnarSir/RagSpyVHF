/**
 * waterfall.js — Canvas-based spectrum waterfall display.
 * Uses ImageData for per-row pixel writes (fast enough on Pi-served browsers).
 */
window.WaterfallUI = (() => {
  const canvas = document.getElementById("waterfall-canvas");
  const ctx = canvas.getContext("2d");
  const axisEl = document.getElementById("waterfall-freq-axis");

  let offscreen = null;   // Offscreen ImageData buffer
  let _freqStart = 0;
  let _freqEnd = 1;

  function _resize() {
    canvas.width = canvas.offsetWidth || 900;
    canvas.height = 300;
    offscreen = ctx.createImageData(canvas.width, canvas.height);
    offscreen.data.fill(0);   // Black
  }

  window.addEventListener("resize", _resize);
  _resize();

  // ── Colour map: dBm → RGB (blue → cyan → green → yellow → red) ───
  function _dbToColor(db, minDb, maxDb) {
    const t = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
    let r, g, b;
    if (t < 0.25) {
      const s = t / 0.25;
      r = 0; g = Math.round(s * 255); b = 255;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      r = 0; g = 255; b = Math.round((1 - s) * 255);
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      r = Math.round(s * 255); g = 255; b = 0;
    } else {
      const s = (t - 0.75) / 0.25;
      r = 255; g = Math.round((1 - s) * 255); b = 0;
    }
    return [r, g, b];
  }

  // ── Push a new waterfall row ──────────────────────────────────────
  function pushRow(row) {
    if (!row || !row.power_values || row.power_values.length === 0) return;

    _freqStart = row.freq_start_mhz;
    _freqEnd   = row.freq_end_mhz;

    const W = canvas.width;
    const H = canvas.height;
    const powers = row.power_values;

    // Dynamic range: use 10th–95th percentile of this row
    const sorted = [...powers].sort((a, b) => a - b);
    const minDb  = sorted[Math.floor(sorted.length * 0.10)] - 5;
    const maxDb  = sorted[Math.floor(sorted.length * 0.95)] + 5;

    // Scroll existing image down by 1 row
    const data = offscreen.data;
    data.copyWithin(W * 4, 0, W * (H - 1) * 4);

    // Write new row at top
    for (let x = 0; x < W; x++) {
      const binIndex = Math.floor((x / W) * powers.length);
      const [r, g, b] = _dbToColor(powers[binIndex], minDb, maxDb);
      const idx = x * 4;
      data[idx]     = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }

    ctx.putImageData(offscreen, 0, 0);
    _updateAxis();
  }

  function _updateAxis() {
    const span = _freqEnd - _freqStart;
    const labels = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      labels.push((_freqStart + (span * i / steps)).toFixed(2) + " MHz");
    }
    axisEl.innerHTML = labels.map(l => `<span>${l}</span>`).join("");
  }

  function clear() {
    if (offscreen) offscreen.data.fill(0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Click on waterfall → tune to that frequency
  canvas.addEventListener("click", (evt) => {
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const ratio = x / rect.width;
    const freq_mhz = _freqStart + ratio * (_freqEnd - _freqStart);
    const freq_hz = Math.round(freq_mhz * 1_000_000);
    const band = (window.RagSpy.bands || []).find(
      b => freq_mhz >= b.start_mhz && freq_mhz <= b.stop_mhz
    );
    const mode = band ? band.rtl_fm_mode : "nfm";
    if (typeof window.AudioPlayer !== "undefined") {
      window.AudioPlayer.tune(freq_hz, mode, freq_mhz.toFixed(4) + " MHz");
    }
  });

  return { pushRow, clear };
})();
