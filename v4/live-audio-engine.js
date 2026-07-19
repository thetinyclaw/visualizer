import { AUDIO_BAND_COUNT, AudioFeatureBus, FFT_SIZE } from './audio-feature-bus.js';

export const LIVE_AUDIO_STATES = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting-mic',
  LIVE_WORKLET: 'live-worklet',
  LIVE_FALLBACK: 'live-fallback',
  DEMO: 'demo',
  FLAT: 'flat',
  DENIED: 'permission-denied',
  INSECURE: 'insecure-context',
  UNAVAILABLE: 'media-unavailable',
  DEVICE_LOST: 'device-lost',
  STOPPED: 'stopped',
  ERROR: 'error',
});

export const AUDIO_SOURCE_LABELS = Object.freeze({
  'live-worklet': 'LIVE MICROPHONE · AudioWorklet analysis',
  'live-fallback': 'LIVE MICROPHONE · main-thread AnalyserNode fallback',
  demo: 'DEMO SYNTHETIC · no microphone',
  flat: 'FLAT TEST SIGNAL · no microphone',
  idle: 'IDLE · microphone has not been requested',
  stopped: 'STOPPED · microphone released',
  'permission-denied': 'MICROPHONE DENIED · no live input',
  'insecure-context': 'HTTPS REQUIRED · microphone not requested',
  'media-unavailable': 'MICROPHONE API UNAVAILABLE',
  'device-lost': 'MICROPHONE DEVICE LOST · stopped',
  error: 'AUDIO ERROR · stopped safely',
});

function defaultDiagnostics() {
  return {
    state: LIVE_AUDIO_STATES.IDLE,
    source: 'idle',
    label: AUDIO_SOURCE_LABELS.idle,
    secureContext: Boolean(globalThis.isSecureContext),
    permission: 'unknown',
    workletSupported: false,
    fallbackActive: false,
    micActive: false,
    lastError: '',
    requestCount: 0,
    stopCount: 0,
    sequence: 0,
  };
}

function publicError(code, message) {
  return Object.freeze({ code, message });
}

export class LiveAudioFeatureBridge {
  constructor({
    bus = new AudioFeatureBus(),
    windowObject = globalThis,
    navigatorObject = globalThis.navigator,
    workletUrl = new URL('./audio-feature-worklet.js', import.meta.url),
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  } = {}) {
    this.bus = bus;
    this.windowObject = windowObject;
    this.navigatorObject = navigatorObject;
    this.workletUrl = workletUrl;
    this.now = now;
    this.audioContext = null;
    this.stream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.analyser = null;
    this.frequencyData = null;
    this.rafId = 0;
    this.demoPhase = 0;
    this.lastTickMs = 0;
    this.compactInput = new Float32Array(AUDIO_BAND_COUNT);
    this.demoBands = new Float32Array(AUDIO_BAND_COUNT);
    this.flatBands = new Float32Array(AUDIO_BAND_COUNT);
    this.diagnostics = defaultDiagnostics();
    this.errors = [];
    this.onStateChange = () => {};
  }

  getSnapshot() {
    return this.bus.snapshot();
  }

  getDiagnostics() {
    return this.diagnostics;
  }

  setState(state, { source = state, error = '', permission = this.diagnostics.permission } = {}) {
    this.diagnostics.state = state;
    this.diagnostics.source = source;
    this.diagnostics.label = AUDIO_SOURCE_LABELS[source] || AUDIO_SOURCE_LABELS[state] || state;
    this.diagnostics.secureContext = Boolean(this.windowObject.isSecureContext);
    this.diagnostics.workletSupported = Boolean(this.audioContext && this.audioContext.audioWorklet && this.windowObject.AudioWorkletNode);
    this.diagnostics.fallbackActive = state === LIVE_AUDIO_STATES.LIVE_FALLBACK;
    this.diagnostics.micActive = state === LIVE_AUDIO_STATES.LIVE_WORKLET || state === LIVE_AUDIO_STATES.LIVE_FALLBACK;
    this.diagnostics.lastError = error;
    this.diagnostics.permission = permission;
    this.diagnostics.sequence += 1;
    this.bus.setSourceState(source, state);
    this.onStateChange(this.diagnostics, this.getSnapshot());
    return this.diagnostics;
  }

