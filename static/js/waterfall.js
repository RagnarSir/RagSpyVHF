/**
 * waterfall.js — ruler, spectrum line graph, and scrolling waterfall heatmap.
 *
 * Three stacked canvases share a single overlay <div> for mouse events.
 * All state (zoom, pan, palette, tuning overlay) lives in this module.
 *
 * Zoom/pan model:
 *   view.panFrac = centre of visible window as a fraction [0,1] of the full band.
 *   Visible window = 1/zoom fraction of the full band, centred on panFrac.
 *   All canvas X → frequency math goes through xToFreq() / freqToX().
 */
window.WaterfallUI = (() => {

  // ── Canvas handles ─────────────────────────────────────────────
  const rulerC  = document.getElementById("ruler-canvas");
  const specC   = document.getElementById("spectrum-canvas");
  const wfC     = document.getElementById("waterfall-canvas");
  const overlay = document.getElementById("canvas-overlay");

  const rulerCtx = rulerC.getContext("2d");
  const specCtx  = specC.getContext("2d");
  const wfCtx    = wfC.getContext("2d");

  // ── View state ─────────────────────────────────────────────────
  const view = { zoom: 1, panFrac: 0.5 };
  let currentPalette = "heat";

  // Full band extent — updated on setBandRange() or from incoming rows
  let bandStart = 26.0;
  let bandEnd   = 76.0;

  // ── Spectrum data ──────────────────────────────────────────────
  let latestPowers = [];        // raw dBm array from most recent row
  let peakHold     = [];        // same size, decays 0.5 dB per row
  let noiseFloor   = -100;      // running EMA of 10th-pct power
  let displayMin   = -110;      // dBm → colour 0  (auto-scales with damping)
  let displayMax   = -50;       // dBm → colour 1

  const PEAK_DECAY = 0.5;       // dB per incoming row

  // ── Waterfall row history (raw power arrays, not pixel-resolution) ─
  const MAX_ROWS = 300;
  const rowHistory = [];        // circular array of Float32Array
  let rowHead = 0;
  let lastWfImg = null;         // cached ImageData for cursor-only redraws

  // ── Tuning overlay ─────────────────────────────────────────────
  let tuningOverlay = null;     // null | { freq_mhz, bandwidth_hz }

  // ── Cursor ─────────────────────────────────────────────────────
  let cursorX = null;           // canvas-space X, null when off-canvas

  // ── Drag/pan ───────────────────────────────────────────────────
  let dragStartX      = null;
  let dragStartPanFrac = null;

  // ──────────────────────────────────────────────────────────────
  // Zoom / pan math
  // ──────────────────────────────────────────────────────────────

  function visibleRange() {
    const span     = bandEnd - bandStart;
    const halfWin  = span / (2 * view.zoom);
    let lo = bandStart + view.panFrac * span - halfWin;
    let hi = lo + span / view.zoom;
    if (lo < bandStart) { lo = bandStart; hi = lo + span / view.zoom; }
    if (hi > bandEnd)   { hi = bandEnd;   lo = hi - span / view.zoom; }
    return { lo, hi };
  }

  function xToFreq(x, W) {
    const { lo, hi } = visibleRange();
    return lo + (x / W) * (hi - lo);
  }

  function freqToX(freqMhz, W) {
    const { lo, hi } = visibleRange();
    return ((freqMhz - lo) / (hi - lo)) * W;
  }

  function freqToBin(freqMhz, numBins) {
    const span = bandEnd - bandStart;
    if (span === 0) return 0;
    const ratio = (freqMhz - bandStart) / span;
    return Math.max(0, Math.min(numBins - 1, Math.round(ratio * (numBins - 1))));
  }

  // ──────────────────────────────────────────────────────────────
  // Palette functions
  // ──────────────────────────────────────────────────────────────

  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if      (h < 60)  { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  const PALETTES = {
    heat(t) {
      if (t < 0.25) { const s = t / 0.25;       return [0,   Math.round(s*255), 255]; }
      if (t < 0.5)  { const s = (t-0.25)/0.25;  return [0,   255, Math.round((1-s)*255)]; }
      if (t < 0.75) { const s = (t-0.5)/0.25;   return [Math.round(s*255), 255, 0]; }
      {              const s = (t-0.75)/0.25;    return [255, Math.round((1-s)*255), 0]; }
    },
    grey(t) { const v = Math.round(t * 255); return [v, v, v]; },
    rainbow(t) { return hsvToRgb((1 - t) * 240, 1, 0.95); },
  };

  function palette(db) {
    const t = Math.max(0, Math.min(1, (db - displayMin) / (displayMax - displayMin)));
    return PALETTES[currentPalette](t);
  }

  // ──────────────────────────────────────────────────────────────
  // Canvas resize
  // ──────────────────────────────────────────────────────────────

  function _resize() {
    const W = wfC.offsetWidth || 900;
    [rulerC, specC, wfC].forEach(c => { c.width = W; });
    lastWfImg = null;
    _redrawAll();
  }

  const ro = new ResizeObserver(() => _resize());
  ro.observe(document.getElementById("display-column"));

  // ──────────────────────────────────────────────────────────────
  // Ruler
  // ──────────────────────────────────────────────────────────────

  function _drawRuler() {
    const W = rulerC.width, H = rulerC.height;
    const { lo, hi } = visibleRange();
    const span = hi - lo;

    rulerCtx.fillStyle = "#090d12";
    rulerCtx.fillRect(0, 0, W, H);

    // Choose a nice tick step: aim for ~70px between major ticks
    const rawStep = span / (W / 70);
    const niceSteps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25];
    const step = niceSteps.find(s => s >= rawStep) || 25;
    const decimals = step < 0.1 ? 3 : step < 1 ? 2 : step < 10 ? 1 : 0;

    rulerCtx.fillStyle = "#8b949e";
    rulerCtx.font = "10px monospace";
    rulerCtx.textAlign = "center";
    rulerCtx.textBaseline = "alphabetic";

    const firstTick = Math.ceil(lo / step) * step;
    for (let i = 0; ; i++) {
      const f = Math.round((firstTick + i * step) * 1e6) / 1e6;
      if (f > hi) break;
      const x = Math.round(freqToX(f, W));
      rulerCtx.fillRect(x, H - 7, 1, 7);
      rulerCtx.fillText(f.toFixed(decimals), x, H - 10);
    }

    // Current cursor tick
    if (cursorX !== null) {
      rulerCtx.fillStyle = "rgba(255,255,255,0.8)";
      rulerCtx.fillRect(Math.round(cursorX), H - 9, 1, 9);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Spectrum line graph
  // ──────────────────────────────────────────────────────────────

  function _drawSpectrum() {
    const W = specC.width, H = specC.height;
    if (!W) return;
    const { lo, hi } = visibleRange();

    specCtx.fillStyle = "#090d12";
    specCtx.fillRect(0, 0, W, H);

    if (!latestPowers.length) return;

    const nBins = latestPowers.length;

    function dbToY(db) {
      return H - Math.max(0, Math.min(H, ((db - displayMin) / (displayMax - displayMin)) * H));
    }

    // ── Peak hold (behind fill) ─────────────────────────────────
    if (peakHold.length === nBins) {
      specCtx.beginPath();
      let started = false;
      for (let x = 0; x < W; x++) {
        const bin = freqToBin(lo + (x / W) * (hi - lo), nBins);
        const y = dbToY(peakHold[bin]);
        started ? specCtx.lineTo(x, y) : specCtx.moveTo(x, y);
        started = true;
      }
      specCtx.strokeStyle = "rgba(255, 180, 0, 0.45)";
      specCtx.lineWidth = 1;
      specCtx.stroke();
    }

    // ── Spectrum fill + line ────────────────────────────────────
    specCtx.beginPath();
    specCtx.moveTo(0, H);
    for (let x = 0; x < W; x++) {
      const bin = freqToBin(lo + (x / W) * (hi - lo), nBins);
      specCtx.lineTo(x, dbToY(latestPowers[bin]));
    }
    specCtx.lineTo(W, H);
    specCtx.closePath();
    specCtx.fillStyle = "rgba(88, 166, 255, 0.18)";
    specCtx.fill();

    specCtx.beginPath();
    for (let x = 0; x < W; x++) {
      const bin = freqToBin(lo + (x / W) * (hi - lo), nBins);
      x === 0 ? specCtx.moveTo(x, dbToY(latestPowers[bin]))
              : specCtx.lineTo(x, dbToY(latestPowers[bin]));
    }
    specCtx.strokeStyle = "#58a6ff";
    specCtx.lineWidth = 1.5;
    specCtx.stroke();

    // ── Noise floor dashed line ─────────────────────────────────
    const nfY = dbToY(noiseFloor);
    specCtx.setLineDash([4, 4]);
    specCtx.strokeStyle = "rgba(63, 185, 80, 0.55)";
    specCtx.lineWidth = 1;
    specCtx.beginPath();
    specCtx.moveTo(0, nfY);
    specCtx.lineTo(W, nfY);
    specCtx.stroke();
    specCtx.setLineDash([]);

    // ── Tuning overlay ──────────────────────────────────────────
    if (tuningOverlay) _drawOverlay(specCtx, W, H);

    // ── Cursor line ─────────────────────────────────────────────
    if (cursorX !== null) {
      specCtx.strokeStyle = "rgba(255,255,255,0.55)";
      specCtx.lineWidth = 1;
      specCtx.beginPath();
      specCtx.moveTo(Math.round(cursorX), 0);
      specCtx.lineTo(Math.round(cursorX), H);
      specCtx.stroke();
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Waterfall heatmap
  // ──────────────────────────────────────────────────────────────

  function _drawWaterfall() {
    const W = wfC.width, H = wfC.height;
    if (!W) return;

    const { lo, hi } = visibleRange();
    const imgData = wfCtx.createImageData(W, H);
    const data = imgData.data;
    const nRows = Math.min(rowHistory.filter(Boolean).length, H);

    for (let y = 0; y < nRows; y++) {
      const histIdx = (rowHead - 1 - y + MAX_ROWS) % MAX_ROWS;
      const row = rowHistory[histIdx];
      if (!row) continue;
      const nBins = row.length;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const bin = freqToBin(lo + (x / W) * (hi - lo), nBins);
        const [r, g, b] = palette(row[bin]);
        const px = base + x * 4;
        data[px]     = r;
        data[px + 1] = g;
        data[px + 2] = b;
        data[px + 3] = 255;
      }
    }

    wfCtx.putImageData(imgData, 0, 0);
    lastWfImg = imgData;

    _drawWaterfallOverlays();
  }

  /** Draw just the cursor + tuning overlay without rebuilding the pixel buffer. */
  function _redrawWaterfallCursor() {
    const W = wfC.width, H = wfC.height;
    if (lastWfImg) wfCtx.putImageData(lastWfImg, 0, 0);
    _drawWaterfallOverlays();
  }

  function _drawWaterfallOverlays() {
    const W = wfC.width, H = wfC.height;
    if (tuningOverlay) _drawOverlay(wfCtx, W, H);
    if (cursorX !== null) {
      wfCtx.strokeStyle = "rgba(255,255,255,0.35)";
      wfCtx.lineWidth = 1;
      wfCtx.beginPath();
      wfCtx.moveTo(Math.round(cursorX), 0);
      wfCtx.lineTo(Math.round(cursorX), H);
      wfCtx.stroke();
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Tuning overlay (vertical line + shaded bandwidth region)
  // ──────────────────────────────────────────────────────────────

  function _drawOverlay(ctx, W, H) {
    const { freq_mhz, bandwidth_hz } = tuningOverlay;
    const bwMhz = bandwidth_hz / 1_000_000;
    const cx  = freqToX(freq_mhz, W);
    const loX = freqToX(freq_mhz - bwMhz / 2, W);
    const hiX = freqToX(freq_mhz + bwMhz / 2, W);

    ctx.fillStyle = "rgba(248, 81, 73, 0.12)";
    ctx.fillRect(loX, 0, hiX - loX, H);

    ctx.strokeStyle = "rgba(248, 81, 73, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
  }

  // ──────────────────────────────────────────────────────────────
  // Mouse / touch events
  // ──────────────────────────────────────────────────────────────

  overlay.addEventListener("mousemove", e => {
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    cursorX = x;

    const freqMhz = xToFreq(x, rect.width);
    const bin = latestPowers.length ? freqToBin(freqMhz, latestPowers.length) : -1;
    const power = bin >= 0 ? latestPowers[bin] : null;

    document.getElementById("cursor-freq").textContent  = freqMhz.toFixed(4) + " MHz";
    document.getElementById("cursor-power").textContent = power !== null ? power.toFixed(1) + " dBm" : "";

    // Drag-to-pan
    if (dragStartX !== null) {
      const deltaPx   = x - dragStartX;
      const deltaFrac = -deltaPx / rect.width / view.zoom;
      view.panFrac = Math.max(0, Math.min(1, dragStartPanFrac + deltaFrac));
      _redrawAll();
    } else {
      // Cheap cursor-only update
      _drawRuler();
      _drawSpectrum();
      _redrawWaterfallCursor();
    }
  });

  overlay.addEventListener("mouseleave", () => {
    cursorX = null;
    dragStartX = null;
    document.getElementById("cursor-freq").textContent  = "Hover over spectrum to read frequency";
    document.getElementById("cursor-power").textContent = "";
    _drawRuler();
    _drawSpectrum();
    _redrawWaterfallCursor();
  });

  overlay.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    const rect = overlay.getBoundingClientRect();
    dragStartX       = e.clientX - rect.left;
    dragStartPanFrac = view.panFrac;
  });

  overlay.addEventListener("mouseup", e => {
    const rect = overlay.getBoundingClientRect();
    const upX = e.clientX - rect.left;
    const moved = Math.abs(upX - (dragStartX ?? upX));
    dragStartX = null;

    // Click (not a drag) → tune to frequency
    if (moved < 4) {
      const freqMhz = xToFreq(upX, rect.width);
      const freq_hz = Math.round(freqMhz * 1_000_000);
      const band = (window.RagSpy?.bands ?? []).find(
        b => freqMhz >= b.start_mhz && freqMhz <= b.stop_mhz
      );
      const mode = band?.rtl_fm_mode ?? window.RagSpy?.activeMode ?? "nfm";
      const label = freqMhz.toFixed(4) + " MHz";
      const bwMap = { am: 10000, nfm: 12500, usb: 3000, lsb: 3000, wbfm: 180000 };
      const bw = bwMap[mode] ?? 12500;
      if (typeof window.AudioPlayer !== "undefined") {
        window.AudioPlayer.tune(freq_hz, mode, label, bw);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Main entry point — called per scan_update
  // ──────────────────────────────────────────────────────────────

  function pushRow(row) {
    if (!row?.power_values?.length) return;

    bandStart = row.freq_start_mhz;
    bandEnd   = row.freq_end_mhz;
    const powers = row.power_values;

    latestPowers = powers;

    // Update noise floor (10th percentile EMA)
    const sorted = [...powers].sort((a, b) => a - b);
    const rowFloor = sorted[Math.floor(sorted.length * 0.10)];
    noiseFloor = noiseFloor * 0.93 + rowFloor * 0.07;

    // Auto-scale display range with damping
    const rowMin = sorted[0], rowMax = sorted[sorted.length - 1];
    displayMin = displayMin * 0.9 + (rowMin - 5) * 0.1;
    displayMax = displayMax * 0.9 + (rowMax + 5) * 0.1;

    // Peak hold: decay then update
    if (peakHold.length !== powers.length) {
      peakHold = new Array(powers.length).fill(-Infinity);
    }
    for (let i = 0; i < powers.length; i++) {
      peakHold[i] = Math.max(powers[i], peakHold[i] - PEAK_DECAY);
    }

    // Store raw row in circular buffer
    rowHistory[rowHead] = Float32Array.from(powers);
    rowHead = (rowHead + 1) % MAX_ROWS;

    _redrawAll();
  }

  function _redrawAll() {
    _drawRuler();
    _drawSpectrum();
    _drawWaterfall();
  }

  // ──────────────────────────────────────────────────────────────
  // Public interface
  // ──────────────────────────────────────────────────────────────

  function clear() {
    rowHistory.length = 0;
    rowHead = 0;
    latestPowers = [];
    peakHold = [];
    lastWfImg = null;
    _redrawAll();
  }

  function setZoom(level) {
    view.zoom = level;
    lastWfImg = null;
    _redrawAll();
  }

  function setPalette(name) {
    currentPalette = name;
    lastWfImg = null;
    _redrawAll();
  }

  function setBandRange(start, end) {
    bandStart    = start;
    bandEnd      = end;
    view.panFrac = 0.5;
    lastWfImg    = null;
    peakHold     = [];
  }

  function setTuningOverlay(data) {
    tuningOverlay = data;
    _drawSpectrum();
    _redrawWaterfallCursor();
  }

  function clearTuningOverlay() {
    tuningOverlay = null;
    _drawSpectrum();
    _redrawWaterfallCursor();
  }

  // Initial resize
  window.addEventListener("load", _resize);

  return { pushRow, clear, setZoom, setPalette, setBandRange, setTuningOverlay, clearTuningOverlay };

})();
