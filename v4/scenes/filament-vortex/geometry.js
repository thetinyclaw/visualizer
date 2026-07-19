export const FILAMENT_STRAND_COUNT = 118;
export const FILAMENT_SEGMENT_COUNT = 52;
export const FILAMENT_NODE_COUNT = FILAMENT_STRAND_COUNT * FILAMENT_SEGMENT_COUNT;
export const FILAMENT_SEGMENTS_PER_STRAND = FILAMENT_SEGMENT_COUNT - 1;
export const FILAMENT_DRAW_VERTICES = FILAMENT_STRAND_COUNT * FILAMENT_SEGMENTS_PER_STRAND * 6;
export const FILAMENT_WORKGROUPS = Math.ceil(FILAMENT_NODE_COUNT / 64);
export const FILAMENT_UNIFORM_BYTES = 5 * 4 * 4;
export const FILAMENT_AUDIO_BYTES = 16 * 4;
export const FILAMENT_POSITION_BYTES = FILAMENT_NODE_COUNT * 4 * 4;
export const FILAMENT_VELOCITY_BYTES = FILAMENT_NODE_COUNT * 4 * 4;

export const FILAMENT_CONTRACT = Object.freeze({
  strandCount: FILAMENT_STRAND_COUNT,
  segmentCount: FILAMENT_SEGMENT_COUNT,
  nodeCount: FILAMENT_NODE_COUNT,
  segmentsPerStrand: FILAMENT_SEGMENTS_PER_STRAND,
  drawVertices: FILAMENT_DRAW_VERTICES,
  workgroups: [FILAMENT_WORKGROUPS, 1, 1],
  topology: '118 persistent strands × 52 compute-updated nodes, ribbon triangle render draw',
});

function fract(x) { return x - Math.floor(x); }
function hash11(n) { return fract(Math.sin(n) * 43758.5453123); }
function bandAt(bands, i) { return bands[Math.max(0, Math.min(15, i | 0))] || 0; }
export function demoBands(out = new Float32Array(16), time = 0, seed = 491009, mode = 'demo') {
  for (let i = 0; i < 16; i += 1) {
    if (mode === 'flat') { out[i] = 0.12; continue; }
    const slow = 0.5 + 0.5 * Math.sin(time * (0.35 + i * 0.031) + seed * 0.001 + i * 0.77);
    const pulse = Math.max(0, Math.sin(time * (1.2 + (i % 5) * 0.13) + i * 1.71));
    out[i] = Math.max(0.02, Math.min(1, 0.10 + slow * 0.36 + pulse * pulse * (i < 4 ? 0.28 : i < 11 ? 0.20 : 0.16)));
  }
  return out;
}
export function summarizeBands(bands) {
  const avg = (a, b) => { let s = 0; for (let i = a; i < b; i += 1) s += bands[i] || 0; return s / (b - a); };
  const bass = avg(0, 3), lowMid = avg(3, 8), highMid = avg(8, 12), treble = avg(12, 16);
  let flux = 0; for (let i = 1; i < 16; i += 1) flux += Math.max(0, (bands[i] || 0) - (bands[i - 1] || 0));
  flux = Math.min(1, flux / 4);
  const onset = Math.min(1, Math.max(0, (bass + lowMid) * 0.72 + flux * 0.55));
  return { bass, lowMid, highMid, treble, flux, onset };
}
export function makeUniformPayload({ time = 0, dt = 1 / 60, seed = 491009, live = false, frameIndex = 0, width = 1280, height = 720, generation = 0, bands = demoBands(new Float32Array(16), time, seed), mode = 'demo' } = {}) {
  const s = summarizeBands(bands);
  const data = new Float32Array(20);
  data.set([time, dt, seed, live ? 1 : 0], 0);
  data.set([frameIndex, width, height, generation], 4);
  data.set([s.bass, s.lowMid, s.highMid, s.treble], 8);
  data.set([s.flux, s.onset, mode === 'flat' ? 1 : 0, 1 + s.lowMid * 0.9 + s.flux * 0.5], 12);
  data.set([(s.highMid - 0.25) * 0.10, (s.bass - 0.25) * -0.06, 2.35 + s.onset * 0.28, (seed % 1000) * 0.0002 + time * (live ? 0.025 : 0.0) + s.flux * 0.05], 16);
  return { data, summary: s };
}
export function filamentSignature({ seed = 491009, time = 0, mode = 'demo' } = {}) {
  const bands = demoBands(new Float32Array(16), time, seed, mode);
  const s = summarizeBands(bands);
  let acc = 2166136261 >>> 0;
  for (let strand = 0; strand < FILAMENT_STRAND_COUNT; strand += 17) {
    for (let segment = 0; segment < FILAMENT_SEGMENT_COUNT; segment += 9) {
      const sf = strand, uf = segment / (FILAMENT_SEGMENT_COUNT - 1), lane = sf / FILAMENT_STRAND_COUNT;
      const owner = bandAt(bands, Math.floor(fract(lane + seed * 0.000019) * 16));
      const bundleH = hash11(Math.floor(sf / 6) * 41.7 + seed * 0.07), h = hash11(sf * 17.31 + seed * 0.113);
      const spacing = 0.010 + s.bass * 0.020 + owner * 0.014 + s.treble * 0.004;
      const radiusBase = 0.06 + uf * (1.02 + s.bass * 0.16) + (h - 0.5) * spacing * 10.0;
      const curl = lane * Math.PI * 2 + (bundleH - 0.5) * 0.42 + Math.log(radiusBase + 0.035) * (2.8 + s.lowMid * 2.4 - s.treble * 0.55 + bundleH * 0.8) - time * (0.11 + s.lowMid * 0.40 + s.flux * 0.18) * (1 + s.lowMid * 0.9 + s.flux * 0.5) * (0.8 + uf * 1.8);
      const q = Math.floor((Math.cos(curl) * radiusBase + Math.sin(curl) * radiusBase) * 1000000);
      acc ^= q; acc = Math.imul(acc, 16777619) >>> 0;
    }
  }
  return acc.toString(16).padStart(8, '0');
}

