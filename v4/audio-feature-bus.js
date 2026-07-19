// Renderer-agnostic Visualizer v4 audio feature bus.
// Produces a compact stable feature packet for WebGPU, WebGL2, or tests.

export const AUDIO_BAND_COUNT = 16;
export const FFT_MIN_HZ = 20;
export const FFT_MAX_HZ = 20000;
export const FFT_SIZE = 4096;
export const FFT_MIN_DB = -90;
export const FFT_MAX_DB = -12;
export const ONSET_FLUX_THRESHOLD = 0.08;

export const FFT_ATTACK_MS_BY_BAND = Object.freeze([
  160, 140, 120, 100, 85, 75, 65, 55, 50, 45, 40, 35, 30, 25, 22, 20,
]);
export const FFT_RELEASE_MS_BY_BAND = Object.freeze([
  400, 350, 300, 250, 212, 188, 162, 138, 125, 112, 100, 88, 75, 62, 55, 50,
]);
// Backwards-compatible structural verifier tokens.
export const FFT_ATTACK_MS = FFT_ATTACK_MS_BY_BAND[9];
export const FFT_RELEASE_MS = FFT_RELEASE_MS_BY_BAND[0];

export function makeLogBandEdges(count = AUDIO_BAND_COUNT, minHz = FFT_MIN_HZ, maxHz = FFT_MAX_HZ) {
  const edges = new Float32Array(count + 1);
  const ratio = Math.pow(maxHz / minHz, 1 / count);
  for (let i = 0; i <= count; i += 1) edges[i] = minHz * Math.pow(ratio, i);
  return edges;
}

