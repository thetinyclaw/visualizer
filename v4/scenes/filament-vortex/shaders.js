export const filamentVortexWgsl = /* wgsl */`
const STRAND_COUNT : u32 = 118u;
const SEGMENT_COUNT : u32 = 52u;
const SEGMENTS_PER_STRAND : u32 = 51u;
const NODE_COUNT : u32 = 6136u;
const DRAW_VERTICES : u32 = 36108u;
const TAU : f32 = 6.28318530718;

struct FrameUniforms {
  params0 : vec4<f32>, // time, dt, seed, mode(0 locked, 1 live)
  params1 : vec4<f32>, // frameIndex, width, height, generation
  params2 : vec4<f32>, // bass, lowMid, highMid, treble
  params3 : vec4<f32>, // flux, onset, flatFlag, flowScale
  camera : vec4<f32>,  // x, y, zoom, roll
};
@group(0) @binding(0) var<uniform> uFrame : FrameUniforms;
@group(0) @binding(1) var<uniform> uBands : array<vec4<f32>, 4>;
@group(0) @binding(2) var<storage, read_write> positions : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities : array<vec4<f32>>;

fn hash11(n : f32) -> f32 { return fract(sin(n) * 43758.5453123); }
fn bandAt(i : u32) -> f32 {
  let g = i / 4u; let c = i % 4u;
  let v = uBands[g];
  if (c == 0u) { return v.x; }
  if (c == 1u) { return v.y; }
  if (c == 2u) { return v.z; }
  return v.w;
}
fn basePosition(strand : u32, segment : u32, t : f32) -> vec3<f32> {
  let sf = f32(strand); let uf = f32(segment) / f32(SEGMENT_COUNT - 1u);
  let seed = uFrame.params0.z;
  let bass = uFrame.params2.x; let lowMid = uFrame.params2.y; let highMid = uFrame.params2.z; let treble = uFrame.params2.w;
  let lane = sf / f32(STRAND_COUNT);
  let owner = bandAt(u32(floor(fract(lane + seed * 0.000019) * 16.0)));
  let bundle = floor(sf / 6.0);
  let h = hash11(sf * 17.31 + seed * 0.113);
  let bundleH = hash11(bundle * 41.7 + seed * 0.07);
  let spacing = 0.010 + bass * 0.020 + owner * 0.014 + treble * 0.004;
  let radiusBase = 0.06 + uf * (1.02 + bass * 0.16) + (h - 0.5) * spacing * 10.0;
  let twist = 2.8 + lowMid * 2.4 - treble * 0.55 + bundleH * 0.8;
  let flow = t * (0.11 + lowMid * 0.40 + uFrame.params3.x * 0.18) * uFrame.params3.w;
  let angle0 = lane * TAU + (bundleH - 0.5) * 0.42;
  let curl = angle0 + log(radiusBase + 0.035) * twist - flow * (0.8 + uf * 1.8);
  let fray = sin(uf * 18.0 + sf * 0.17 + t * (0.24 + highMid)) * (0.010 + treble * 0.026);
  let x = cos(curl) * (radiusBase + fray) + sin(uf * 8.0 + bundleH * TAU) * spacing * (0.9 + highMid);
  let y = sin(curl) * (radiusBase + fray) + cos(uf * 7.0 + h * TAU) * spacing * (0.75 + treble);
  let z = -0.65 + uf * 1.25 + sin(curl * 1.7 + t * 0.13 + sf) * (0.045 + highMid * 0.08);
  return vec3<f32>(x, y, z);
}
fn curlStep(p : vec3<f32>, strand : u32, t : f32) -> vec3<f32> {
  let bass = uFrame.params2.x; let lowMid = uFrame.params2.y; let treble = uFrame.params2.w;
  let a = atan2(p.y, p.x);
  let r = max(length(p.xy), 0.035);
  let tangent = vec2<f32>(-p.y, p.x) / r;
  let inward = -normalize(p.xy) * (0.010 + bass * 0.018);
  let swirl = tangent * (0.028 + lowMid * 0.060 + uFrame.params3.x * 0.030);
  let ripple = vec2<f32>(sin(a * 5.0 + t + f32(strand) * 0.11), cos(a * 3.0 - t * 0.7)) * treble * 0.010;
  return vec3<f32>(swirl + inward + ripple, sin(t * 0.3 + f32(strand)) * 0.004);
}
@compute @workgroup_size(64)
fn csSimulate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= NODE_COUNT) { return; }
  let strand = idx / SEGMENT_COUNT;
  let segment = idx % SEGMENT_COUNT;
  let t = uFrame.params0.x;
  let dt = clamp(uFrame.params0.y, 0.0, 0.05);
  let live = uFrame.params0.w > 0.5;
  let frameIndex = u32(uFrame.params1.x);
  let absolute = basePosition(strand, segment, t);
  if (!live || frameIndex == 0u) {
    positions[idx] = vec4<f32>(absolute, 1.0);
    velocities[idx] = vec4<f32>(curlStep(absolute, strand, t), 0.0);
    return;
  }
  let prev = positions[idx].xyz;
  let v = mix(velocities[idx].xyz, curlStep(prev, strand, t), 0.25);
  let target = absolute;
  let settled = prev + v * dt * 60.0;
  positions[idx] = vec4<f32>(mix(settled, target, 0.018), 1.0);
  velocities[idx] = vec4<f32>(v, 0.0);
}

@group(1) @binding(0) var<uniform> uRender : FrameUniforms;
@group(1) @binding(1) var<uniform> rBands : array<vec4<f32>, 4>;
@group(1) @binding(2) var<storage, read> rPositions : array<vec4<f32>>;
@group(1) @binding(3) var uLinearSampler : sampler;
@group(1) @binding(4) var uInputTexture : texture_2d<f32>;
struct VOut { @builtin(position) clip : vec4<f32>, @location(0) color : vec4<f32>, @location(1) glow : f32, @location(2) uv : vec2<f32> };
fn project(p : vec3<f32>) -> vec4<f32> {
  let bass = uRender.params2.x; let onset = uRender.params3.y;
  let roll = uRender.camera.w + onset * 0.045;
  let cr = cos(roll); let sr = sin(roll);
  let q = vec2<f32>(p.x * cr - p.y * sr, p.x * sr + p.y * cr) + uRender.camera.xy;
  let persp = uRender.camera.z / (1.72 + p.z * 0.42 + bass * 0.10);
  let aspect = max(uRender.params1.y / max(uRender.params1.z, 1.0), 0.25);
  return vec4<f32>(q.x * persp / aspect, q.y * persp, 0.52 - p.z * 0.18, 1.0);
}
@vertex
fn vsStrand(@builtin(vertex_index) vid : u32) -> VOut {
  let triVertex = vid % 6u;
  let quad = vid / 6u;
  let strand = quad / SEGMENTS_PER_STRAND;
  let seg = quad % SEGMENTS_PER_STRAND;
  let useNext = triVertex == 1u || triVertex == 2u || triVertex == 4u;
  let sideSign = select(-1.0, 1.0, triVertex == 2u || triVertex == 3u || triVertex == 4u);
  let idx0 = strand * SEGMENT_COUNT + seg;
  let idx1 = idx0 + 1u;
  let p0 = rPositions[idx0].xyz;
  let p1 = rPositions[idx1].xyz;
  let p = select(p0, p1, useNext);
  let c0 = project(p0); let c1 = project(p1);
  let tangent = normalize((c1.xy / c1.w) - (c0.xy / c0.w) + vec2<f32>(0.0001, 0.0));
  let normal = vec2<f32>(-tangent.y, tangent.x);
  let owner = rBands[(strand / 8u) % 4u][strand % 4u];
  let width = (0.0022 + owner * 0.0024 + uRender.params2.x * 0.0018 + uRender.params2.w * 0.0012) * (1.25 - f32(seg) / f32(SEGMENTS_PER_STRAND) * 0.45);
  var clip = project(p);
  clip.xy += normal * sideSign * width * clip.w;
  var out : VOut;
  out.clip = clip;
  let lane = f32(strand) / f32(STRAND_COUNT);
  let pearl = vec3<f32>(0.78 + owner * 0.22, 0.86 + uRender.params2.z * 0.18, 1.0);
  let violet = vec3<f32>(0.22, 0.18, 0.42) * (0.4 + uRender.params2.y);
  let alpha = 0.16 + owner * 0.20 + uRender.params3.x * 0.10;
  out.color = vec4<f32>(mix(violet, pearl, 0.55 + 0.45 * sin(lane * TAU + f32(seg) * 0.2)), alpha);
  out.glow = 1.0 - f32(seg) / f32(SEGMENTS_PER_STRAND);
  out.uv = vec2<f32>(lane, f32(seg) / f32(SEGMENTS_PER_STRAND));
  return out;
}
@fragment
fn fsStrand(input : VOut) -> @location(0) vec4<f32> {
  let core = input.color.rgb * (0.82 + input.glow * 0.70 + uRender.params3.y * 0.55);
  return vec4<f32>(core, input.color.a);
}
struct FullscreenOut { @builtin(position) clip : vec4<f32>, @location(0) uv : vec2<f32> };
@vertex
fn vsFullscreen(@builtin(vertex_index) vertexIndex : u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0));
  var out : FullscreenOut; out.clip = vec4<f32>(pos[vertexIndex], 0.0, 1.0); out.uv = 0.5 * (pos[vertexIndex] + vec2<f32>(1.0)); return out;
}
@fragment
fn fsPost(input : FullscreenOut) -> @location(0) vec4<f32> {
  let src = textureSample(uInputTexture, uLinearSampler, input.uv).rgb;
  let vignette = smoothstep(0.92, 0.10, distance(input.uv, vec2<f32>(0.5,0.52)));
  let bloom = max(max(src.r, src.g), src.b);
  return vec4<f32>(src * (0.92 + bloom * 0.38) + vec3<f32>(0.004,0.008,0.025) * vignette, 1.0);
}
@fragment
fn fsComposite(input : FullscreenOut) -> @location(0) vec4<f32> {
  let src = textureSample(uInputTexture, uLinearSampler, input.uv).rgb;
  let vignette = smoothstep(1.10, 0.05, distance(input.uv, vec2<f32>(0.5,0.52)));
  let grain = fract(sin(dot(input.uv * uRender.params1.yz, vec2<f32>(12.9898,78.233))) * 43758.5453) * 0.012;
  return vec4<f32>(pow(src * (0.88 + 0.26 * vignette) + grain, vec3<f32>(0.90)), 1.0);
}
`;
