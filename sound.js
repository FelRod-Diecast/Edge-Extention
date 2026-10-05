let lastPlaybackTime = 0;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action !== "PLAY_ALERT_SOUND") {
    return;
  }

  const now = Date.now();

  // Prevent multiple simultaneous alert requests from stacking audio.
  if (now - lastPlaybackTime < 750) {
    return;
  }

  lastPlaybackTime = now;

  const audio = document.getElementById("alertAudio");

  if (!audio) {
    return;
  }

  audio.currentTime = 0;
  audio.play().catch(err => {
    console.warn("[OFFSCREEN AUDIO] Playback unavailable:", err);
  });
});