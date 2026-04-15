/**
 * app.js — top-level init, tab routing, WebSocket connections.
 * Loaded first; exposes window.RagSpy as a shared namespace.
 */
window.RagSpy = {
  // Shared state
  currentSession: null,      // { id, freq_mhz, mode }
  activeBand: "cb_radio",
  bands: [],

  // WebSocket instances
  wsScan: null,
  wsDevice: null,

  init() {
    this._initTabs();
    this._connectDevice();
    this._connectScan();
    this._loadBands();
  },

  // ── Tabs ──────────────────────────────────────────────────────────
  _initTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${target}`).classList.add("active");
      });
    });
  },

  // ── Device state WebSocket ────────────────────────────────────────
  _connectDevice() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/device`);
    this.wsDevice = ws;

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "device_state") this._updateDeviceUI(msg);
    };

    ws.onclose = () => setTimeout(() => this._connectDevice(), 3000);
  },

  _updateDeviceUI(msg) {
    const badge = document.getElementById("device-status");
    badge.className = "status-badge " + msg.mode.toLowerCase();
    badge.textContent = msg.mode;
    // Clear the freq display when no longer listening
    if (msg.mode !== "LISTENING") {
      document.getElementById("freq-display").textContent = "";
    }
  },

  // ── Scan WebSocket ────────────────────────────────────────────────
  _connectScan() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/scan`);
    this.wsScan = ws;

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === "scan_update") {
        if (typeof window.SignalsUI !== "undefined") {
          window.SignalsUI.update(msg.signals);
        }
        if (typeof window.WaterfallUI !== "undefined" && msg.band === this.activeBand) {
          window.WaterfallUI.pushRow(msg.waterfall_row);
        }
      }
    };

    ws.onclose = () => setTimeout(() => this._connectScan(), 3000);
  },

  // ── Band list ─────────────────────────────────────────────────────
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
      opt.value = b.name;
      opt.textContent = b.display;
      sel.appendChild(opt);
    });
    sel.value = this.activeBand;
    sel.addEventListener("change", () => {
      this.activeBand = sel.value;
      if (typeof window.WaterfallUI !== "undefined") {
        window.WaterfallUI.clear();
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => window.RagSpy.init());
