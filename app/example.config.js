// App-side config for the presenter renderer.

window.APP_CONFIG = {
  // Audio capture
  audioSampleRate: 16000, // Must match Python SAMPLE_RATE to avoid resampling
  audioChunkSize: 2048,   // Smaller = lower latency, higher CPU

  // Silence gating
  silenceRmsThreshold: 0.012, // Lower = more sensitive, higher = more noise gating
  silenceSmoothing: 0.8       // 0..1; higher = smoother (less jitter)
};
