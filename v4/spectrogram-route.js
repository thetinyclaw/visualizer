'use strict';

const BAND_COUNT = 192;
const HISTORY_WIDTH = 640;
const HISTORY_HEIGHT = 256;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20000;
const FFT_SIZE = 2048;
const RENDER_SCALE = 0.75;

const HIGH_CONTRAST_STOPS = Object.freeze([
  Object.freeze({ at: 0.00, rgb: [1, 2, 8] }),
  Object.freeze({ at: 0.055, rgb: [8, 10, 52] }),
  Object.freeze({ at: 0.16, rgb: [23, 27, 190] }),
  Object.freeze({ at: 0.34, rgb: [0, 226, 255] }),
  Object.freeze({ at: 0.58, rgb: [205, 255, 35] }),
  Object.freeze({ at: 0.79, rgb: [255, 72, 28] }),
  Object.freeze({ at: 1.00, rgb: [255, 255, 255] }),
]);

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function seededUnit(seed, salt = 0) {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}
function paletteRgb(value, boost = 1) {
  const v = clamp01(value * boost);
  let lo = HIGH_CONTRAST_STOPS[0];
  let hi = HIGH_CONTRAST_STOPS[HIGH_CONTRAST_STOPS.length - 1];
  for (let i = 1; i < HIGH_CONTRAST_STOPS.length; i += 1) {
    if (v <= HIGH_CONTRAST_STOPS[i].at) {
      lo = HIGH_CONTRAST_STOPS[i - 1]; hi = HIGH_CONTRAST_STOPS[i]; break;
    }
  }
  const amount = clamp01((v - lo.at) / Math.max(0.0001, hi.at - lo.at));
  return [
    Math.round(lerp(lo.rgb[0], hi.rgb[0], amount)),
    Math.round(lerp(lo.rgb[1], hi.rgb[1], amount)),
    Math.round(lerp(lo.rgb[2], hi.rgb[2], amount)),
  ];
}

