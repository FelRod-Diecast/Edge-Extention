chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "PLAY_ALERT_SOUND") {
    const audio = document.getElementById("alertAudio");
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(err => console.error("[OFFSCREEN AUDIO] Playback error:", err));
    }
  }
});