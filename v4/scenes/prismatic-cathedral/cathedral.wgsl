// Reference WGSL source mirrored by shaders.js for no-build browser imports.
// See v4/scenes/prismatic-cathedral/shaders.js for the executable string export.
struct SceneUniforms {
  mvp : mat4x4<f32>,
  camera_time : vec4<f32>,
  flux_onset_mode_pad : vec4<f32>,
};
@group(0) @binding(0) var<uniform> uScene : SceneUniforms;
@group(0) @binding(1) var<uniform> uAudio : array<vec4<f32>, 5>;
