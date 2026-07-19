const INSTANCE_COUNT = 260;
const BASE_FLOATS_PER_INSTANCE = 8;
const PAYLOAD_FLOATS_PER_INSTANCE = 12;
const FRAME_FLOATS = 32;
const AUDIO_FLOATS = 24;

export const VOXEL_INSTANCE_COUNT = INSTANCE_COUNT;
export const VOXEL_BASE_FLOATS_PER_INSTANCE = BASE_FLOATS_PER_INSTANCE;
export const VOXEL_PAYLOAD_FLOATS_PER_INSTANCE = PAYLOAD_FLOATS_PER_INSTANCE;
export const VOXEL_FRAME_BYTES = FRAME_FLOATS * 4;
export const VOXEL_AUDIO_BYTES = AUDIO_FLOATS * 4;
export const VOXEL_BASE_BYTES = INSTANCE_COUNT * BASE_FLOATS_PER_INSTANCE * 4;
export const VOXEL_PAYLOAD_BYTES = INSTANCE_COUNT * PAYLOAD_FLOATS_PER_INSTANCE * 4;

export const VOXEL_CONTRACT = Object.freeze({
  instanceCount: INSTANCE_COUNT,
  baseFloatsPerInstance: BASE_FLOATS_PER_INSTANCE,
  payloadFloatsPerInstance: PAYLOAD_FLOATS_PER_INSTANCE,
  bounds: Object.freeze({ min: [-7.5, -4.8, -28.5], max: [7.5, 5.6, 9.5] }),
  topology: 'bounded volumetric tunnel/cloud: four seeded corridor arcs plus dense scan-front shelf, not scattered cubes',
  cubeVertices: 8,
  cubeIndices: 36,
  computeWorkgroups: [Math.ceil(INSTANCE_COUNT / 64), 1, 1],
});

function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }
function fract(value) { return value - Math.floor(value); }
function hash01(value) { return fract(Math.sin(value * 127.1 + 311.7) * 43758.5453123); }
function seedHash(seed, a, b = 0) { return hash01((seed >>> 0) * 0.000131 + a * 19.19 + b * 7.13); }
function xorshift32(value) {
  let x = value >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return x >>> 0;
}
function rand(state) {
  const next = xorshift32(state.value || 0x9e3779b9);
  state.value = next;
  return next / 0xffffffff;
}

export function demoVoxelBands(out = new Float32Array(16), time = 0, seed = 582114, mode = 'demo') {
  if (mode === 'flat') { out.fill(0); return out; }
  for (let i = 0; i < 16; i += 1) {
    const phase = seed * 0.00009 + i * 0.71;
    const slow = 0.5 + 0.5 * Math.sin(time * (0.34 + i * 0.017) + phase);
    const pulse = Math.pow(Math.max(0, Math.sin(time * (0.92 + i * 0.031) + phase * 1.7)), 6);
    out[i] = clamp(0.10 + slow * (0.30 + i * 0.012) + pulse * (0.32 + (i % 4) * 0.025), 0, 1);
  }
  return out;
}

function makePerspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = far / (near - far); out[11] = -1;
  out[14] = (far * near) / (near - far);
  return out;
}
function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function makeLookAt(out, eye, center, up) {
  const z = normalize3([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1;
  return out;
}
function multiply4(out, a, b) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let row = 0; row < 4; row += 1) {
      r[c * 4 + row] = a[0 * 4 + row] * b[c * 4 + 0] + a[1 * 4 + row] * b[c * 4 + 1] + a[2 * 4 + row] * b[c * 4 + 2] + a[3 * 4 + row] * b[c * 4 + 3];
    }
  }
  out.set(r); return out;
}

function bandAt(audio, index) {
  const bands = audio?.bands || audio?.vec4Payload || audio?.rawBands;
  return clamp(Number(bands?.[index] || 0), 0, 1);
}

function computeAudioFeatures(audio) {
  let low = 0, mid = 0, high = 0;
  for (let i = 0; i < 4; i += 1) low += bandAt(audio, i);
  for (let i = 4; i < 11; i += 1) mid += bandAt(audio, i);
  for (let i = 11; i < 16; i += 1) high += bandAt(audio, i);
  low /= 4; mid /= 7; high /= 5;
  return {
    low, mid, high,
    flux: clamp(Number(audio?.positiveSpectralFlux || 0) * 5, 0, 1),
    onset: clamp(Number(audio?.onsetImpulse || 0), 0, 1),
  };
}

export function createVoxelCubeGeometry() {
  return Object.freeze({
    vertices: new Float32Array([
      -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ]),
    indices: new Uint16Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
      1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
    ]),
  });
}

