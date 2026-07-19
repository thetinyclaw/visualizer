import { cathedralMvp, cathedralCamera } from './camera.js';

export const CATHEDRAL_CONTRACT = Object.freeze({
  scene: 'prismatic-cathedral',
  arches: 13,
  shards: 72,
  maxTriangleVertices: 7200,
  maxIndices: 7200,
  corridorHalfWidth: 1.04,
  nearPlaneClearance: 3.25,
  maxShardSize: 0.34,
});

export const UNIFORM_FLOATS = 24; // mvp(16) + camera.xyz/time + flux/onset/mode/pad
export const UNIFORM_BYTES = UNIFORM_FLOATS * 4;
export const AUDIO_FLOATS = 20; // 16 bands + flux/onset/seq/mode
export const AUDIO_BYTES = AUDIO_FLOATS * 4;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoBands(out, time, seed, mode) {
  if (mode === 'flat') { out.fill(0); return out; }
  const pulse = (i) => 0.5 + 0.5 * Math.sin(time * (0.55 + i * 0.071) + i * 1.91 + seed * 0.00013);
  for (let i = 0; i < 16; i += 1) {
    out[i] = 0.04
      + 0.62 * Math.exp(-((i - (2 + pulse(1) * 2)) ** 2) / (1.7 ** 2))
      + 0.45 * Math.exp(-((i - (7 + pulse(3) * 4)) ** 2) / (2.2 ** 2))
      + 0.28 * Math.exp(-((i - (12 + pulse(5) * 3)) ** 2) / (1.9 ** 2));
  }
  return out;
}

function summarize(mesh) {
  const b = mesh.bounds;
  return Object.freeze({
    vertexCount: mesh.vertexCount,
    indexCount: mesh.indexCount,
    triangleCount: mesh.indexCount / 3,
    archCount: CATHEDRAL_CONTRACT.arches,
    shardCount: CATHEDRAL_CONTRACT.shards,
    bounds: Object.freeze({ minX: +b.minX.toFixed(3), maxX: +b.maxX.toFixed(3), minY: +b.minY.toFixed(3), maxY: +b.maxY.toFixed(3), minZ: +b.minZ.toFixed(3), maxZ: +b.maxZ.toFixed(3) }),
    width: +(b.maxX - b.minX).toFixed(3),
    height: +(b.maxY - b.minY).toFixed(3),
    depth: +(b.maxZ - b.minZ).toFixed(3),
  });
}

function makeMesh() {
  return {
    positions: new Float32Array(CATHEDRAL_CONTRACT.maxTriangleVertices * 3),
    colors: new Float32Array(CATHEDRAL_CONTRACT.maxTriangleVertices * 4),
    indices: new Uint32Array(CATHEDRAL_CONTRACT.maxIndices),
    uniforms: new Float32Array(UNIFORM_FLOATS),
    audioPayload: new Float32Array(AUDIO_FLOATS),
    vertexCount: 0,
    indexCount: 0,
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    reset() {
      this.vertexCount = 0; this.indexCount = 0;
      this.bounds.minX = Infinity; this.bounds.minY = Infinity; this.bounds.minZ = Infinity;
      this.bounds.maxX = -Infinity; this.bounds.maxY = -Infinity; this.bounds.maxZ = -Infinity;
    },
  };
}

function pushVertex(mesh, x, y, z, color) {
  const v = mesh.vertexCount;
  if (v >= CATHEDRAL_CONTRACT.maxTriangleVertices) throw new Error('Prismatic Cathedral mesh exceeded 7200 triangle vertices.');
  const p = v * 3; const q = v * 4;
  mesh.positions[p] = x; mesh.positions[p + 1] = y; mesh.positions[p + 2] = z;
  mesh.colors[q] = color[0]; mesh.colors[q + 1] = color[1]; mesh.colors[q + 2] = color[2]; mesh.colors[q + 3] = color[3];
  mesh.indices[mesh.indexCount] = v;
  mesh.vertexCount += 1; mesh.indexCount += 1;
  if (x < mesh.bounds.minX) mesh.bounds.minX = x; if (x > mesh.bounds.maxX) mesh.bounds.maxX = x;
  if (y < mesh.bounds.minY) mesh.bounds.minY = y; if (y > mesh.bounds.maxY) mesh.bounds.maxY = y;
  if (z < mesh.bounds.minZ) mesh.bounds.minZ = z; if (z > mesh.bounds.maxZ) mesh.bounds.maxZ = z;
}

function addRibbon(mesh, ax, ay, az, bx, by, bz, width, color) {
  const dx = bx - ax; const dy = by - ay; const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l * width; const ny = dx / l * width;
  pushVertex(mesh, ax + nx, ay + ny, az, color); pushVertex(mesh, ax - nx, ay - ny, az, color); pushVertex(mesh, bx + nx, by + ny, bz, color);
  pushVertex(mesh, ax - nx, ay - ny, az, color); pushVertex(mesh, bx - nx, by - ny, bz, color); pushVertex(mesh, bx + nx, by + ny, bz, color);
}

