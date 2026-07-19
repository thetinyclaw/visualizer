export const cathedralWgsl = /* wgsl */`
struct SceneUniforms {
  mvp : mat4x4<f32>,
  camera_time : vec4<f32>,
  flux_onset_mode_pad : vec4<f32>,
};

@group(0) @binding(0) var<uniform> uScene : SceneUniforms;
@group(0) @binding(1) var<uniform> uAudio : array<vec4<f32>, 5>;
@group(0) @binding(2) var uLinearSampler : sampler;
@group(0) @binding(3) var uInputTexture : texture_2d<f32>;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) color : vec4<f32>,
};

struct VertexOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) depthGlow : f32,
};

@vertex
fn vsCathedral(input : VertexIn) -> VertexOut {
  var out : VertexOut;
  out.clip = uScene.mvp * vec4<f32>(input.position, 1.0);
  let travelGlow = clamp((1.5 - input.position.z) / 7.0, 0.0, 1.0);
  let onset = uScene.flux_onset_mode_pad.y;
  out.depthGlow = travelGlow + onset * 0.18;
  out.color = input.color;
  return out;
}

@fragment
fn fsCathedral(input : VertexOut) -> @location(0) vec4<f32> {
  let flux = uScene.flux_onset_mode_pad.x;
  let core = input.color.rgb * (0.52 + input.depthGlow * 0.78 + flux * 0.35);
  let edge = vec3<f32>(0.50, 0.88, 1.0) * input.depthGlow * input.color.a;
  return vec4<f32>(core + edge, clamp(input.color.a, 0.10, 0.98));
}

struct FullscreenOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsFullscreen(@builtin(vertex_index) vertexIndex : u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out : FullscreenOut;
  out.clip = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = 0.5 * (pos[vertexIndex] + vec2<f32>(1.0));
  return out;
}

@fragment
fn fsPost(input : FullscreenOut) -> @location(0) vec4<f32> {
  let src = textureSample(uInputTexture, uLinearSampler, input.uv).rgb;
  let flux = uScene.flux_onset_mode_pad.x;
  let vignette = smoothstep(1.15, 0.12, distance(input.uv, vec2<f32>(0.5, 0.52)));
  let bloom = max(max(src.r, src.g), src.b);
  let toned = src * (1.0 + bloom * 0.28 + flux * 0.20) + vec3<f32>(0.01, 0.02, 0.05) * vignette;
  return vec4<f32>(toned, 1.0);
}

@fragment
fn fsComposite(input : FullscreenOut) -> @location(0) vec4<f32> {
  let src = textureSample(uInputTexture, uLinearSampler, input.uv).rgb;
  let vignette = smoothstep(1.22, 0.06, distance(input.uv, vec2<f32>(0.5, 0.52)));
  let flux = uScene.flux_onset_mode_pad.x;
  let base = vec3<f32>(0.004, 0.007, 0.018) + src * (0.86 + 0.22 * vignette) + flux * vec3<f32>(0.03, 0.01, 0.05);
  return vec4<f32>(pow(base, vec3<f32>(0.92)), 1.0);
}
`;
