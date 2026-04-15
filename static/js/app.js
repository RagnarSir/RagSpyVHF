/**
 * app.js — init, WebSocket connections, sidebar control wiring.
 * Exposes window.RagSpy as a shared namespace for all modules.
 */
window.RagSpy = {
  currentSession: null,   // { id, freq_mhz, mode, bandwidth_hz }
  activeBand:     "cb_radio",
  activeMode:     "nfm",
  bands:          [],
  wsScan:         null,
  wsDevice:       null,

  init() {
    this._connectDevice();
    this._connectScan();
    this._loadBands();
    this._initSidebar();
  },

  // ── Device state WebSocket ───────────────────────────────────
  _connectDevice() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/device`);
    this.wsDevice = ws;
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === "device_state") this._onDeviceState(msg);
    };
    ws.onclose = () => setTimeout(() => this._connectDevice(), 3000);
  },

  _onDeviceState(msg) {
    const badge = document.getElementById("device-status");
    badge.className = "status-badge " + msg.mode.toLowerCase();
    badge.textContent = msg.mode;
  },

  // ── Scan WebSocket ────────────────────────────────────────────
  _connectScan() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/scan`);
    this.wsScan = ws;
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type !== "scan_update") return;
      if (typeof window.SignalsUI !== "undefined") {
        window.SignalsUI.update(msg.signals);
      }
      if (typeof window.WaterfallUI !== "undefined" && msg.band === this.activeBand) {
        window.WaterfallUI.pushRow(msg.waterfall_row);
      }
    };
    ws.onclose = () => setTimeout(() => this._connectScan(), 3000);
  },

  // ── Band list ─────────────────────────────────────────────────
  async _loadBands() {
    try {
      const resp = await fetch("/api/scan/bands");
      this.bands = await resp.json();
      this._populateBandSelect();
    } catch (e) {
      console.error("Failed to load bands:", e);
    }
  },

  _populateBandSelect() {
    const sel = document.getElementById("band-select");
    sel.innerHTML = "";
    this.bands.forEach(b => {
      const opt = document.createElement("option");
      opt.value       = b.name;
      opt.textContent = b.display;
      sel.appendChild(opt);
    });
    sel.value = this.activeBand;

    // Set initial band range in waterfall
    const initial = this.bands.find(b => b.name === this.activeBand);
    if (initial && window.WaterfallUI) {
      window.WaterfallUI.setBandRange(initial.start_mhz, initial.stop_mhz);
    }

    sel.addEventListener("change", () => {
      this.activeBand = sel.value;
      const band = this.bands.find(b => b.name === sel.value);
      if (band && window.WaterfallUI) {
        window.WaterfallUI.setBandRange(band.start_mhz, band.stop_mhz);
        window.WaterfallUI.clear();
      }
      // Reset zoom to 1x when changing band
      document.querySelectorAll(".zoom-btn").forEach(b => b.classList.remove("active"));
      document.querySelector('.zoom-btn[data-zoom="1"]').classList.add("active");
      if (window.WaterfallUI) window.WaterfallUI.setZoom(1);
    });
  },

  // ── Sidebar controls ──────────────────────────────────────────
  _initSidebar() {
    // Mode buttons
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.activeMode = btn.dataset.mode;
      });
    });

    // Zoom buttons
    document.querySelectorAll(".zoom-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".zoom-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (window.WaterfallUI) window.WaterfallUI.setZoom(parseInt(btn.dataset.zoom, 10));
      });
    });

    // Palette buttons
    document.querySelectorAll(".palette-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".palette-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (window.WaterfallUI) window.WaterfallUI.setPalette(btn.dataset.palette);
      });
    });

    // Frequency entry
    const freqInput = document.getElementById("freq-input");
    const goBtn     = document.getElementById("freq-go-btn");
    const bwDefaults = { am: 10000, nfm: 12500, fm: 12500, usb: 3000, lsb: 3000, wbfm: 180000 };

    const doTune = () => {
      const mhz = parseFloat(freqInput.value);
      if (isNaN(mhz) || mhz < 1 || mhz > 3000) return;
      const hz   = Math.round(mhz * 1_000_000);
      const mode = this.activeMode;
      const bw   = bwDefaults[mode] ?? 12500;
      if (typeof window.AudioPlayer !== "undefined") {
        window.AudioPlayer.tune(hz, mode, mhz.toFixed(4) + " MHz", bw);
      }
    };

    goBtn.addEventListener("click", doTune);
    freqInput.addEventListener("keydown", e => { if (e.key === "Enter") doTune(); });
  },

  // ── Utility: sync mode buttons from outside ───────────────────
  setActiveMode(mode) {
    this.activeMode = mode;
    document.querySelectorAll(".mode-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
  },
};

document.addEventListener("DOMContentLoaded", () => window.RagSpy.init());