function addArch(mesh, x, y, z, w, h, top, thick, color) {
  addRibbon(mesh, x - w, y, z, x - w, y + h, z, thick, color);
  addRibbon(mesh, x + w, y, z, x + w, y + h, z, thick, color);
  const steps = 13;
  for (let i = 0; i < steps; i += 1) {
    const a = Math.PI * (i / steps); const b = Math.PI * ((i + 1) / steps);
    addRibbon(mesh, x + Math.cos(a) * w, y + h + Math.sin(a) * top * 0.34, z, x + Math.cos(b) * w, y + h + Math.sin(b) * top * 0.34, z, thick, color);
  }
}

function addBeam(mesh, x1, y1, z1, x2, y2, z2, w, c) { addRibbon(mesh, x1, y1, z1, x2, y2, z2, w, c); }

function addShard(mesh, x, y, z, s, r, color) {
  const cr = Math.cos(r); const sr = Math.sin(r);
  const base = [[0, s * 1.85, 0], [-s * 0.86, -s * 0.96, -s * 0.18], [s * 0.86, -s * 0.88, s * 0.16], [0, 0, s * 1.72], [0, 0, -s * 1.42], [-s * 0.34, s * 0.18, s * 0.46], [s * 0.28, s * 0.12, -s * 0.52]];
  const faces = [[0, 1, 3], [0, 3, 2], [0, 4, 1], [0, 2, 4], [1, 5, 3], [2, 3, 6], [1, 4, 5], [2, 6, 4], [5, 4, 6], [5, 6, 3]];
  for (const f of faces) {
    for (const idx of f) {
      const p = base[idx];
      pushVertex(mesh, x + p[0] * cr - p[2] * sr, y + p[1], z + p[0] * sr + p[2] * cr, color);
    }
  }
}

function addFloorRunes(mesh, time, bands, flux) {
  for (let i = 0; i < 30; i += 1) {
    const z = 1.15 - i * (0.255 + flux * 0.018);
    const w = 0.32 + i * 0.038 + (bands[(i + 3) % 16] || 0) * 0.035;
    const a = 0.12 + (bands[i % 16] || 0) * 0.11;
    const y = -0.98 - 0.018 * Math.sin(time + i);
    addBeam(mesh, -w, y, z, w, y, z - 0.10, 0.012, [0.18, 0.72, 1, a]);
    addBeam(mesh, -w * 0.65, y - 0.035, z - 0.08, w * 0.65, y - 0.035, z - 0.17, 0.008, [0.95, 0.54, 1, a * 0.55]);
  }
}

function audioSnapshotFrom(mode, time, seed, audio) {
  const bands = new Float32Array(16);
  if (audio?.bands || audio?.envelopedBands) bands.set((audio.bands || audio.envelopedBands).subarray(0, 16));
  else demoBands(bands, time, seed, mode);
  const flux = mode === 'flat' ? 0 : (audio?.positiveSpectralFlux ?? (0.04 + 0.05 * Math.max(0, Math.sin(time * 0.7))));
  const onset = mode === 'flat' ? 0 : (audio?.onsetImpulse ?? Math.max(0, Math.sin(time * 1.7 + seed * 0.001)) * 0.35);
  return { bands, flux, onset, sequence: audio?.sequence || 0 };
}