  canRequestMicrophone() {
    if (!this.windowObject.isSecureContext) return publicError('insecure-context', 'Microphone requires HTTPS or localhost; no permission request was made.');
    if (!this.navigatorObject || !this.navigatorObject.mediaDevices || typeof this.navigatorObject.mediaDevices.getUserMedia !== 'function') {
      return publicError('media-unavailable', 'navigator.mediaDevices.getUserMedia is unavailable; no permission request was made.');
    }
    return null;
  }

  async startMicrophone({ gesture = false } = {}) {
    if (!gesture) {
      const error = publicError('gesture-required', 'Start Mic must be called from an explicit user gesture.');
      this.errors.push(error);
      this.setState(LIVE_AUDIO_STATES.IDLE, { source: 'idle', error: error.message });
      return { ok: false, error };
    }

    await this.stop({ nextState: LIVE_AUDIO_STATES.REQUESTING, nextSource: 'idle' });
    const preflight = this.canRequestMicrophone();
    if (preflight) {
      this.errors.push(preflight);
      const state = preflight.code === 'insecure-context' ? LIVE_AUDIO_STATES.INSECURE : LIVE_AUDIO_STATES.UNAVAILABLE;
      this.setState(state, { source: state, error: preflight.message });
      return { ok: false, error: preflight };
    }

    this.diagnostics.requestCount += 1;
    this.setState(LIVE_AUDIO_STATES.REQUESTING, { source: 'idle' });
    try {
      this.stream = await this.navigatorObject.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      this.audioContext = await this.createAudioContext();
      if (this.audioContext.state === 'suspended' && typeof this.audioContext.resume === 'function') await this.audioContext.resume();
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.installTrackLossHandlers();
      const workletReady = await this.tryStartWorklet();
      if (!workletReady) this.startAnalyserFallback();
      return { ok: true, mode: this.diagnostics.state, snapshot: this.getSnapshot() };
    } catch (error) {
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      await this.stop({ nextState: denied ? LIVE_AUDIO_STATES.DENIED : LIVE_AUDIO_STATES.ERROR, nextSource: denied ? 'permission-denied' : 'error', error: denied ? 'Microphone permission was denied. Use Start Mic to retry.' : 'Microphone start failed safely.' });
      return { ok: false, error: publicError(denied ? 'permission-denied' : 'mic-start-failed', denied ? 'Microphone permission was denied. Use Start Mic to retry.' : 'Microphone start failed safely.') };
    }
  }

  async createAudioContext() {
    const Ctor = this.windowObject.AudioContext || this.windowObject.webkitAudioContext;
    return new Ctor({ sampleRate: 48000 });
  }