export function createFilamentVortexScene({ seed = 491009, mode = 'demo', locked = false } = {}) {
  const reusableBands = new Float32Array(16);
  const state = {
    id: 'filament-vortex', seed, mode, locked,
    contract: FILAMENT_CONTRACT,
    liveFrame: 0, generation: 0, lastTime: 0, lastDt: 0, lastAudio: null, lastSignature: filamentSignature({ seed, time: 0, mode }),
    pingPongParity: 0, pingPongSwapCount: 0, pendingPingPong: null,
    structuralAudioMappings: Object.freeze(['bass → aperture/bundle spacing', 'low-mid → curl field/flow speed', 'high-mid → fray/camera drift', 'treble → ribbon width/capillaries', 'flux/onset → flow pressure/camera roll']),
    materialHierarchy: Object.freeze(['depth-tested translucent ribbon cores', 'additive pearl strand glow', 'post bloom/tonemap', 'swapchain composite vignette']),
    pingPongState() {
      const parity = this.pingPongParity & 1;
      const nextParity = parity ^ 1;
      return Object.freeze({
        parity,
        nextParity,
        swapCount: this.pingPongSwapCount,
        previousPositionId: `filament-positions-${parity === 0 ? 'a' : 'b'}`,
        previousVelocityId: `filament-velocities-${parity === 0 ? 'a' : 'b'}`,
        nextPositionId: `filament-positions-${nextParity === 0 ? 'a' : 'b'}`,
        nextVelocityId: `filament-velocities-${nextParity === 0 ? 'a' : 'b'}`,
      });
    },
    markFrameSubmitted({ live = false } = {}) {
      if (!this.pendingPingPong) return this.pingPongState();
      this.pingPongParity = this.pendingPingPong.nextParity;
      this.pingPongSwapCount += 1;
      if (live) this.liveFrame += 1;
      this.pendingPingPong = null;
      return this.pingPongState();
    },
    prepareFrame({ time = 0, dt = 1 / 60, audio = null, width = 1280, height = 720, live = false } = {}) {
      const bands = reusableBands;
      const snap = audio?.bands || audio?.values || null;
      if (snap && snap.length >= 16) bands.set(snap.subarray ? snap.subarray(0, 16) : Array.from(snap).slice(0, 16));
      else demoBands(bands, time, seed, mode);
      if (mode === 'flat') bands.fill(0.12);
      const frameIndex = live ? this.liveFrame : 0;
      const payload = makeUniformPayload({ time, dt, seed, live, frameIndex, width, height, generation: this.generation, bands, mode });
      this.pendingPingPong = this.pingPongState();
      this.lastTime = time; this.lastDt = dt; this.lastAudio = { ...payload.summary, source: mode, bands: Array.from(bands) };
      this.lastSignature = filamentSignature({ seed, time, mode });
      this.lastSummary = { strandCount: FILAMENT_STRAND_COUNT, segmentCount: FILAMENT_SEGMENT_COUNT, nodeCount: FILAMENT_NODE_COUNT, drawVertices: FILAMENT_DRAW_VERTICES, workgroups: FILAMENT_WORKGROUPS, signature: this.lastSignature, bounds: { x: [-1.3, 1.3], y: [-1.3, 1.3], z: [-0.8, 0.8] }, audio: this.lastAudio, pingPong: this.pendingPingPong };
      return { uniforms: payload.data, bands, summary: this.lastSummary };
    },
  };
  return state;
}
