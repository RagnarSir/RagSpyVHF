/**
 * audio_player.js — streams raw PCM from /api/voice/stream/{id}
 * and plays it via Web Audio API (no ffmpeg required on the Pi).
 *
 * The stream is audio/x-raw S16LE mono 48 kHz.
 * We manually convert Int16 → Float32 and push into AudioContext.
 */
window.AudioPlayer = (() => {
  let audioCtx = null;
  let sessionId = null;
  let reader = null;
  let gainNode = null;
  let nextPlayTime = 0;
  const SAMPLE_RATE = 48000;
  const BUFFER_AHEAD = 0.5;   // Seconds of pre-roll to prevent choppy playback

  const freqEl    = document.getElementById("audio-freq");
  const modeEl    = document.getElementById("audio-mode-badge");
  const activeDiv = document.getElementById("audio-active");
  const idleMsg   = document.getElementById("audio-idle-msg");
  const meterBar  = document.getElementById("audio-meter-bar");
  const bufStatus = document.getElementById("audio-buffer-status");
  const volSlider = document.getElementById("volume-slider");
  const stopBtn   = document.getElementById("stop-btn");

  stopBtn.addEventListener("click", () => stop());
  volSlider.addEventListener("input", () => {
    if (gainNode) gainNode.gain.value = parseFloat(volSlider.value);
  });

  // ── Public API ────────────────────────────────────────────────────

  async function tune(freq_hz, mode, label) {
    if (sessionId) await stop();

    try {
      const resp = await fetch("/api/voice/tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freq_hz, mode }),
      });
      if (!resp.ok) {
        console.error("Tune failed:", await resp.text());
        return;
      }
      const data = await resp.json();
      sessionId = data.session_id;

      window.RagSpy.currentSession = {
        id: sessionId,
        freq_mhz: data.freq_mhz,
        mode: data.mode,
      };

      // Switch to Audio tab
      document.querySelector('[data-tab="audio"]').click();

      const displayLabel = label || data.freq_mhz.toFixed(4) + " MHz";
      freqEl.textContent  = displayLabel;
      modeEl.textContent  = data.mode.toUpperCase();
      document.getElementById("freq-display").textContent = displayLabel;
      activeDiv.style.display = "";
      idleMsg.style.display   = "none";

      _startStreaming(data.stream_url);
    } catch (e) {
      console.error("tune() error:", e);
    }
  }

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
    }

    try {
      await fetch(`/api/voice/stop?session_id=${sid}`, { method: "POST" });
    } catch (_) {}

    activeDiv.style.display = "none";
    idleMsg.style.display   = "";
    meterBar.style.width    = "0%";
    bufStatus.textContent   = "";
  }

  // ── Streaming / decoding ──────────────────────────────────────────

  async function _startStreaming(url) {
    audioCtx   = new AudioContext({ sampleRate: SAMPLE_RATE });
    gainNode   = audioCtx.createGain();
    gainNode.gain.value = parseFloat(volSlider.value);
    gainNode.connect(audioCtx.destination);
    nextPlayTime = audioCtx.currentTime + BUFFER_AHEAD;

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
        const result = await reader.read();
        if (result.done) break;
        chunk = result.value;
      } catch (_) {
        break;
      }

      // Prepend any leftover bytes from last chunk
      let data;
      if (leftover.length > 0) {
        data = new Uint8Array(leftover.length + chunk.length);
        data.set(leftover);
        data.set(chunk, leftover.length);
      } else {
        data = chunk;
      }

      // Process whole Int16 samples only
      const wholeSamples = Math.floor(data.length / 2) * 2;
      leftover = data.slice(wholeSamples);
      if (wholeSamples === 0) continue;

      const int16 = new Int16Array(data.buffer, data.byteOffset, wholeSamples / 2);
      const float32 = new Float32Array(int16.length);
      let rms = 0;
      for (let i = 0; i < int16.length; i++) {
        const f = int16[i] / 32768.0;
        float32[i] = f;
        rms += f * f;
      }
      rms = Math.sqrt(rms / int16.length);

      // Schedule audio buffer
      const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);

      const now = audioCtx.currentTime;
      if (nextPlayTime < now) nextPlayTime = now + BUFFER_AHEAD;
      source.start(nextPlayTime);
      nextPlayTime += buffer.duration;

      // Update VU meter
      const pct = Math.min(100, Math.round(rms * 400));
      meterBar.style.width = pct + "%";

      const buffered = Math.max(0, nextPlayTime - audioCtx.currentTime).toFixed(2);
      bufStatus.textContent = `Buffer: ${buffered}s`;
    }

    // Stream ended
    if (sessionId) await stop();
  }

  return { tune, stop };
})();