  async tryStartWorklet() {
    if (!this.audioContext || !this.audioContext.audioWorklet || !this.windowObject.AudioWorkletNode) return false;
    try {
      await this.audioContext.audioWorklet.addModule(this.workletUrl);
      this.workletNode = new this.windowObject.AudioWorkletNode(this.audioContext, 'visualizer-v4-feature-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
      this.workletNode.port.onmessage = (event) => this.handleWorkletMessage(event);
      this.sourceNode.connect(this.workletNode);
      this.setState(LIVE_AUDIO_STATES.LIVE_WORKLET, { source: 'live-worklet', permission: 'granted' });
      return true;
    } catch (error) {
      this.errors.push(publicError('audio-worklet-failed', 'AudioWorklet analysis failed; using AnalyserNode fallback.'));
      this.disconnectWorklet();
      return false;
    }
  }

  handleWorkletMessage(event) {
    const payload = event && event.data && event.data.payload;
    if (!payload || payload.length < AUDIO_BAND_COUNT) return;
    this.compactInput.set(payload.subarray(0, AUDIO_BAND_COUNT));
    this.bus.processBandFrame(this.compactInput, 1 / 60, { source: 'live-worklet', state: LIVE_AUDIO_STATES.LIVE_WORKLET });
    this.onStateChange(this.diagnostics, this.getSnapshot());
  }

  startAnalyserFallback() {
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    this.sourceNode.connect(this.analyser);
    this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
    this.lastTickMs = this.now();
    this.setState(LIVE_AUDIO_STATES.LIVE_FALLBACK, { source: 'live-fallback', permission: 'granted' });
    this.scheduleTick();
  }

  scheduleTick() {
    if (!this.windowObject.requestAnimationFrame) return;
    this.rafId = this.windowObject.requestAnimationFrame(() => this.tick());
  }

  tick() {
    const now = this.now();
    const dt = this.lastTickMs ? Math.max(1 / 120, Math.min(0.25, (now - this.lastTickMs) / 1000)) : 1 / 60;
    this.lastTickMs = now;
    if (this.analyser && this.frequencyData) {
      this.analyser.getFloatFrequencyData(this.frequencyData);
      this.bus.processDecibelSpectrum(this.frequencyData, dt, { source: 'live-fallback', state: LIVE_AUDIO_STATES.LIVE_FALLBACK });
      this.onStateChange(this.diagnostics, this.getSnapshot());
      this.scheduleTick();
      return;
    }
    if (this.diagnostics.state === LIVE_AUDIO_STATES.DEMO) {
      this.fillDemoBands(now / 1000);
      this.bus.processBandFrame(this.demoBands, dt, { source: 'demo', state: LIVE_AUDIO_STATES.DEMO });
      this.onStateChange(this.diagnostics, this.getSnapshot());
      this.scheduleTick();
    }
  }

  async startDemo({ gesture = false } = {}) {
    if (!gesture) return { ok: false, error: publicError('gesture-required', 'Demo must be started from an explicit user gesture.') };
    await this.stop({ nextState: LIVE_AUDIO_STATES.DEMO, nextSource: 'demo' });
    this.lastTickMs = this.now();
    this.setState(LIVE_AUDIO_STATES.DEMO, { source: 'demo', permission: 'not-requested' });
    this.tick();
    return { ok: true, snapshot: this.getSnapshot() };
  }

  async startFlat({ gesture = false } = {}) {
    if (!gesture) return { ok: false, error: publicError('gesture-required', 'Flat source must be started from an explicit user gesture.') };
    await this.stop({ nextState: LIVE_AUDIO_STATES.FLAT, nextSource: 'flat' });
    this.flatBands.fill(0);
    this.bus.processBandFrame(this.flatBands, 1 / 60, { source: 'flat', state: LIVE_AUDIO_STATES.FLAT });
    this.setState(LIVE_AUDIO_STATES.FLAT, { source: 'flat', permission: 'not-requested' });
    return { ok: true, snapshot: this.getSnapshot() };
  }

  fillDemoBands(timeSeconds) {
    for (let i = 0; i < AUDIO_BAND_COUNT; i += 1) {
      const lowPulse = i < 4 ? 0.42 + 0.35 * Math.sin(timeSeconds * 2.1 + i * 0.37) : 0;
      const sweep = 0.30 + 0.25 * Math.sin(timeSeconds * (0.7 + i * 0.03) + i * 0.91);
      const sparkle = (i > 10 ? 0.18 * Math.max(0, Math.sin(timeSeconds * 7.3 + i)) : 0);
      this.demoBands[i] = Math.min(1, Math.max(0, lowPulse + sweep + sparkle));
    }
  }

  installTrackLossHandlers() {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks ? this.stream.getAudioTracks() : this.stream.getTracks()) {
      track.onended = () => this.handleDeviceLost();
    }
  }

  async handleDeviceLost() {
    await this.stop({ nextState: LIVE_AUDIO_STATES.DEVICE_LOST, nextSource: 'device-lost', error: 'Microphone device ended or was removed. Press Start Mic to recover.' });
  }

  disconnectWorklet() {
    if (this.workletNode) {
      try { this.workletNode.port.onmessage = null; } catch (error) {}
      try { this.sourceNode && this.sourceNode.disconnect(this.workletNode); } catch (error) {}
      try { this.workletNode.disconnect(); } catch (error) {}
    }
    this.workletNode = null;
  }

  async stop({ nextState = LIVE_AUDIO_STATES.STOPPED, nextSource = 'stopped', error = '' } = {}) {
    if (this.rafId && this.windowObject.cancelAnimationFrame) this.windowObject.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.disconnectWorklet();
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (e) {}
    }
    this.sourceNode = null;
    this.analyser = null;
    this.frequencyData = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try { track.onended = null; track.stop(); } catch (e) {}
      }
    }
    this.stream = null;
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      try { await this.audioContext.close(); } catch (e) {}
    }
    this.audioContext = null;
    this.diagnostics.stopCount += 1;
    this.bus.reset({ source: nextSource, state: nextState });
    this.setState(nextState, { source: nextSource, error });
    return { ok: true, snapshot: this.getSnapshot() };
  }
}

export function createLiveAudioFeatureBridge(options) {
  return new LiveAudioFeatureBridge(options);
}
