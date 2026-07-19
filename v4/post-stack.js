// Reusable bounded single-pass bloom + tone-map stage for native-density v4 scenes.

const FRAGMENT_STAGE = globalThis.GPUShaderStage?.FRAGMENT ?? 0x2;

export const BOUNDED_BLOOM_TAP_COUNT = 9;

export const BOUNDED_POST_WGSL = /* wgsl */ `
struct FullscreenOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

@vertex fn fullscreenVs(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOut {
  var positions = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let p = positions[vertexIndex];
  var out: FullscreenOut;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = p * vec2f(0.5, -0.5) + vec2f(0.5);
  return out;
}

fn bloomHighlight(uv: vec2f) -> vec3f {
  let color = textureSample(sourceTexture, sourceSampler, uv).rgb;
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let bloomThreshold = 0.72;
  let contribution = max(luminance - bloomThreshold, 0.0) / max(luminance, 0.0001);
  return color * contribution;
}

fn acesToneMap(color: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + vec3f(b))) / (color * (c * color + vec3f(d)) + vec3f(e)), vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(color: vec3f) -> vec3f {
  let low = color * 12.92;
  let high = 1.055 * pow(max(color, vec3f(0.0)), vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(high, low, color <= vec3f(0.0031308));
}

@fragment fn postFs(in: FullscreenOut) -> @location(0) vec4f {
  let dimensions = vec2f(textureDimensions(sourceTexture));
  let texel = vec2f(1.0) / max(dimensions, vec2f(1.0));
  let diagonal = texel * 1.41421356;
  var bloom = bloomHighlight(in.uv) * 0.20;
  bloom += bloomHighlight(in.uv + vec2f(texel.x, 0.0)) * 0.12;
  bloom += bloomHighlight(in.uv - vec2f(texel.x, 0.0)) * 0.12;
  bloom += bloomHighlight(in.uv + vec2f(0.0, texel.y)) * 0.12;
  bloom += bloomHighlight(in.uv - vec2f(0.0, texel.y)) * 0.12;
  bloom += bloomHighlight(in.uv + vec2f(diagonal.x, diagonal.y)) * 0.08;
  bloom += bloomHighlight(in.uv + vec2f(diagonal.x, -diagonal.y)) * 0.08;
  bloom += bloomHighlight(in.uv + vec2f(-diagonal.x, diagonal.y)) * 0.08;
  bloom += bloomHighlight(in.uv - diagonal) * 0.08;
  let base = textureSample(sourceTexture, sourceSampler, in.uv).rgb;
  let mapped = acesToneMap(max(base + bloom * 0.65, vec3f(0.0)));
  return vec4f(linearToSrgb(mapped), 1.0);
}
`;

export function createBoundedPostPipeline({ device, format = 'bgra8unorm' } = {}) {
  if (!device || typeof device.createShaderModule !== 'function' || typeof device.createRenderPipeline !== 'function') {
    throw new TypeError('createBoundedPostPipeline requires a GPUDevice-compatible object.');
  }
  const shader = device.createShaderModule({ label: 'v4-bounded-bloom-tonemap-wgsl', code: BOUNDED_POST_WGSL });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'v4-bounded-post-source-layout',
    entries: [
      { binding: 0, visibility: FRAGMENT_STAGE, sampler: { type: 'filtering' } },
      { binding: 1, visibility: FRAGMENT_STAGE, texture: { sampleType: 'float', viewDimension: '2d' } },
    ],
  });
  const layout = device.createPipelineLayout({ label: 'v4-bounded-post-pipeline-layout', bindGroupLayouts: [bindGroupLayout] });
  return device.createRenderPipeline({
    label: 'v4-bounded-bloom-tonemap-pipeline',
    layout,
    vertex: { module: shader, entryPoint: 'fullscreenVs' },
    fragment: { module: shader, entryPoint: 'postFs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
}