export function createSeededVoxelBase(seed = 582114) {
  const base = new Float32Array(VOXEL_BASE_BYTES / 4);
  const rng = { value: (seed ^ 0xa53a9b7d) >>> 0 };
  const rings = 52;
  for (let i = 0; i < INSTANCE_COUNT; i += 1) {
    const ring = i % rings;
    const lane = Math.floor(i / rings);
    const zNorm = ring / (rings - 1);
    const z = 7.6 - zNorm * 34.8 + (rand(rng) - 0.5) * 0.34;
    const twist = zNorm * Math.PI * 3.8 + seed * 0.00019;
    const corridorOpen = 1.05 + 0.75 * Math.sin(zNorm * Math.PI * 2.0 + 0.5) + 0.25 * Math.sin(zNorm * Math.PI * 7.0);
    const laneAngle = twist + lane * (Math.PI * 0.5) + (rand(rng) - 0.5) * 0.35;
    const isSpine = lane < 4;
    const radius = isSpine ? (2.15 + corridorOpen + (rand(rng) - 0.5) * 0.55) : (0.9 + rand(rng) * 4.2);
    const x = Math.cos(laneAngle) * radius + Math.sin(zNorm * 7.0 + lane) * 0.22;
    const y = Math.sin(laneAngle) * radius * 0.66 + Math.cos(zNorm * 5.0 + lane * 0.3) * 0.28;
    const density = clamp(0.55 + 0.35 * Math.sin(zNorm * Math.PI * 5 + lane) + 0.12 * (rand(rng) - 0.5), 0, 1);
    const size = 0.13 + rand(rng) * 0.19 + (lane === 4 ? 0.10 : 0);
    const hue = (lane * 0.17 + zNorm * 0.41 + rand(rng) * 0.16) % 1;
    const band = (lane * 3 + ring) % 16;
    const offset = i * BASE_FLOATS_PER_INSTANCE;
    base[offset + 0] = x;
    base[offset + 1] = y;
    base[offset + 2] = z;
    base[offset + 3] = size;
    base[offset + 4] = hue;
    base[offset + 5] = density;
    base[offset + 6] = band;
    base[offset + 7] = i / (INSTANCE_COUNT - 1);
  }
  return base;
}

export function computeVoxelPayload({ base, out = new Float32Array(VOXEL_PAYLOAD_BYTES / 4), time = 0, audio = null, seed = 582114, mode = 'demo' } = {}) {
  const features = computeAudioFeatures(audio);
  const scan = fract(time * (0.085 + features.flux * 0.035) + seedHash(seed, 3.0) + features.low * 0.19);
  const corridorOpen = 1 + features.mid * 0.42 + features.onset * 0.35;
  for (let i = 0; i < INSTANCE_COUNT; i += 1) {
    const b = i * BASE_FLOATS_PER_INSTANCE;
    const p = i * PAYLOAD_FLOATS_PER_INSTANCE;
    const x0 = base[b + 0], y0 = base[b + 1], z0 = base[b + 2], size0 = base[b + 3];
    const hue = base[b + 4], density = base[b + 5], bandIndex = base[b + 6] | 0, path = base[b + 7];
    const band = mode === 'flat' ? 0 : bandAt(audio, bandIndex);
    const front = Math.max(0, 1 - Math.abs(path - scan) / 0.095);
    const lanePulse = Math.sin(time * (0.36 + bandIndex * 0.011) + path * 18.0 + seed * 0.0007);
    const radial = corridorOpen + band * 0.36 + front * 0.52;
    out[p + 0] = x0 * radial + Math.sin(time * 0.21 + path * 14) * 0.10;
    out[p + 1] = y0 * (0.94 + features.high * 0.18) + Math.cos(time * 0.18 + path * 11) * 0.08;
    out[p + 2] = z0 + Math.sin(time * 0.16 + path * 9.0) * 0.32 + features.low * 0.7;
    out[p + 3] = size0 * (0.85 + density * 0.5 + band * 0.65 + front * 1.45 + features.onset * 0.35);
    out[p + 4] = hue;
    out[p + 5] = clamp(0.20 + density * 0.55 + band * 0.55 + front * 1.05, 0, 2.2);
    out[p + 6] = front;
    out[p + 7] = band;
    out[p + 8] = lanePulse;
    out[p + 9] = scan;
    out[p + 10] = corridorOpen;
    out[p + 11] = features.flux;
  }
  return out;
}

