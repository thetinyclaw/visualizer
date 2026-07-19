struct Frame {
  viewProj: mat4x4<f32>,
  time: f32,
  seed: f32,
  instanceCount: f32,
  mode: f32,
  low: f32,
  mid: f32,
  high: f32,
  flux: f32,
  onset: f32,
  width: f32,
  height: f32,
  scan: f32,
};

struct AudioPayload {
  bands0: vec4<f32>,
  bands1: vec4<f32>,
  bands2: vec4<f32>,
  bands3: vec4<f32>,
  features0: vec4<f32>,
  features1: vec4<f32>,
};

struct BaseCell {
  position_size: vec4<f32>,
  hue_density_band_path: vec4<f32>,
};

struct InstancePayload {
  position_size: vec4<f32>,
  material: vec4<f32>,
  motion: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> audio: AudioPayload;
@group(0) @binding(2) var<storage, read> baseCells: array<BaseCell>;
@group(0) @binding(3) var<storage, read> payloadRead: array<InstancePayload>;
@group(0) @binding(4) var sceneSampler: sampler;
@group(0) @binding(5) var sceneTexture: texture_2d<f32>;
@group(0) @binding(6) var<storage, read_write> payloadWrite: array<InstancePayload>;

fn fract1(v: f32) -> f32 { return v - floor(v); }
fn bandValue(index: u32) -> f32 {
  if (index < 4u) { return audio.bands0[index]; }
  if (index < 8u) { return audio.bands1[index - 4u]; }
  if (index < 12u) { return audio.bands2[index - 8u]; }
  return audio.bands3[index - 12u];
}
fn hueToRgb(h: f32) -> vec3<f32> {
  let r = abs(fract1(h + 1.0) * 6.0 - 3.0) - 1.0;
  let g = 2.0 - abs(fract1(h + 0.6666667) * 6.0 - 3.0);
  let b = 2.0 - abs(fract1(h + 0.3333333) * 6.0 - 3.0);
  return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

@compute @workgroup_size(64)
fn csVoxel(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= 260u) { return; }
  let base = baseCells[i];
  let pos0 = base.position_size.xyz;
  let size0 = base.position_size.w;
  let hue = base.hue_density_band_path.x;
  let density = base.hue_density_band_path.y;
  let bandIndex = u32(base.hue_density_band_path.z) & 15u;
  let path = base.hue_density_band_path.w;
  let band = select(0.0, bandValue(bandIndex), frame.mode > 0.5);
  let scan = fract1(frame.time * (0.085 + frame.flux * 0.035) + frame.scan);
  let front = max(0.0, 1.0 - abs(path - scan) / 0.095);
  let corridorOpen = 1.0 + frame.mid * 0.42 + frame.onset * 0.35;
  let pulse = sin(frame.time * (0.36 + f32(bandIndex) * 0.011) + path * 18.0 + frame.seed * 0.0007);
  let radial = corridorOpen + band * 0.36 + front * 0.52;
  let pos = vec3<f32>(
    pos0.x * radial + sin(frame.time * 0.21 + path * 14.0) * 0.10,
    pos0.y * (0.94 + frame.high * 0.18) + cos(frame.time * 0.18 + path * 11.0) * 0.08,
    pos0.z + sin(frame.time * 0.16 + path * 9.0) * 0.32 + frame.low * 0.7
  );
  let scale = size0 * (0.85 + density * 0.5 + band * 0.65 + front * 1.45 + frame.onset * 0.35);
  payloadWrite[i].position_size = vec4<f32>(pos, scale);
  payloadWrite[i].material = vec4<f32>(hue, clamp(0.20 + density * 0.55 + band * 0.55 + front * 1.05, 0.0, 2.2), front, band);
  payloadWrite[i].motion = vec4<f32>(pulse, scan, corridorOpen, frame.flux);
}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) local: vec3<f32>,
  @location(2) fog: f32,
};

@vertex
fn vsVoxel(@location(0) cube: vec3<f32>, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let payload = payloadRead[instanceIndex];
  let material = payload.material;
  let motion = payload.motion;
  let yaw = motion.x * 0.26 + material.z * 0.72;
  let c = cos(yaw);
  let s = sin(yaw);
  let rotated = vec3<f32>(cube.x * c - cube.z * s, cube.y, cube.x * s + cube.z * c);
  let p = payload.position_size.xyz + rotated * payload.position_size.w;
  var out: VertexOut;
  out.position = frame.viewProj * vec4<f32>(p, 1.0);
  let rgb = mix(hueToRgb(material.x) * vec3<f32>(0.15, 0.95, 1.15), vec3<f32>(1.0, 0.28, 0.95), smoothstep(0.35, 1.0, material.z));
  let edge = 0.58 + material.w * 0.65 + material.z * 1.8;
  out.color = vec4<f32>(rgb * edge * material.y, clamp(0.38 + material.y * 0.24 + material.z * 0.30, 0.2, 1.0));
  out.local = cube;
  out.fog = clamp((-p.z - 3.0) / 30.0, 0.0, 1.0);
  return out;
}

@fragment
fn fsVoxel(in: VertexOut) -> @location(0) vec4<f32> {
  let face = max(max(abs(in.local.x), abs(in.local.y)), abs(in.local.z));
  let edge = smoothstep(0.62, 1.0, face);
  let scanLines = pow(max(0.0, 1.0 - abs(fract1((in.local.y + 1.0) * 6.0 + frame.time * 1.6) - 0.5) * 2.0), 7.0);
  let core = in.color.rgb * (0.28 + edge * 0.94 + scanLines * 0.32);
  let fog = vec3<f32>(0.01, 0.035, 0.085) * in.fog;
  return vec4<f32>(core + fog, in.color.a);
}

struct FullscreenOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vsFullscreen(@builtin(vertex_index) index: u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  var out: FullscreenOut;
  out.position = vec4<f32>(pos[index], 0.0, 1.0);
  out.uv = pos[index] * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fsPost(in: FullscreenOut) -> @location(0) vec4<f32> {
  let color = textureSample(sceneTexture, sceneSampler, in.uv).rgb;
  let vignette = smoothstep(0.92, 0.28, distance(in.uv, vec2<f32>(0.5)));
  let scanPlane = pow(max(0.0, 1.0 - abs(in.uv.y - frame.scan) / 0.018), 3.0);
  let glow = vec3<f32>(0.05, 0.95, 0.36) * scanPlane * (0.35 + frame.flux * 0.9);
  let graded = color / (vec3<f32>(1.0) + color * 0.68);
  return vec4<f32>(graded * vignette + glow, 1.0);
}

@fragment
fn fsComposite(in: FullscreenOut) -> @location(0) vec4<f32> {
  let color = textureSample(sceneTexture, sceneSampler, in.uv).rgb;
  let line = pow(max(0.0, 1.0 - abs(fract1(in.uv.y * 92.0 + frame.time * 0.2) - 0.5) * 2.0), 9.0);
  let chroma = vec3<f32>(color.r * 1.05 + line * 0.012, color.g * 1.02 + line * 0.018, color.b * 1.10 + line * 0.030);
  return vec4<f32>(pow(chroma, vec3<f32>(0.92)), 1.0);
}