export function startSpectralWaterfall(windowObject = window) {
  const document = windowObject.document;
  const canvas = document.getElementById('spectrogram-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const historyCanvas = document.createElement('canvas');
  const historyCtx = historyCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
  historyCanvas.width = HISTORY_WIDTH;
  historyCanvas.height = HISTORY_HEIGHT;
  historyCtx.fillStyle = '#010208';
  historyCtx.fillRect(0, 0, HISTORY_WIDTH, HISTORY_HEIGHT);

  const params = new URLSearchParams(windowObject.location.search);
  const seed = Number.parseInt(params.get('seed') || '491009', 10) || 491009;
  const phaseOrigin = Number.parseFloat(params.get('time') || '0') || 0;
  const requestedMode = ['demo', 'flat', 'live'].includes(params.get('mode')) ? params.get('mode') : 'demo';
  const fallbackQuery = new URLSearchParams({ seed: String(seed), time: String(phaseOrigin), mode: requestedMode });

  const queryText = document.getElementById('query-text');
  const fallbackLink = document.getElementById('fallback-link');
  const sourceLabel = document.getElementById('source');
  const statusLabel = document.getElementById('status');
  const startMic = document.getElementById('start-mic');
  const startDemo = document.getElementById('start-demo');
  const freezeButton = document.getElementById('freeze');
  const fullscreenButton = document.getElementById('fullscreen');
  queryText.textContent = `?${fallbackQuery}`;
  fallbackLink.href = `../fft.html?${fallbackQuery}`;

  const bands = new Float32Array(BAND_COUNT);
  const previousBands = new Float32Array(BAND_COUNT);
  const rawBands = new Float32Array(BAND_COUNT);
  const peakHolds = new Float32Array(BAND_COUNT);
  let frequencyData = new Uint8Array(FFT_SIZE / 2);
  let audioContext = null;
  let analyser = null;
  let sourceStream = null;
  let mode = requestedMode === 'live' ? 'idle' : requestedMode;
  let frozen = false;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let historyColumns = 0;
  let historyAccumulator = 0;
  let lastFrame = windowObject.performance.now();
  let startTime = lastFrame;
  let rafId = 0;
  let energy = 0;
  let spectralFlux = 0;
  let onsetFlash = 0;
  let centroidHz = 0;
  let peakHz = 0;
  let bassEnergy = 0;
  let frameCount = 0;
  let frameWindowStarted = lastFrame;
  let measuredFps = 0;

  const state = {
    sceneId: 'spectral-waterfall', rendererMode: 'canvas2d', active: true,
    seed, requestedMode, mode, audioSource: mode === 'demo' ? 'demo synthetic' : mode,
    microphoneAutoRequested: false, microphoneRequested: false, microphoneActive: false,
    bandCount: BAND_COUNT, historySize: [HISTORY_WIDTH, HISTORY_HEIGHT], historyColumns: 0,
    paletteStops: HIGH_CONTRAST_STOPS.length, renderScale: RENDER_SCALE, spectralFlux: 0, onsetFlash: 0,
    centroidHz: 0, peakHz: 0, energy: 0, bassEnergy: 0, fps: 0, averageFps: 0,
    frozen: false, errors: [], frame: 0,
  };
  windowObject.__V4_SPECTRAL_WATERFALL__ = state;

  function setSource(nextMode, message) {
    mode = nextMode;
    const source = nextMode === 'demo' ? 'demo synthetic' : nextMode;
    document.body.dataset.audioSource = source;
    sourceLabel.textContent = source.toUpperCase();
    statusLabel.textContent = message;
    state.mode = nextMode;
    state.audioSource = source;
    state.active = nextMode !== 'idle' && nextMode !== 'error';
  }

  function resize() {
    dpr = Math.min(windowObject.devicePixelRatio || 1, 1.5) * RENDER_SCALE;
    width = Math.max(1, windowObject.innerWidth);
    height = Math.max(1, windowObject.innerHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function sampleLogFrequency(frequency) {
    const sampleRate = audioContext?.sampleRate || 48000;
    const position = frequency / (sampleRate * 0.5) * (frequencyData.length - 1);
    const lo = Math.max(0, Math.min(frequencyData.length - 1, Math.floor(position)));
    const hi = Math.min(frequencyData.length - 1, lo + 1);
    const amount = position - lo;
    return (frequencyData[lo] * (1 - amount) + frequencyData[hi] * amount) / 255;
  }

  function demoBandValue(position, seconds) {
    const beat = Math.pow(Math.max(0, Math.sin(seconds * Math.PI * 1.64)), 10);
    const sweep = 0.5 + 0.5 * Math.sin(seconds * 0.37 + seededUnit(seed, 3) * 6.28);
    const octave = position * Math.log2(MAX_FREQUENCY / MIN_FREQUENCY);
    const bass = Math.exp(-Math.pow((position - (0.10 + 0.025 * Math.sin(seconds * 0.43))) / 0.055, 2)) * (0.60 + beat * 0.38);
    const voice = Math.exp(-Math.pow((position - (0.38 + 0.07 * Math.sin(seconds * 0.29))) / 0.075, 2)) * 0.72;
    const lead = Math.exp(-Math.pow((position - (0.68 + (sweep - 0.5) * 0.18)) / 0.052, 2)) * (0.35 + beat * 0.48);
    const harmonics = Math.pow(0.5 + 0.5 * Math.sin(octave * 12.4 - seconds * 2.7), 8) * (0.10 + 0.18 * sweep);
    const air = Math.exp(-Math.pow((position - 0.88) / 0.12, 2)) * (0.12 + beat * 0.22);
    return clamp01(0.012 + bass + voice + lead + harmonics + air);
  }

  function synthesizeDemo(seconds) {
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const position = i / (BAND_COUNT - 1);
      rawBands[i] = demoBandValue(position, seconds);
    }
  }

  function historyContrast(value, localFlux = 0) {
    return Math.pow(clamp01(value * 0.94 + localFlux * 2.4), 0.86);
  }

  function prefillDemoHistory() {
    const image = historyCtx.createImageData(HISTORY_WIDTH, HISTORY_HEIGHT);
    const simulated = new Float32Array(BAND_COUNT);
    const firstSeconds = phaseOrigin - (HISTORY_WIDTH - 2) / 60;
    for (let i = 0; i < BAND_COUNT; i += 1) simulated[i] = demoBandValue(i / (BAND_COUNT - 1), firstSeconds);
    for (let x = 0; x < HISTORY_WIDTH; x += 2) {
      const seconds = phaseOrigin - (HISTORY_WIDTH - 2 - x) / 60;
      const simulatedFlux = new Float32Array(BAND_COUNT);
      for (let i = 0; i < BAND_COUNT; i += 1) {
        const raw = demoBandValue(i / (BAND_COUNT - 1), seconds);
        const previous = simulated[i];
        simulated[i] += (raw - simulated[i]) * (raw > simulated[i] ? 0.58 : 0.12);
        simulatedFlux[i] = Math.max(0, simulated[i] - previous);
      }
      for (let y = 0; y < HISTORY_HEIGHT; y += 1) {
        const bandIndex = Math.round((1 - y / (HISTORY_HEIGHT - 1)) * (BAND_COUNT - 1));
        const [r, g, b] = paletteRgb(historyContrast(simulated[bandIndex], simulatedFlux[bandIndex]));
        for (let column = 0; column < 2; column += 1) {
          const offset = (y * HISTORY_WIDTH + Math.min(HISTORY_WIDTH - 1, x + column)) * 4;
          image.data[offset] = r; image.data[offset + 1] = g; image.data[offset + 2] = b; image.data[offset + 3] = 255;
        }
      }
    }
    historyCtx.putImageData(image, 0, 0);
    bands.set(simulated);
    previousBands.set(simulated);
    peakHolds.set(simulated);
    historyColumns = HISTORY_WIDTH;
    state.historyColumns = historyColumns;
  }

  function sampleMicrophone() {
    analyser.getByteFrequencyData(frequencyData);
    const ratio = MAX_FREQUENCY / MIN_FREQUENCY;
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const frequency = MIN_FREQUENCY * Math.pow(ratio, i / Math.max(1, BAND_COUNT - 1));
      rawBands[i] = sampleLogFrequency(frequency);
    }
  }

  function updateFeatures(deltaSeconds, seconds) {
    if (mode === 'demo') synthesizeDemo(seconds);
    else if (mode === 'mic' && analyser) sampleMicrophone();
    else rawBands.fill(0);

    let sum = 0;
    let weighted = 0;
    let flux = 0;
    let highest = 0;
    let highestIndex = 0;
    bassEnergy = 0;
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const raw = rawBands[i];
      const previous = bands[i];
      previousBands[i] = previous;
      bands[i] += (raw - bands[i]) * (raw > bands[i] ? 0.58 : 0.12);
      peakHolds[i] = Math.max(bands[i], peakHolds[i] - deltaSeconds * 0.24);
      flux += Math.max(0, bands[i] - previous);
      sum += bands[i];
      const frequency = MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, i / (BAND_COUNT - 1));
      weighted += frequency * bands[i];
      if (bands[i] > highest) { highest = bands[i]; highestIndex = i; }
      if (i < 32) bassEnergy += bands[i] / 32;
    }
    energy = sum / BAND_COUNT;
    spectralFlux = flux / BAND_COUNT;
    centroidHz = sum > 0.0001 ? weighted / sum : 0;
    peakHz = MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, highestIndex / (BAND_COUNT - 1));
    const onset = clamp01((spectralFlux - 0.008) * 13.0);
    onsetFlash = Math.max(onsetFlash * Math.pow(0.028, deltaSeconds), onset);
  }

  function updateSpectrogramHistory() {
    const columnWidth = onsetFlash > 0.45 ? 3 : 2;
    historyCtx.drawImage(historyCanvas, columnWidth, 0, HISTORY_WIDTH - columnWidth, HISTORY_HEIGHT, 0, 0, HISTORY_WIDTH - columnWidth, HISTORY_HEIGHT);
    const image = historyCtx.createImageData(columnWidth, HISTORY_HEIGHT);
    for (let y = 0; y < HISTORY_HEIGHT; y += 1) {
      const bandIndex = Math.round((1 - y / (HISTORY_HEIGHT - 1)) * (BAND_COUNT - 1));
      const band = bands[bandIndex];
      const localFlux = Math.max(0, band - previousBands[bandIndex]);
      const contrast = historyContrast(band, localFlux);
      const [r, g, b] = paletteRgb(contrast, 1 + onsetFlash * 0.15);
      for (let x = 0; x < columnWidth; x += 1) {
        const offset = (y * columnWidth + x) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
      }
    }
    historyCtx.putImageData(image, HISTORY_WIDTH - columnWidth, 0);
    historyColumns += columnWidth;
    state.historyColumns = historyColumns;
  }

  function drawHistory(seconds) {
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    const globalDisplacement = Math.sin(seconds * 0.82 + seed * 0.0001) * bassEnergy * 7;
    ctx.drawImage(historyCanvas, 0, 0, HISTORY_WIDTH, HISTORY_HEIGHT, globalDisplacement - 4, 0, width + 8, height);

    if (onsetFlash > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const accents = 6;
      for (let slice = 0; slice < accents; slice += 1) {
        const bandIndex = Math.round((1 - slice / (accents - 1)) * (BAND_COUNT - 1));
        const localEnergy = bands[bandIndex];
        const sy = slice / accents * HISTORY_HEIGHT;
        const sh = HISTORY_HEIGHT / accents + 1;
        const dy = slice / accents * height;
        const dh = height / accents + 1;
        const shear = Math.sin(seconds * 1.4 + slice * 1.7) * (5 + localEnergy * 18) * onsetFlash;
        ctx.globalAlpha = onsetFlash * (0.06 + localEnergy * 0.10);
        ctx.drawImage(historyCanvas, 0, sy, HISTORY_WIDTH, sh, shear - 3, dy, width + 6, dh);
      }
      ctx.restore();
    }
  }

  function drawCurrentSpectrum() {
    const edge = width - Math.max(18, width * 0.022);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const y = height - i / (BAND_COUNT - 1) * height;
      const x = edge - bands[i] * Math.min(width * 0.22, 260) - peakHolds[i] * 10;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(236,255,255,${0.66 + onsetFlash * 0.30})`;
    ctx.lineWidth = 1.15 + onsetFlash * 1.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawFrequencyGrid() {
    const labels = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
    ctx.save();
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (const frequency of labels) {
      const normalized = Math.log(frequency / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY);
      const y = height - normalized * height;
      ctx.strokeStyle = frequency === 1000 ? 'rgba(210,245,255,.18)' : 'rgba(140,210,255,.08)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillStyle = 'rgba(210,240,255,.48)';
      ctx.fillText(frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`, 7, Math.max(11, y - 3));
    }
    ctx.restore();
  }

  function drawOnsetFlash() {
    if (onsetFlash < 0.01) return;
    const gradient = ctx.createLinearGradient(width * 0.55, 0, width, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.82, `rgba(77,246,255,${onsetFlash * 0.10})`);
    gradient.addColorStop(1, `rgba(255,255,255,${onsetFlash * 0.42})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function updateHud() {
    document.getElementById('peak').textContent = peakHz >= 1000 ? `${(peakHz / 1000).toFixed(2)} kHz` : `${Math.round(peakHz)} Hz`;
    document.getElementById('centroid').textContent = centroidHz >= 1000 ? `${(centroidHz / 1000).toFixed(2)} kHz` : `${Math.round(centroidHz)} Hz`;
    document.getElementById('flux').textContent = `${Math.round(spectralFlux * 1000)}%`;
    document.getElementById('energy').textContent = `${Math.round(energy * 100)}%`;
  }

  function render(now) {
    const deltaSeconds = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    const seconds = phaseOrigin + (now - startTime) / 1000;
    if (!frozen) {
      updateFeatures(deltaSeconds, seconds);
      historyAccumulator += deltaSeconds;
      if (historyAccumulator >= 1 / 30) {
        historyAccumulator %= 1 / 30;
        updateSpectrogramHistory();
      }
    } else {
      onsetFlash *= Math.pow(0.028, deltaSeconds);
    }
    drawHistory(seconds);
    drawFrequencyGrid();
    drawCurrentSpectrum();
    drawOnsetFlash();
    if (frameCount % 8 === 0) updateHud();

    frameCount += 1;
    if (now - frameWindowStarted >= 1000) {
      measuredFps = frameCount * 1000 / (now - frameWindowStarted);
      frameCount = 0; frameWindowStarted = now;
    }
    const nextFrame = state.frame + 1;
    const averageFps = nextFrame / Math.max(0.001, (now - startTime) / 1000);
    Object.assign(state, {
      spectralFlux, onsetFlash, centroidHz, peakHz, energy, bassEnergy,
      fps: measuredFps, averageFps, frozen, frame: nextFrame,
    });
    rafId = windowObject.requestAnimationFrame(render);
  }

  async function startMicrophone() {
    state.microphoneRequested = true;
    if (!windowObject.isSecureContext || !windowObject.navigator.mediaDevices?.getUserMedia) {
      state.errors.push('microphone-requires-secure-context');
      setSource('error', 'Microphone requires HTTPS and mediaDevices; demo remains available.');
      return;
    }
    try {
      audioContext ||= new (windowObject.AudioContext || windowObject.webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (!sourceStream) {
        sourceStream = await windowObject.navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false,
        });
        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.minDecibels = -94;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.68;
        audioContext.createMediaStreamSource(sourceStream).connect(analyser);
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
      }
      state.microphoneActive = true;
      setSource('mic', 'Live microphone · 192 logarithmic bands · local analysis only');
    } catch (error) {
      state.errors.push(String(error?.name || error));
      state.microphoneActive = false;
      setSource('error', 'Microphone permission unavailable; choose Demo Signal to continue.');
    }
  }

  function startDemoSignal() {
    state.microphoneActive = false;
    setSource('demo', 'Synthetic demo · high-contrast history · no microphone capture');
  }

  startMic.addEventListener('click', startMicrophone);
  startDemo.addEventListener('click', startDemoSignal);
  freezeButton.addEventListener('click', () => {
    frozen = !frozen;
    freezeButton.textContent = frozen ? 'RESUME' : 'FREEZE';
    state.frozen = frozen;
  });
  fullscreenButton.addEventListener('click', () => document.documentElement.requestFullscreen?.());
  windowObject.addEventListener('resize', resize);
  windowObject.addEventListener('pagehide', () => {
    windowObject.cancelAnimationFrame(rafId);
    sourceStream?.getTracks().forEach((track) => track.stop());
    audioContext?.close();
  }, { once: true });

  resize();
  if (requestedMode === 'demo') setSource('demo', 'Synthetic demo · high-contrast history · no microphone capture');
  else if (requestedMode === 'flat') setSource('flat', 'Flat no-signal source · deterministic black-floor verification');
  else setSource('idle', 'Live mode selected · microphone remains idle until Start Mic is clicked');
  if (requestedMode === 'demo') {
    prefillDemoHistory();
    synthesizeDemo(phaseOrigin);
    startTime = windowObject.performance.now();
    lastFrame = startTime;
    frameWindowStarted = startTime;
  }
  rafId = windowObject.requestAnimationFrame(render);
  return state;
}

if (globalThis.document) startSpectralWaterfall(globalThis);