function summarizePayload(base, payload, time, audio, seed, mode) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let frontCount = 0;
  let tunnelOuter = 0;
  for (let i = 0; i < INSTANCE_COUNT; i += 1) {
    const p = i * PAYLOAD_FLOATS_PER_INSTANCE;
    const radius = Math.hypot(payload[p], payload[p + 1]);
    if (radius > 2.2) tunnelOuter += 1;
    if (payload[p + 6] > 0.35) frontCount += 1;
    const half = payload[p + 3];
    for (let axis = 0; axis < 3; axis += 1) {
      const v = payload[p + axis];
      min[axis] = Math.min(min[axis], v - half);
      max[axis] = Math.max(max[axis], v + half);
    }
  }
  const features = computeAudioFeatures(audio);
  return Object.freeze({
    instanceCount: INSTANCE_COUNT,
    bounds: Object.freeze({ min: min.map((v) => Number(v.toFixed(3))), max: max.map((v) => Number(v.toFixed(3))) }),
    topology: Object.freeze({ coherentCells: INSTANCE_COUNT, frontCount, tunnelOuter, scanPosition: Number(payload[9].toFixed(5)), corridorOpening: Number((1 + features.mid * 0.42 + features.onset * 0.35).toFixed(4)), bounded: true }),
    time, seed, mode,
    audio: Object.freeze({ low: features.low, mid: features.mid, high: features.high, flux: features.flux, onset: features.onset }),
  });
}

export function createNeonVoxelCloudScene({ seed = 582114, mode = 'demo' } = {}) {
  const base = createSeededVoxelBase(seed);
  const payload = new Float32Array(VOXEL_PAYLOAD_BYTES / 4);
  const uniforms = new Float32Array(FRAME_FLOATS);
  const audioPayload = new Float32Array(AUDIO_FLOATS);
  const cube = createVoxelCubeGeometry();
  let lastSummary = null;
  const scene = {
    id: 'neon-voxel-cloud', seed, mode,
    contract: VOXEL_CONTRACT,
    base, payload, cube, uniforms, audioPayload,
    structuralAudioMappings: Object.freeze({
      lowBands: 'topology density and forward camera pressure',
      midBands: 'corridor opening/radius dilation',
      highBands: 'voxel emissive edge hierarchy',
      flux: 'scan-front speed and width',
      onset: 'front shock expansion and cube scale',
    }),
    materialHierarchy: Object.freeze(['deep cyan fog shells', 'green tunnel ribs', 'magenta/amber scan-front cells', 'white emissive leading plane']),
    get lastSummary() { return lastSummary; },
    get lastTime() { return lastSummary?.time ?? 0; },
    get lastAudio() { return lastSummary?.audio ?? null; },
    update({ time = 0, audio = null, width = 1280, height = 720 } = {}) {
      computeVoxelPayload({ base, out: payload, time, audio, seed, mode });
      const features = computeAudioFeatures(audio);
      const aspect = Math.max(0.25, width / Math.max(1, height));
      const proj = new Float32Array(16);
      const view = new Float32Array(16);
      const vp = new Float32Array(16);
      const camZ = 12.5 - features.low * 2.2 + Math.sin(time * 0.12) * 0.35;
      const eye = [Math.sin(time * 0.08 + seed * 0.00001) * (1.6 + features.mid), 1.05 + features.high * 0.6, camZ];
      const center = [0, 0.2, -11.0 - features.low * 4.0];
      makePerspective(proj, Math.PI / 3.1, aspect, 0.08, 90);
      makeLookAt(view, eye, center, [0, 1, 0]);
      multiply4(vp, proj, view);
      uniforms.set(vp, 0);
      uniforms[16] = time; uniforms[17] = seed; uniforms[18] = INSTANCE_COUNT; uniforms[19] = mode === 'flat' ? 0 : 1;
      uniforms[20] = features.low; uniforms[21] = features.mid; uniforms[22] = features.high; uniforms[23] = features.flux;
      uniforms[24] = features.onset; uniforms[25] = width; uniforms[26] = height; uniforms[27] = fract(time * (0.085 + features.flux * 0.035) + seedHash(seed, 3.0) + features.low * 0.19);
      const bands = audio?.bands || audio?.vec4Payload || audio?.rawBands;
      for (let i = 0; i < 16; i += 1) audioPayload[i] = clamp(Number(bands?.[i] || 0), 0, 1);
      audioPayload[16] = features.low; audioPayload[17] = features.mid; audioPayload[18] = features.high; audioPayload[19] = features.flux; audioPayload[20] = features.onset; audioPayload[21] = uniforms[27]; audioPayload[22] = time; audioPayload[23] = seed;
      lastSummary = summarizePayload(base, payload, time, audio, seed, mode);
      return lastSummary;
    },
  };
  scene.update({ time: 0, audio: null });
  return scene;
}

export function voxelByteSignature(sceneOrPayload) {
  const payload = sceneOrPayload?.payload || sceneOrPayload;
  const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