export function createPrismaticCathedralScene({ seed = 491009, mode = 'demo' } = {}) {
  const rand = mulberry32(seed);
  const arches = Array.from({ length: CATHEDRAL_CONTRACT.arches }, (_, i) => ({ z: 1.55 - i * 0.46, bin: i % 16, skew: (rand() - 0.5) * 0.12, glow: rand() }));
  const shards = Array.from({ length: CATHEDRAL_CONTRACT.shards }, (_, i) => {
    const side = i % 2 ? -1 : 1; const lane = i % 3;
    const depth = 1.65 - rand() * 6.7;
    const wall = 1.08 + rand() * 0.70 + lane * 0.13;
    return { x: side * wall + (rand() - 0.5) * 0.16, y: -0.62 + rand() * 2.08, z: depth, s: 0.064 + rand() * 0.155, r: rand() * 6.28, bin: i % 16, side, lane };
  });
  const mesh = makeMesh();
  const state = {
    id: 'prismatic-cathedral', seed, mode, contract: CATHEDRAL_CONTRACT,
    topology: '13 arch corridor ribs plus 72 persistent real 3D prismatic shard meshes, depth-tested floor runes/reflections, central traversable void',
    materialHierarchy: 'emissive cyan edge ribs, magenta/white shard cores, dim reflection hierarchy; alpha is material-layer signal, not screen exposure',
    structuralAudioMappings: Object.freeze(['bands→individual shard scale/rotation/spacing', 'flux→corridor travel and camera pressure', 'onset→arch thickness/core glow']),
    arches, shards, mesh, lastSummary: null, lastTime: 0, lastAudio: null,
    update({ time = 0, audio = null, width = 1280, height = 720 } = {}) {
      const t = Number(time) || 0;
      const packet = audioSnapshotFrom(mode, t, seed, audio);
      const bands = packet.bands; const flux = packet.flux; const onset = packet.onset;
      mesh.reset();
      for (const a of arches) {
        const travelSpeed = 0.28 + (bands[1] || 0) * 0.12 + flux * 0.08;
        const z = ((a.z + t * travelSpeed + 4.7) % 6.25) - 4.7;
        const pulseA = 0.55 + (bands[a.bin] || 0) * 0.45 + onset * 0.20;
        const edge = [0.70, 0.93, 1, 0.58 + 0.22 * pulseA];
        const core = [1, 0.62 + (bands[a.bin] || 0) * 0.25, 0.96, 0.27 + 0.18 * pulseA];
        addArch(mesh, a.skew, 0.00, z, 1.33, 0.58, 2.45, 0.040 + 0.018 * (bands[a.bin] || 0) + onset * 0.008, edge);
        addArch(mesh, a.skew, -0.015, z - 0.05, 1.08, 0.44, 2.05, 0.017, core);
        addBeam(mesh, -0.68, 0.82, z, 0.68, 0.82, z - 0.16, 0.024, core);
        addBeam(mesh, 0.68, 0.82, z, -0.68, 0.82, z - 0.16, 0.024, core);
      }
      for (const sh of shards) {
        const band = bands[sh.bin] || 0;
        const travel = ((sh.z + t * (0.30 + band * 0.16 + flux * 0.10) + 4.95) % 6.85) - 4.95;
        const wallPush = 0.07 * Math.sin(t * 0.45 + sh.bin) + flux * 0.06 * sh.side;
        const spacing = 1 + (bands[(sh.bin + 5) % 16] || 0) * 0.035;
        const depthGlow = 1 - Math.max(0, Math.min(1, (travel + 4.95) / 6.85));
        const highTrim = sh.y > 1.02 ? 0.76 : 1;
        const size = Math.min(CATHEDRAL_CONTRACT.maxShardSize, sh.s * (1.18 + band * 0.52 + onset * 0.18) * (sh.lane === 2 ? 0.82 : 1) * highTrim);
        const alpha = 0.30 + band * 0.27 + depthGlow * 0.16;
        addShard(mesh, sh.x * spacing + sh.side * wallPush, sh.y, travel, size, sh.r + t * (0.10 + band * 0.10 + flux * 0.06), [0.66 + band * 0.28, 0.86, 0.99, alpha]);
        addShard(mesh, sh.x * 0.92 * spacing, -1.20 - (sh.y + 0.6) * 0.05, travel - 0.04, size * 0.54, -sh.r + t * 0.04, [0.48, 0.38 + 0.32 * band, 1, alpha * 0.25]);
      }
      addFloorRunes(mesh, t, bands, flux);
      cathedralMvp(mesh.uniforms.subarray(0, 16), { width, height, time: t, audio: { bands, positiveSpectralFlux: flux, onsetImpulse: onset } });
      const cam = cathedralCamera(new Float32Array(3), t, { bands, positiveSpectralFlux: flux, onsetImpulse: onset });
      mesh.uniforms[16] = cam[0]; mesh.uniforms[17] = cam[1]; mesh.uniforms[18] = cam[2]; mesh.uniforms[19] = t;
      mesh.uniforms[20] = flux; mesh.uniforms[21] = onset; mesh.uniforms[22] = mode === 'flat' ? 0 : 1; mesh.uniforms[23] = 0;
      mesh.audioPayload.set(bands, 0); mesh.audioPayload[16] = flux; mesh.audioPayload[17] = onset; mesh.audioPayload[18] = packet.sequence; mesh.audioPayload[19] = mesh.uniforms[22];
      this.lastTime = t; this.lastAudio = { flux, onset, source: audio?.source || mode };
      this.lastSummary = summarize(mesh);
      return this.lastSummary;
    },
  };
  state.update({ time: 0 });
  return state;
}

export function sceneByteSignature(scene) {
  const mesh = scene.mesh;
  const p = new Uint8Array(mesh.positions.buffer, 0, mesh.vertexCount * 3 * 4);
  const c = new Uint8Array(mesh.colors.buffer, 0, mesh.vertexCount * 4 * 4);
  const ix = new Uint8Array(mesh.indices.buffer, 0, mesh.indexCount * 4);
  const out = new Uint8Array(p.byteLength + c.byteLength + ix.byteLength);
  out.set(p, 0); out.set(c, p.byteLength); out.set(ix, p.byteLength + c.byteLength);
  return out;
}
