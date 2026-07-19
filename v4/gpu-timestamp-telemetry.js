// Optional honest WebGPU timestamp-query telemetry.
// Values stay null until a real GPU query result has been resolved and mapped.

const QUERY_RESOLVE = globalThis.GPUBufferUsage?.QUERY_RESOLVE ?? 0x200;
const COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x4;
const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x8;
const MAP_READ = globalThis.GPUBufferUsage?.MAP_READ ?? 0x1;
const GPU_MAP_READ = globalThis.GPUMapMode?.READ ?? 0x1;

function nowMs() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function bigintToNumber(value) {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > maxSafe ? maxSafe : value);
}

function freezeSample(sample) {
  return Object.freeze({
    source: 'timestamp-query',
    scope: sample.scope,
    ns: sample.ns,
    ms: sample.ns === null ? null : sample.ns / 1_000_000,
    queryStartIndex: sample.queryStartIndex,
    queryEndIndex: sample.queryEndIndex,
  });
}

function unavailable(reason, extra = {}) {
  return Object.freeze({
    supported: false,
    source: null,
    unavailableReason: reason,
    latest: null,
    latestFrameNs: null,
    latestFrameMs: null,
    sampleCount: 0,
    sampleAgeFrames: null,
    sampleAgeMs: null,
    frameScope: 'frame',
    passScopes: Object.freeze([]),
    pendingSamples: 0,
    ...extra,
  });
}

export class GpuTimestampTelemetry {
  constructor({ device, passIds = [], enabled = true, unavailableReason = null, ringSize = 3, label = 'v4' } = {}) {
    this.device = device;
    this.passIds = [...passIds];
    this.enabled = Boolean(enabled);
    this.unavailableReason = unavailableReason;
    this.ringSize = Math.max(2, Math.floor(ringSize || 3));
    this.label = label;
    this.queriesPerFrame = 2 + this.passIds.length * 2;
    this.frameIndex = 0;
    this.sampleCount = 0;
    this.latest = null;
    this.pending = new Set();
    this.inflightBySlot = new Map();
    this.disposed = false;
    this.querySet = null;
    this.resolveBuffer = null;
    this.readbackBuffers = [];
    this.activeFrame = null;
    this.mappedFailure = null;

    if (!this.enabled) {
      this.unavailableReason = this.unavailableReason || 'timestamp-query-feature-unavailable';
      return;
    }
    if (!device || typeof device.createQuerySet !== 'function' || typeof device.createBuffer !== 'function') {
      this.enabled = false;
      this.unavailableReason = this.unavailableReason || 'timestamp-query-apis-unavailable';
      return;
    }
    try {
      this.querySet = device.createQuerySet({ label: `${label}:timestamp-query-set`, type: 'timestamp', count: this.ringSize * this.queriesPerFrame });
      this.resolveBuffer = device.createBuffer({ label: `${label}:timestamp-resolve`, size: this.ringSize * this.queriesPerFrame * 8, usage: QUERY_RESOLVE | COPY_SRC });
      for (let slot = 0; slot < this.ringSize; slot += 1) {
        this.readbackBuffers.push(device.createBuffer({ label: `${label}:timestamp-readback:${slot}`, size: this.queriesPerFrame * 8, usage: COPY_DST | MAP_READ }));
      }
    } catch (error) {
      this.dispose();
      this.enabled = false;
      this.unavailableReason = this.unavailableReason || 'timestamp-query-create-failed';
    }
  }

  get supported() {
    return Boolean(this.enabled && this.querySet && this.resolveBuffer && this.readbackBuffers.length);
  }

  beginFrame(encoder, frameContext = {}) {
    if (!this.supported || this.disposed || !encoder) return null;
    const slot = this.frameIndex % this.ringSize;
    if (this.inflightBySlot.has(slot)) return null;
    const base = slot * this.queriesPerFrame;
    const frameNumber = this.frameIndex;
    this.frameIndex += 1;
    const active = { slot, base, frameNumber, submittedFrameCount: frameContext.submittedFrameCount ?? null, startedAtMs: nowMs(), passMap: new Map() };
    this.activeFrame = active;
    if (typeof encoder.writeTimestamp === 'function') {
      encoder.writeTimestamp(this.querySet, base);
      active.frameWriteTimestamp = true;
    }
    return active;
  }

  timestampWritesForPass(passId) {
    if (!this.supported || !this.activeFrame) return null;
    const passIndex = this.passIds.indexOf(passId);
    if (passIndex < 0) return null;
    const beginning = this.activeFrame.base + 2 + passIndex * 2;
    const ending = beginning + 1;
    this.activeFrame.passMap.set(passId, { beginning, ending });
    return { querySet: this.querySet, beginningOfPassWriteIndex: beginning, endOfPassWriteIndex: ending };
  }

  endFrame(encoder, active = this.activeFrame) {
    if (!this.supported || !active || this.disposed || !encoder) return null;
    const frameEndIndex = active.base + 1;
    if (typeof encoder.writeTimestamp === 'function') encoder.writeTimestamp(this.querySet, frameEndIndex);
    if (typeof encoder.resolveQuerySet !== 'function' || typeof encoder.copyBufferToBuffer !== 'function') {
      this.mappedFailure = 'timestamp-query-resolve-apis-unavailable';
      this.activeFrame = null;
      return null;
    }
    encoder.resolveQuerySet(this.querySet, active.base, this.queriesPerFrame, this.resolveBuffer, active.base * 8);
    encoder.copyBufferToBuffer(this.resolveBuffer, active.base * 8, this.readbackBuffers[active.slot], 0, this.queriesPerFrame * 8);
    active.resolved = true;
    this.activeFrame = null;
    return active;
  }

