/**
 * signals.js — active signals table with click-to-listen.
 */
window.SignalsUI = (() => {
  const tbody = document.getElementById("signals-body");
  const emptyRow = document.getElementById("signals-empty");

  function update(signals) {
    if (!signals || signals.length === 0) {
      tbody.innerHTML = "";
      tbody.appendChild(emptyRow);
      emptyRow.cells[0].textContent = "No signals detected";
      return;
    }

    // Preserve which freq is currently active to keep button state
    const activeFreq = window.RagSpy.currentSession
      ? window.RagSpy.currentSession.freq_mhz
      : null;

    tbody.innerHTML = "";

    signals.forEach(sig => {
      const tr = document.createElement("tr");

      const snrClass = sig.snr_db >= 25 ? "snr-high"
                     : sig.snr_db >= 12 ? "snr-medium"
                     : "snr-low";

      const isActive = activeFreq && Math.abs(sig.freq_mhz - activeFreq) < 0.001;

      tr.innerHTML = `
        <td>${sig.freq_mhz.toFixed(4)} MHz</td>
        <td>${_formatType(sig.signal_type)}</td>
        <td>${sig.display_name}</td>
        <td class="${snrClass}">${sig.snr_db.toFixed(1)}</td>
        <td><span class="mode-badge">${sig.rtl_fm_mode.toUpperCase()}</span></td>
        <td>
          <button class="listen-btn${isActive ? " active" : ""}"
                  data-freq="${Math.round(sig.freq_mhz * 1_000_000)}"
                  data-mode="${sig.rtl_fm_mode}"
                  data-label="${sig.display_name}">
            ${isActive ? "Stop" : "Listen"}
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // Wire listen buttons
    tbody.querySelectorAll(".listen-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const freq_hz = parseInt(btn.dataset.freq, 10);
        const mode    = btn.dataset.mode;
        const label   = btn.dataset.label;
        if (btn.classList.contains("active")) {
          window.AudioPlayer && window.AudioPlayer.stop();
        } else {
          window.AudioPlayer && window.AudioPlayer.tune(freq_hz, mode, label);
        }
      });
    });
  }

  function _formatType(type) {
    const map = {
      cb_radio:           "CB",
      amateur_10m:        "Ham 10m",
      amateur_6m:         "Ham 6m",
      land_mobile:        "Land Mobile",
      vhf_utility:        "VHF Utility",
    };
    return map[type] || type;
  }

  return { update };
})();
