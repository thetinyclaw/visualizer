const AUDIO_BAND_COUNT = 16;
const FFT_MIN_HZ = 20;
const FFT_MAX_HZ = 20000;
const FFT_SIZE = 4096;
const MIN_DB = -90;
const MAX_DB = -12;
const TWO_PI = Math.PI * 2;

function makeLogBandEdges(count = AUDIO_BAND_COUNT, minHz = FFT_MIN_HZ, maxHz = FFT_MAX_HZ) {
  const edges = new Float32Array(count + 1);
  const ratio = Math.pow(maxHz / minHz, 1 / count);
  for (let i = 0; i <= count; i += 1) edges[i] = minHz * Math.pow(ratio, i);
  return edges;
}

const EDGES = makeLogBandEdges();
const CENTER_HZ = Array.from({ length: AUDIO_BAND_COUNT }, (_, i) => Math.sqrt(EDGES[i] * EDGES[i + 1]));

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

class VisualizerV4FeatureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.window = new Float32Array(FFT_SIZE);
    this.writeIndex = 0;
    this.samplesUntilAnalysis = 0;
    this.sequence = 0;
    this.lastBands = new Float32Array(AUDIO_BAND_COUNT);
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      this.window[this.writeIndex] = channel[i];
      this.writeIndex = (this.writeIndex + 1) % this.window.length;
      this.samplesUntilAnalysis += 1;
      if (this.samplesUntilAnalysis >= 1024) {
        this.samplesUntilAnalysis = 0;
        this.analyze();
      }
    }
    return true;
  }

  analyze() {
    const payload = new Float32Array(AUDIO_BAND_COUNT + 3);
    let flux = 0;
    for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
      const hz = Math.min(FFT_MAX_HZ, Math.max(FFT_MIN_HZ, CENTER_HZ[band]));
      const omega = TWO_PI * hz / sampleRate;
      const coeff = 2 * Math.cos(omega);
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      for (let n = 0; n < this.window.length; n += 1) {
        const read = (this.writeIndex + n) % this.window.length;
        // Hann-taper the compact worklet estimator. It is intentionally a feature estimator, not display telemetry.
        const taper = 0.5 - 0.5 * Math.cos(TWO_PI * n / (this.window.length - 1));
        s0 = this.window[read] * taper + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = Math.max(1e-12, s1 * s1 + s2 * s2 - coeff * s1 * s2) / this.window.length;
      const db = 10 * Math.log10(power);
      const normalized = clamp01((db - MIN_DB) / (MAX_DB - MIN_DB));
      payload[band] = normalized;
      flux += Math.max(0, normalized - this.lastBands[band]);
      this.lastBands[band] = normalized;
    }
    payload[16] = flux / AUDIO_BAND_COUNT;
    payload[17] = payload[16] >= 0.08 ? Math.min(1, payload[16] * 4) : 0;
    payload[18] = this.sequence += 1;
    this.port.postMessage({ type: 'audio-features', source: 'live-worklet', payload }, [payload.buffer]);
  }
}

registerProcessor('visualizer-v4-feature-processor', VisualizerV4FeatureProcessor);
