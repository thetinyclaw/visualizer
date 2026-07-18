(() => {
  'use strict';

  const vertexSource = `
    attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }
  `;

  const commonFragmentSource = `
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    uniform float seed;
    uniform vec4 fftBinsA;
    uniform vec4 fftBinsB;
    uniform vec4 fftBinsC;
    uniform vec4 fftBinsD;

    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    float hash21(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec2 hash22(vec2 p) {
      float n = hash21(p);
      return vec2(n, hash21(p + n + 17.17));
    }

    float fftBand(float key) {
      float k = floor(mod(key, 16.0));
      if (k < 4.0) return k < 1.0 ? fftBinsA.x : (k < 2.0 ? fftBinsA.y : (k < 3.0 ? fftBinsA.z : fftBinsA.w));
      if (k < 8.0) return k < 5.0 ? fftBinsB.x : (k < 6.0 ? fftBinsB.y : (k < 7.0 ? fftBinsB.z : fftBinsB.w));
      if (k < 12.0) return k < 9.0 ? fftBinsC.x : (k < 10.0 ? fftBinsC.y : (k < 11.0 ? fftBinsC.z : fftBinsC.w));
      return k < 13.0 ? fftBinsD.x : (k < 14.0 ? fftBinsD.y : (k < 15.0 ? fftBinsD.z : fftBinsD.w));
    }

    mat2 rot(float a) {
      float s = sin(a), c = cos(a);
      return mat2(c, -s, s, c);
    }

    float saturate(float x) { return clamp(x, 0.0, 1.0); }

    float sdBox(vec2 p, vec2 b) {
      vec2 d = abs(p) - b;
      return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    }

    float tri(float x) { return abs(fract(x) - 0.5) * 2.0; }
  `;

  const telemetry = document.getElementById('telemetry');
  const label = document.getElementById('label');
  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const query = new URLSearchParams(location.search);
  const requestedSeed = Number.parseInt(query.get('seed') || '', 10);
  const seed = Number.isFinite(requestedSeed) ? requestedSeed : 491009;
  const benchmarkMode = query.has('benchmark');
  const requestedFrames = Number.parseInt(query.get('frames') || '120', 10);
  const benchmarkFrames = Math.max(120, Math.min(900, Number.isFinite(requestedFrames) ? requestedFrames : 120));
  const fftBins = new Float32Array(16);
  const fftTargets = new Float32Array(16);
  let startTime = performance.now();
  let lastFrameTime = startTime;
  let frameIndex = 0;
  let warmupRemaining = benchmarkMode ? 30 : 0;
  const frameDeltas = [];

  function fail(message) {
    document.body.classList.add('failed');
    if (telemetry) telemetry.textContent = message;
    throw new Error(message);
  }

  if (!gl) fail('WebGL unavailable');

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      fail(gl.getShaderInfoLog(shader) || 'shader compile failed');
    }
    return shader;
  }

  function link(fragmentBody) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `${commonFragmentSource}\n${fragmentBody}`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      fail(gl.getProgramInfoLog(program) || 'program link failed');
    }
    return program;
  }

  function resize() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function updateDemoFft(nowMs) {
    const t = (nowMs - startTime) / 1000;
    const lowPulse = 0.5 + 0.5 * sinSafe(t * 1.7);
    const midSweep = 5.0 + 3.5 * sinSafe(t * 0.47 + seed * 0.001);
    const highSweep = 11.0 + 3.0 * sinSafe(t * 0.31 + 2.4);
    for (let i = 0; i < 16; i += 1) {
      const low = 0.38 * Math.exp(-Math.pow((i - 2.0) / 1.8, 2)) * (0.45 + 0.55 * lowPulse);
      const mid = 0.52 * Math.exp(-Math.pow((i - midSweep) / 2.0, 2));
      const high = 0.34 * Math.exp(-Math.pow((i - highSweep) / 1.45, 2));
      fftTargets[i] = Math.max(0.03, Math.min(1, 0.04 + low + mid + high + 0.06 * sinSafe(t * (2.1 + i * 0.07) + i * 1.9)));
      const attack = fftTargets[i] > fftBins[i] ? 0.34 : 0.075;
      fftBins[i] += (fftTargets[i] - fftBins[i]) * attack;
    }
  }

  function sinSafe(x) { return Math.sin(x); }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
  }

  function summarize() {
    const sum = frameDeltas.reduce((a, b) => a + b, 0);
    const avgFrameMs = sum / frameDeltas.length;
    const result = {
      candidate: window.CANDIDATE.name,
      path: location.pathname,
      seed,
      frames: frameDeltas.length,
      warmupFrames: 30,
      avgFrameMs,
      avgFps: 1000 / avgFrameMs,
      p95FrameMs: percentile(frameDeltas, 95),
      worstFrameMs: Math.max(...frameDeltas),
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      effectiveDprX: canvas.width / window.innerWidth,
      effectiveDprY: canvas.height / window.innerHeight,
      renderer: gl.getParameter(gl.RENDERER),
      vendor: gl.getParameter(gl.VENDOR),
      userAgent: navigator.userAgent,
      fftReadyBands: 16,
      timestamp: new Date().toISOString()
    };
    window.__CANDIDATE_BENCHMARK__ = result;
    console.log('CANDIDATE_BENCHMARK', JSON.stringify(result));
    if (telemetry) telemetry.textContent = `${result.candidate} seed ${seed} | ${result.frames} frames | ${result.avgFps.toFixed(1)} fps | p95 ${result.p95FrameMs.toFixed(2)} ms | DPR ${result.effectiveDprX.toFixed(2)}x`;
  }

  window.startCandidate = function startCandidate(fragmentBody) {
    if (!window.CANDIDATE || !fragmentBody) fail('candidate registration missing');
    document.title = `${window.CANDIDATE.name} - Visualizer Candidate`;
    if (label) label.textContent = `${window.CANDIDATE.name} · seed ${seed}`;
    const program = link(fragmentBody);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    const uniforms = {
      resolution: gl.getUniformLocation(program, 'resolution'),
      time: gl.getUniformLocation(program, 'time'),
      seed: gl.getUniformLocation(program, 'seed'),
      fftBinsA: gl.getUniformLocation(program, 'fftBinsA'),
      fftBinsB: gl.getUniformLocation(program, 'fftBinsB'),
      fftBinsC: gl.getUniformLocation(program, 'fftBinsC'),
      fftBinsD: gl.getUniformLocation(program, 'fftBinsD')
    };
    resize();
    window.addEventListener('resize', resize);

    function render(now) {
      updateDemoFft(now);
      const dt = now - lastFrameTime;
      lastFrameTime = now;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, (now - startTime) / 1000);
      gl.uniform1f(uniforms.seed, seed);
      gl.uniform4fv(uniforms.fftBinsA, fftBins.subarray(0, 4));
      gl.uniform4fv(uniforms.fftBinsB, fftBins.subarray(4, 8));
      gl.uniform4fv(uniforms.fftBinsC, fftBins.subarray(8, 12));
      gl.uniform4fv(uniforms.fftBinsD, fftBins.subarray(12, 16));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frameIndex += 1;
      if (benchmarkMode && frameIndex > 1) {
        if (warmupRemaining > 0) warmupRemaining -= 1;
        else if (frameDeltas.length < benchmarkFrames) frameDeltas.push(dt);
        if (frameDeltas.length === benchmarkFrames && !window.__CANDIDATE_BENCHMARK__) summarize();
      }
      if (!benchmarkMode || frameDeltas.length < benchmarkFrames) requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  };
})();
