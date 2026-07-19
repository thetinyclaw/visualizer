// Renderer-agnostic Visualizer v4 audio feature bus.
// Produces a compact stable feature packet for WebGPU, WebGL2, or tests.

export const AUDIO_BAND_COUNT = 16;
export const FFT_MIN_HZ = 20;
export const FFT_MAX_HZ = 20000;
export const FFT_ATTACK_MS = 45;
export const FFT_RELEASE_MS = 360;
export const ONSET_FLUX_THRESHOLD = 0.08;

export function makeLogBandEdges(count = AUDIO_BAND_COUNT, minHz = FFT_MIN_HZ, maxHz = FFT_MAX_HZ) {
  const edges = new Float32Array(count + 1);
  const ratio = Math.pow(maxHz / minHz, 1 / count);
  for (let i = 0; i <= count; i += 1) edges[i] = minHz * Math.pow(ratio, i);
  return edges;
}

function envelopeCoefficient(dtSeconds, tauMs) {
  return 1 - Math.exp(-Math.max(0, dtSeconds) * 1000 / tauMs);
}

export function stableOwnerId(name, bandCount = AUDIO_BAND_COUNT) {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % bandCount;
}

export class AudioFeatureBus {
  constructor({ sampleRate = 48000, fftSize = 4096, bandEdges = makeLogBandEdges() } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.bandEdges = bandEdges;
    this.rawBands = new Float32Array(AUDIO_BAND_COUNT);
    this.envelopedBands = new Float32Array(AUDIO_BAND_COUNT);
    this.previousBands = new Float32Array(AUDIO_BAND_COUNT);
    this.bandOwners = new Map();
    this.positiveSpectralFlux = 0;
    this.onsetImpulse = 0;
  }

  own(structuralId) {
    if (!this.bandOwners.has(structuralId)) this.bandOwners.set(structuralId, stableOwnerId(structuralId));
    return this.bandOwners.get(structuralId);
  }

  processSpectrum(magnitudes, dtSeconds = 1 / 60) {
    const nyquist = this.sampleRate / 2;
    const binHz = nyquist / Math.max(1, magnitudes.length - 1);
    let positiveFlux = 0;

    for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
      const lo = this.bandEdges[band];
      const hi = this.bandEdges[band + 1];
      const start = Math.max(0, Math.floor(lo / binHz));
      const end = Math.min(magnitudes.length - 1, Math.max(start, Math.ceil(hi / binHz)));
      let sum = 0;
      let count = 0;
      for (let index = start; index <= end; index += 1) {
        const value = Math.max(0, magnitudes[index] || 0);
        sum += value * value;
        count += 1;
      }
      const rms = Math.sqrt(sum / Math.max(1, count));
      this.rawBands[band] = rms;
      positiveFlux += Math.max(0, rms - this.previousBands[band]);

      const tau = rms > this.envelopedBands[band] ? FFT_ATTACK_MS : FFT_RELEASE_MS;
      const coeff = envelopeCoefficient(dtSeconds, tau);
      this.envelopedBands[band] += (rms - this.envelopedBands[band]) * coeff;
      this.previousBands[band] = rms;
    }

    this.positiveSpectralFlux = positiveFlux / AUDIO_BAND_COUNT;
    this.onsetImpulse = this.positiveSpectralFlux >= ONSET_FLUX_THRESHOLD ? Math.min(1, this.positiveSpectralFlux * 4) : 0;
    return this.snapshot();
  }

  processSyntheticFrame(frame, dtSeconds = 1 / 60) {
    return this.processSpectrum(frame, dtSeconds);
  }

  snapshot() {
    return Object.freeze({
      bandCount: AUDIO_BAND_COUNT,
      rawBands: Array.from(this.rawBands),
      envelopedBands: Array.from(this.envelopedBands),
      positiveSpectralFlux: this.positiveSpectralFlux,
      onsetImpulse: this.onsetImpulse,
      owners: Object.fromEntries(this.bandOwners),
    });
  }
}