  afterSubmit(active) {
    if (!this.supported || !active?.resolved || this.disposed) return;
    const buffer = this.readbackBuffers[active.slot];
    if (!buffer || typeof buffer.mapAsync !== 'function' || typeof buffer.getMappedRange !== 'function' || typeof buffer.unmap !== 'function') {
      this.mappedFailure = 'timestamp-query-map-apis-unavailable';
      return;
    }
    this.inflightBySlot.set(active.slot, active);
    const pending = buffer.mapAsync(GPU_MAP_READ)
      .then(() => {
        if (this.disposed) return null;
        const copy = buffer.getMappedRange(0, this.queriesPerFrame * 8);
        const view = new BigUint64Array(copy.slice ? copy.slice(0) : copy);
        const samples = [];
        const frameNs = view[1] >= view[0] ? bigintToNumber(view[1] - view[0]) : null;
        samples.push(freezeSample({ scope: 'frame', ns: frameNs, queryStartIndex: active.base, queryEndIndex: active.base + 1 }));
        for (let i = 0; i < this.passIds.length; i += 1) {
          const start = view[2 + i * 2];
          const end = view[3 + i * 2];
          const ns = end >= start ? bigintToNumber(end - start) : null;
          samples.push(freezeSample({ scope: `pass:${this.passIds[i]}`, ns, queryStartIndex: active.base + 2 + i * 2, queryEndIndex: active.base + 3 + i * 2 }));
        }
        this.sampleCount += 1;
        this.latest = Object.freeze({
          source: 'timestamp-query',
          frameNumber: active.frameNumber,
          submittedFrameCount: active.submittedFrameCount,
          capturedAtMs: nowMs(),
          frame: samples[0],
          passes: Object.freeze(samples.slice(1)),
          sampleCount: this.sampleCount,
        });
        return this.latest;
      })
      .catch(() => { this.mappedFailure = 'timestamp-query-map-failed'; return null; })
      .finally(() => {
        try { if (typeof buffer.unmap === 'function') buffer.unmap(); } catch (error) { /* sanitized */ }
        this.inflightBySlot.delete(active.slot);
        this.pending.delete(pending);
      });
    this.pending.add(pending);
  }

  snapshot({ submittedFrameCount = null } = {}) {
    if (!this.supported) return unavailable(this.unavailableReason || this.mappedFailure || 'timestamp-query-unavailable');
    const latest = this.latest;
    if (!latest) {
      return Object.freeze({
        supported: true,
        source: 'timestamp-query',
        unavailableReason: this.mappedFailure,
        latest: null,
        latestFrameNs: null,
        latestFrameMs: null,
        sampleCount: 0,
        sampleAgeFrames: null,
        sampleAgeMs: null,
        frameScope: 'frame',
        passScopes: Object.freeze(this.passIds.map((id) => `pass:${id}`)),
        pendingSamples: this.pending.size,
      });
    }
    const ageFrames = Number.isFinite(submittedFrameCount) && Number.isFinite(latest.submittedFrameCount)
      ? Math.max(0, submittedFrameCount - latest.submittedFrameCount)
      : null;
    return Object.freeze({
      supported: true,
      source: 'timestamp-query',
      unavailableReason: this.mappedFailure,
      latest,
      latestFrameNs: latest.frame.ns,
      latestFrameMs: latest.frame.ms,
      sampleCount: this.sampleCount,
      sampleAgeFrames: ageFrames,
      sampleAgeMs: Math.max(0, nowMs() - latest.capturedAtMs),
      frameScope: 'frame',
      passScopes: Object.freeze(this.passIds.map((id) => `pass:${id}`)),
      pendingSamples: this.pending.size,
    });
  }

  async flushTelemetry({ timeoutMs = 1000, submittedFrameCount = null } = {}) {
    if (!this.supported) return this.snapshot({ submittedFrameCount });
    const pending = [...this.pending];
    if (!pending.length) return this.snapshot({ submittedFrameCount });
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), Math.max(1, timeoutMs)));
    const result = await Promise.race([Promise.allSettled(pending), timeout]);
    if (result === 'timeout') {
      this.mappedFailure = 'timestamp-query-flush-timeout';
      return this.snapshot({ submittedFrameCount });
    }
    return this.snapshot({ submittedFrameCount });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.readbackBuffers) {
      try { if (typeof buffer.destroy === 'function') buffer.destroy(); } catch (error) { /* sanitized */ }
    }
    try { if (this.resolveBuffer && typeof this.resolveBuffer.destroy === 'function') this.resolveBuffer.destroy(); } catch (error) { /* sanitized */ }
    try { if (this.querySet && typeof this.querySet.destroy === 'function') this.querySet.destroy(); } catch (error) { /* sanitized */ }
    this.readbackBuffers = [];
    this.resolveBuffer = null;
    this.querySet = null;
    this.pending.clear();
    this.inflightBySlot.clear();
  }
}

export function unavailableTimestampTelemetry(reason) {
  return unavailable(reason || 'timestamp-query-unavailable');
}