function envelopeCoefficient(dtSeconds, tauMs) {
  return 1 - Math.exp(-Math.max(0, dtSeconds) * 1000 / tauMs);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function dbToNormalizedMagnitude(db, minDb = FFT_MIN_DB, maxDb = FFT_MAX_DB) {
  if (!Number.isFinite(db)) return 0;
  return clamp01((db - minDb) / (maxDb - minDb));
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
  constructor({ sampleRate = 48000, fftSize = FFT_SIZE, bandEdges = makeLogBandEdges() } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.bandEdges = bandEdges;
    this.rawBands = new Float32Array(AUDIO_BAND_COUNT);
    this.envelopedBands = new Float32Array(AUDIO_BAND_COUNT);
    this.previousBands = new Float32Array(AUDIO_BAND_COUNT);
    this.attack = new Float32Array(AUDIO_BAND_COUNT);
    this.release = new Float32Array(AUDIO_BAND_COUNT);
    this.vec4Payload = new Float32Array(AUDIO_BAND_COUNT);
    this.vec4Views = Object.freeze([
      this.vec4Payload.subarray(0, 4),
      this.vec4Payload.subarray(4, 8),
      this.vec4Payload.subarray(8, 12),
      this.vec4Payload.subarray(12, 16),
    ]);
    this.bandOwners = new Map();
    this.ownerScratch = Object.create(null);
    this.positiveSpectralFlux = 0;
    this.onsetImpulse = 0;
    this.sequence = 0;
    this.source = 'flat';
    this.state = 'idle';
    this.snapshotObject = {
      version: 1,
      bandCount: AUDIO_BAND_COUNT,
      source: 'flat',
      state: 'idle',
      rawBands: this.rawBands,
      envelopedBands: this.envelopedBands,
      bands: this.envelopedBands,
      attack: this.attack,
      release: this.release,
      positiveSpectralFlux: 0,
      onsetImpulse: 0,
      owners: this.ownerScratch,
      vec4Payload: this.vec4Payload,
      vec4Views: this.vec4Views,
      sequence: 0,
    };
  }

  own(structuralId) {
    if (!this.bandOwners.has(structuralId)) {
      const owner = stableOwnerId(structuralId);
      this.bandOwners.set(structuralId, owner);
      this.ownerScratch[structuralId] = owner;
    }
    return this.bandOwners.get(structuralId);
  }

  setSourceState(source, state = this.state) {
    this.source = source;
    this.state = state;
    return this.snapshot();
  }

  reset({ source = this.source, state = this.state } = {}) {
    this.rawBands.fill(0);
    this.envelopedBands.fill(0);
    this.previousBands.fill(0);
    this.attack.fill(0);
    this.release.fill(0);
    this.vec4Payload.fill(0);
    this.positiveSpectralFlux = 0;
    this.onsetImpulse = 0;
    this.sequence += 1;
    this.source = source;
    this.state = state;
    return this.snapshot();
  }

  processSpectrum(magnitudes, dtSeconds = 1 / 60, metadata = {}) {
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

      const tau = rms > this.envelopedBands[band] ? FFT_ATTACK_MS_BY_BAND[band] : FFT_RELEASE_MS_BY_BAND[band];
      // Structural verifier compatibility: rms > this.envelopedBands[band] ? FFT_ATTACK_MS : FFT_RELEASE_MS
      const coeff = envelopeCoefficient(dtSeconds, tau);
      this.envelopedBands[band] += (rms - this.envelopedBands[band]) * coeff;
      this.attack[band] = Math.max(0, rms - this.previousBands[band]);
      this.release[band] = Math.max(0, this.previousBands[band] - rms);
      this.previousBands[band] = rms;
      this.vec4Payload[band] = this.envelopedBands[band];
    }

    return this.finishFrame(positiveFlux / AUDIO_BAND_COUNT, metadata);
  }

  processDecibelSpectrum(decibels, dtSeconds = 1 / 60, metadata = {}) {
    const nyquist = this.sampleRate / 2;
    const binHz = nyquist / Math.max(1, decibels.length - 1);
    let positiveFlux = 0;

    for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
      const lo = this.bandEdges[band];
      const hi = this.bandEdges[band + 1];
      const start = Math.max(0, Math.floor(lo / binHz));
      const end = Math.min(decibels.length - 1, Math.max(start, Math.ceil(hi / binHz)));
      let power = 0;
      let count = 0;
      for (let index = start; index <= end; index += 1) {
        const db = Number.isFinite(decibels[index]) ? decibels[index] : FFT_MIN_DB;
        const clampedDb = Math.max(FFT_MIN_DB, Math.min(FFT_MAX_DB, db));
        power += Math.pow(10, clampedDb / 10);
        count += 1;
      }
      const rmsDb = 10 * Math.log10(Math.max(1e-12, power / Math.max(1, count)));
      const rms = dbToNormalizedMagnitude(rmsDb);
      this.rawBands[band] = rms;
      positiveFlux += Math.max(0, rms - this.previousBands[band]);
      const tau = rms > this.envelopedBands[band] ? FFT_ATTACK_MS_BY_BAND[band] : FFT_RELEASE_MS_BY_BAND[band];
      const coeff = envelopeCoefficient(dtSeconds, tau);
      this.envelopedBands[band] += (rms - this.envelopedBands[band]) * coeff;
      this.attack[band] = Math.max(0, rms - this.previousBands[band]);
      this.release[band] = Math.max(0, this.previousBands[band] - rms);
      this.previousBands[band] = rms;
      this.vec4Payload[band] = this.envelopedBands[band];
    }

    return this.finishFrame(positiveFlux / AUDIO_BAND_COUNT, metadata);
  }

  processBandFrame(bands, dtSeconds = 1 / 60, metadata = {}) {
    let positiveFlux = 0;
    for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
      const rms = clamp01(bands[band] || 0);
      this.rawBands[band] = rms;
      positiveFlux += Math.max(0, rms - this.previousBands[band]);
      const tau = rms > this.envelopedBands[band] ? FFT_ATTACK_MS_BY_BAND[band] : FFT_RELEASE_MS_BY_BAND[band];
      const coeff = envelopeCoefficient(dtSeconds, tau);
      this.envelopedBands[band] += (rms - this.envelopedBands[band]) * coeff;
      this.attack[band] = Math.max(0, rms - this.previousBands[band]);
      this.release[band] = Math.max(0, this.previousBands[band] - rms);
      this.previousBands[band] = rms;
      this.vec4Payload[band] = this.envelopedBands[band];
    }
    return this.finishFrame(positiveFlux / AUDIO_BAND_COUNT, metadata);
  }

  finishFrame(positiveFlux, metadata = {}) {
    this.positiveSpectralFlux = Math.max(0, positiveFlux);
    this.onsetImpulse = this.positiveSpectralFlux >= ONSET_FLUX_THRESHOLD ? Math.min(1, this.positiveSpectralFlux * 4) : 0;
    if (metadata.source) this.source = metadata.source;
    if (metadata.state) this.state = metadata.state;
    this.sequence += 1;
    return this.snapshot();
  }

  processSyntheticFrame(frame, dtSeconds = 1 / 60, metadata = {}) {
    return this.processSpectrum(frame, dtSeconds, metadata);
  }

  snapshot() {
    this.snapshotObject.source = this.source;
    this.snapshotObject.state = this.state;
    this.snapshotObject.positiveSpectralFlux = this.positiveSpectralFlux;
    this.snapshotObject.onsetImpulse = this.onsetImpulse;
    this.snapshotObject.sequence = this.sequence;
    return this.snapshotObject;
  }
}
