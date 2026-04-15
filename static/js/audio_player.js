/**
 * audio_player.js — streams raw S16LE PCM from /api/voice/stream/{id}
 * and plays via Web Audio API.
 *
 * Features:
 *   • S-meter: 7 LED segments updated from chunk RMS
 *   • Squelch: client-side; mutes gain smoothly when RMS < threshold
 *   • Tuning overlay: calls WaterfallUI.setTuningOverlay / clearTuningOverlay
 *   • Now-listening bar: appears in header when active
 */
window.AudioPlayer = (() => {

  // ── DOM handles ──────────────────────────────────────────────
  const nowListeningBar = document.getElementById("now-listening");
  const nlFreq          = document.getElementById("nl-freq");
  const nlMode          = document.getElementById("nl-mode-badge");
  const volSlider       = document.getElementById("volume-slider");
  const squelchSlider   = document.getElementById("squelch-slider");
  const stopBtn         = document.getElementById("stop-btn");
  const smeterSegs      = Array.from(document.querySelectorAll("#smeter .seg"));

  // ── S-meter thresholds (RMS → segment lights) ────────────────
  // Segments 1-5 green (normal voice), 6 yellow, 7 red (strong/overload)
  const S_THRESHOLDS = [0.005, 0.015, 0.04, 0.08, 0.15, 0.25, 0.40];

  function _updateSmeter(rms) {
    smeterSegs.forEach((seg, i) => seg.classList.toggle("lit", rms >= S_THRESHOLDS[i]));
  }

  // ── Audio state ───────────────────────────────────────────────
  const SAMPLE_RATE  = 48000;
  const BUFFER_AHEAD = 0.5;    // Seconds of pre-roll for jitter resistance

  let audioCtx     = null;
  let gainNode     = null;
  let reader       = null;
  let sessionId    = null;
  let nextPlayTime = 0;

  // ── Wire stop button ──────────────────────────────────────────
  stopBtn.addEventListener("click", () => stop());
  volSlider.addEventListener("input", () => {
    if (gainNode && audioCtx) {
      gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
      gainNode.gain.setTargetAtTime(parseFloat(volSlider.value), audioCtx.currentTime, 0.05);
    }
  });

  // ── Public: tune ──────────────────────────────────────────────
  async function tune(freq_hz, mode, label, bandwidth_hz) {
    if (sessionId) await stop();

    try {
      const resp = await fetch("/api/voice/tune", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ freq_hz, mode }),
      });
      if (!resp.ok) {
        console.error("Tune failed:", resp.status, await resp.text());
        return;
      }
      const data = await resp.json();
      sessionId = data.session_id;

      window.RagSpy.currentSession = {
        id:           sessionId,
        freq_mhz:     data.freq_mhz,
        mode:         data.mode,
        bandwidth_hz: bandwidth_hz ?? 12500,
      };

      // Show now-listening bar
      nlFreq.textContent = label || data.freq_mhz.toFixed(4) + " MHz";
      nlMode.textContent = data.mode.toUpperCase();
      nowListeningBar.style.display = "flex";

      // Tuning overlay on spectrum/waterfall
      if (typeof window.WaterfallUI !== "undefined") {
        window.WaterfallUI.setTuningOverlay({
          freq_mhz:     data.freq_mhz,
          bandwidth_hz: bandwidth_hz ?? 12500,
        });
      }

      _startStreaming(data.stream_url);
    } catch (e) {
      console.error("tune() error:", e);
    }
  }

  // ── Public: stop ──────────────────────────────────────────────
  async function stop() {
    if (!sessionId) return;

    const sid = sessionId;
    sessionId = null;
    window.RagSpy.currentSession = null;

    if (reader) {
      try { reader.cancel(); } catch (_) {}
      reader = null;
    }
    if (audioCtx) {
      try { await audioCtx.close(); } catch (_) {}
      audioCtx = null;
      gainNode = null;
    }

    // Hide now-listening bar, clear S-meter
    nowListeningBar.style.display = "none";
    _updateSmeter(0);

    // Remove tuning overlay
    if (typeof window.WaterfallUI !== "undefined") {
      window.WaterfallUI.clearTuningOverlay();
    }

    try {
      await fetch(`/api/voice/stop?session_id=${sid}`, { method: "POST" });
    } catch (_) {}
  }

  // ── Streaming / decoding ──────────────────────────────────────
  async function _startStreaming(url) {
    audioCtx     = new AudioContext({ sampleRate: SAMPLE_RATE });
    gainNode     = audioCtx.createGain();
    gainNode.gain.value = parseFloat(volSlider.value);
    gainNode.connect(audioCtx.destination);
    nextPlayTime = audioCtx.currentTime + BUFFER_AHEAD;

    // Browsers require a user gesture before AudioContext runs; resume if suspended
    if (audioCtx.state === "suspended") await audioCtx.resume();

    let response;
    try {
      response = await fetch(url);
    } catch (e) {
      console.error("Stream fetch failed:", e);
      return;
    }
    if (!response.ok || !response.body) return;

    reader = response.body.getReader();
    let leftover = new Uint8Array(0);

    while (true) {
      let chunk;
      try {
        const { done, value } = await reader.read();
        if (done) break;
        chunk = value;
      } catch (_) {
        break;
      }

      // Merge with any leftover bytes from previous chunk
      let data;
      if (leftover.length > 0) {
        data = new Uint8Array(leftover.length + chunk.length);
        data.set(leftover);
        data.set(chunk, leftover.length);
      } else {
        data = chunk;
      }

      // Only process whole Int16 samples
      const wholeSamples = Math.floor(data.length / 2) * 2;
      leftover = data.slice(wholeSamples);
      if (wholeSamples === 0) continue;

      // Int16 → Float32 and compute RMS
      const int16   = new Int16Array(data.buffer, data.byteOffset, wholeSamples / 2);
      const float32 = new Float32Array(int16.length);
      let sumSq = 0;
      for (let i = 0; i < int16.length; i++) {
        const f = int16[i] / 32768.0;
        float32[i] = f;
        sumSq += f * f;
      }
      const rms = Math.sqrt(sumSq / int16.length);

      // S-meter update
      _updateSmeter(rms);

      // Squelch: smoothly mute gain when RMS is below threshold
      if (gainNode && audioCtx) {
        const squelch    = parseFloat(squelchSlider.value);
        const targetGain = rms < squelch ? 0 : parseFloat(volSlider.value);
        gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        gainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.05);
      }

      // Schedule audio buffer
      if (!audioCtx) break;
      const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);
      const source = audioCtx.createBufferSource();
      source.buffer  = buffer;
      source.connect(gainNode);

      const now = audioCtx.currentTime;
      if (nextPlayTime < now) nextPlayTime = now + BUFFER_AHEAD;
      source.start(nextPlayTime);
      nextPlayTime += buffer.duration;
    }

    // Stream ended from server side
    if (sessionId) await stop();
  }

  return { tune, stop };
})();
