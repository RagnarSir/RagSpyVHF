/**
 * signals.js — active signals table with click-to-listen.
 */
window.SignalsUI = (() => {
  const tbody   = document.getElementById("signals-body");
  const emptyRow = document.getElementById("signals-empty");

  function update(signals) {
    if (!signals?.length) {
      tbody.innerHTML = "";
      tbody.appendChild(emptyRow);
      emptyRow.cells[0].textContent = "No signals detected";
      return;
    }

    const activeFreqMhz = window.RagSpy.currentSession?.freq_mhz ?? null;

    tbody.innerHTML = "";
    signals.forEach(sig => {
      const isActive = activeFreqMhz !== null &&
        Math.abs(sig.freq_mhz - activeFreqMhz) < 0.001;

      const snrClass = sig.snr_db >= 25 ? "snr-high"
                     : sig.snr_db >= 12 ? "snr-medium"
                     : "snr-low";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${sig.freq_mhz.toFixed(4)}&nbsp;MHz</td>
        <td>${_typeLabel(sig.signal_type)}</td>
        <td>${sig.display_name}</td>
        <td class="${snrClass}">${sig.snr_db.toFixed(1)}</td>
        <td><span class="mode-badge">${sig.rtl_fm_mode.toUpperCase()}</span></td>
        <td>
          <button class="listen-btn${isActive ? " active" : ""}"
                  data-freq="${Math.round(sig.freq_mhz * 1_000_000)}"
                  data-mode="${sig.rtl_fm_mode}"
                  data-label="${sig.display_name}"
                  data-bw="${sig.bandwidth_est_hz ?? 12500}">
            ${isActive ? "Stop" : "Listen"}
          </button>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".listen-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const freq_hz = parseInt(btn.dataset.freq, 10);
        const mode    = btn.dataset.mode;
        const label   = btn.dataset.label;
        const bw      = parseInt(btn.dataset.bw, 10);

        if (btn.classList.contains("active")) {
          window.AudioPlayer?.stop();
        } else {
          // Sync mode buttons in sidebar
          window.RagSpy.setActiveMode(mode);
          window.AudioPlayer?.tune(freq_hz, mode, label, bw);
        }
      });
    });
  }

  function _typeLabel(type) {
    return {
      cb_radio:           "CB",
      amateur_10m:        "Ham 10m",
      amateur_6m:         "Ham 6m",
      land_mobile:        "Land Mobile",
      vhf_utility:        "VHF Utility",
    }[type] ?? type;
  }

  return { update };
})();
