// Executable WebGPU resource manager for Visualizer v4.
// Owns only resources created through this manager and reports known allocations honestly.
// Generation checks make stale handles from earlier devices non-reusable.

export const RESOURCE_KINDS = Object.freeze({
  BUFFER: 'buffer',
  TEXTURE: 'texture',
  SAMPLER: 'sampler',
  BIND_GROUP_LAYOUT: 'bind-group-layout',
  BIND_GROUP: 'bind-group',
});

const DEFAULT_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
const UNKNOWN_BYTES = null;
const BUFFER_USAGE_FALLBACK = Object.freeze({
  'copy-src': 0x0004,
  'copy-dst': 0x0008,
  index: 0x0010,
  vertex: 0x0020,
  uniform: 0x0040,
  storage: 0x0080,
  indirect: 0x0100,
  query: 0x0200,
});
const TEXTURE_USAGE_FALLBACK = Object.freeze({
  'copy-src': 0x01,
  'copy-dst': 0x02,
  'texture-binding': 0x04,
  'storage-binding': 0x08,
  'render-attachment': 0x10,
});
let nextObjectKeyId = 1;
const objectKeyIds = new WeakMap();

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,96}$/.test(id)) {
    throw publicError('invalid-resource-id', 'Resource id must be a stable short identifier.');
  }
}

function cloneDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw publicError('invalid-resource-descriptor', 'Resource descriptor must be an object.');
  }
  return structuredCloneSafe(descriptor);
}

function structuredCloneSafe(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => structuredCloneSafe(item));
  const prototype = Object.getPrototypeOf(value);
  if (prototype && prototype !== Object.prototype) return value;
  const copy = {};
  for (const [key, inner] of Object.entries(value)) copy[key] = structuredCloneSafe(inner);
  return copy;
}

function stableDescriptorKey(kind, descriptor) {
  return `${kind}:${stableJson(descriptor)}`;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype && prototype !== Object.prototype) {
    if (!objectKeyIds.has(value)) objectKeyIds.set(value, nextObjectKeyId++);
    return `{"$objectRef":${objectKeyIds.get(value)}}`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function textureDimension(size) {
  if (Array.isArray(size)) return { width: Number(size[0]), height: Number(size[1] || 1), depthOrArrayLayers: Number(size[2] || 1) };
  if (typeof size === 'number') return { width: Number(size), height: 1, depthOrArrayLayers: 1 };
  if (size && typeof size === 'object') {
    return {
      width: Number(size.width),
      height: Number(size.height || 1),
      depthOrArrayLayers: Number(size.depthOrArrayLayers || size.depth || 1),
    };
  }
  return null;
}

function bytesPerTexel(format) {
  const table = {
    r8unorm: 1,
    r8snorm: 1,
    r8uint: 1,
    r8sint: 1,
    rg8unorm: 2,
    rg8snorm: 2,
    rg8uint: 2,
    rg8sint: 2,
    rgba8unorm: 4,
    'rgba8unorm-srgb': 4,
    rgba8snorm: 4,
    rgba8uint: 4,
    rgba8sint: 4,
    bgra8unorm: 4,
    'bgra8unorm-srgb': 4,
    r16uint: 2,
    r16sint: 2,
    r16float: 2,
    rg16uint: 4,
    rg16sint: 4,
    rg16float: 4,
    rgba16uint: 8,
    rgba16sint: 8,
    rgba16float: 8,
    r32uint: 4,
    r32sint: 4,
    r32float: 4,
    rg32uint: 8,
    rg32sint: 8,
    rg32float: 8,
    rgba32uint: 16,
    rgba32sint: 16,
    rgba32float: 16,
    depth24plus: 4,
    'depth24plus-stencil8': 4,
    depth32float: 4,
  };
  return table[format] || UNKNOWN_BYTES;
}

function estimateTextureBytes(descriptor) {
  const dim = textureDimension(descriptor.size);
  const bpt = bytesPerTexel(descriptor.format);
  if (!dim || !bpt || !Number.isFinite(dim.width) || !Number.isFinite(dim.height) || !Number.isFinite(dim.depthOrArrayLayers)) return UNKNOWN_BYTES;
  const mipLevelCount = Number(descriptor.mipLevelCount || 1);
  const sampleCount = Number(descriptor.sampleCount || 1);
  let totalTexels = 0;
  for (let level = 0; level < mipLevelCount; level += 1) {
    totalTexels += Math.max(1, Math.ceil(dim.width / (2 ** level))) *
      Math.max(1, Math.ceil(dim.height / (2 ** level))) *
      Math.max(1, Math.ceil(dim.depthOrArrayLayers / (2 ** level)));
  }
  const bytes = totalTexels * bpt * Math.max(1, sampleCount);
  return Number.isFinite(bytes) ? bytes : UNKNOWN_BYTES;
}

function knownBytesFor(kind, descriptor) {
  if (kind === RESOURCE_KINDS.BUFFER) {
    const size = Number(descriptor.size);
    return Number.isFinite(size) && size >= 0 ? size : UNKNOWN_BYTES;
  }
  if (kind === RESOURCE_KINDS.TEXTURE) return estimateTextureBytes(descriptor);
  return 0;
}

function usageFlags(names, browserFlags, fallback, label) {
  if (typeof names === 'number') return names;
  if (!Array.isArray(names) || names.length === 0) throw publicError('invalid-resource-descriptor', `${label} usage must be a nonempty array or numeric flags.`);
  return names.reduce((flags, name) => {
    const key = String(name).toUpperCase().replaceAll('-', '_');
    const value = browserFlags && browserFlags[key] !== undefined ? browserFlags[key] : fallback[name];
    if (value === undefined) throw publicError('invalid-resource-descriptor', `Unsupported ${label} usage.`);
    return flags | value;
  }, 0);
}

function asBytes(data) {
  if (!ArrayBuffer.isView(data)) throw publicError('invalid-resource-descriptor', 'GPU upload data must be an ArrayBuffer view.');
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function destroyGpuResource(resource) {
  if (resource && typeof resource.destroy === 'function') resource.destroy();
}

export class DeviceResourceManager {
  constructor(lifecycle, { memoryBudgetBytes = DEFAULT_MEMORY_BUDGET_BYTES, labelPrefix = 'v4' } = {}) {
    if (!lifecycle || typeof lifecycle.registerResource !== 'function') {
      throw publicError('missing-gpu-lifecycle', 'DeviceResourceManager requires a GpuLifecycle.');
    }
    this.lifecycle = lifecycle;
    this.labelPrefix = String(labelPrefix || 'v4');
    this.memoryBudgetBytes = Number(memoryBudgetBytes);
    this.entries = new Map();
    this.knownAllocatedBytes = 0;
    this.unknownAllocationCount = 0;
    this.generation = lifecycle.generation;
    this.unregister = lifecycle.registerResource(this, { persistent: true });
  }

  get size() { return this.entries.size; }

  createBuffer(id, descriptor) { return this.createResource(RESOURCE_KINDS.BUFFER, id, descriptor, 'createBuffer'); }
  createTexture(id, descriptor) { return this.createResource(RESOURCE_KINDS.TEXTURE, id, descriptor, 'createTexture'); }
  createSampler(id, descriptor = {}) { return this.createResource(RESOURCE_KINDS.SAMPLER, id, descriptor, 'createSampler'); }
  createBindGroupLayout(id, descriptor) { return this.createResource(RESOURCE_KINDS.BIND_GROUP_LAYOUT, id, descriptor, 'createBindGroupLayout'); }
  createBindGroup(id, descriptor) { return this.createResource(RESOURCE_KINDS.BIND_GROUP, id, descriptor, 'createBindGroup'); }

  createBufferFromData(id, { byteLength, usage = ['storage', 'copy-dst'], data = null, label = id } = {}) {
    const size = alignTo(Number(byteLength ?? data?.byteLength), 4);
    if (!Number.isFinite(size) || size <= 0) throw publicError('invalid-resource-descriptor', 'GPU buffer byteLength must be positive.');
    const handle = this.createBuffer(id, { label, size, usage: usageFlags(usage, globalThis.GPUBufferUsage, BUFFER_USAGE_FALLBACK, 'buffer') });
    if (data !== null && this.lifecycle.device?.queue?.writeBuffer) {
      const bytes = asBytes(data);
      if (bytes.byteLength > size) {
        this.release(id);
        throw publicError('resource-upload-too-large', 'GPU buffer upload exceeds allocated size.');
      }
      this.lifecycle.device.queue.writeBuffer(handle.resource, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return handle;
  }

  createTextureFromPixels(id, { width, height, pixels, format = 'rgba8unorm', usage = ['texture-binding', 'copy-dst'], label = id } = {}) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw publicError('invalid-resource-descriptor', 'GPU texture dimensions must be positive integers.');
    }
    const source = asBytes(pixels);
    const sourceStride = width * 4;
    if (source.byteLength !== sourceStride * height) throw publicError('resource-upload-too-large', 'RGBA texture pixel length does not match dimensions.');
    const handle = this.createTexture(id, {
      label,
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage: usageFlags(usage, globalThis.GPUTextureUsage, TEXTURE_USAGE_FALLBACK, 'texture'),
    });
    if (this.lifecycle.device?.queue?.writeTexture) {
      const bytesPerRow = height === 1 ? sourceStride : alignTo(sourceStride, 256);
      let upload = source;
      if (bytesPerRow !== sourceStride) {
        upload = new Uint8Array(bytesPerRow * height);
        for (let row = 0; row < height; row += 1) upload.set(source.subarray(row * sourceStride, (row + 1) * sourceStride), row * bytesPerRow);
      }
      this.lifecycle.device.queue.writeTexture(
        { texture: handle.resource },
        upload,
        { offset: 0, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
    }
    return handle;
  }

  createResource(kind, id, descriptor, deviceMethod) {
    assertId(id);
    const device = this.requireCurrentDevice();
    const safeDescriptor = cloneDescriptor(descriptor);
    if (!safeDescriptor.label) safeDescriptor.label = `${this.labelPrefix}:${kind}:${id}:g${this.lifecycle.generation}`;
    const key = stableDescriptorKey(kind, safeDescriptor);
    const existing = this.entries.get(id);
    if (existing && existing.kind === kind && existing.generation === this.lifecycle.generation && existing.key === key && existing.resource) {
      return this.publicHandle(existing);
    }
    if (existing) this.destroyEntry(existing);
    const bytes = knownBytesFor(kind, safeDescriptor);
    if (bytes !== UNKNOWN_BYTES && this.knownAllocatedBytes + bytes > this.memoryBudgetBytes) {
      throw publicError('resource-memory-budget-exceeded', 'Known GPU resource allocations would exceed the configured budget.');
    }
    if (typeof device[deviceMethod] !== 'function') {
      throw publicError('unsupported-gpu-resource', 'GPU device does not support this resource constructor.');
    }
    const resource = device[deviceMethod](safeDescriptor);
    const entry = { id, kind, descriptor: safeDescriptor, key, resource, generation: this.lifecycle.generation, knownBytes: bytes };
    this.entries.set(id, entry);
    if (bytes === UNKNOWN_BYTES) this.unknownAllocationCount += 1;
    else this.knownAllocatedBytes += bytes;
    return this.publicHandle(entry);
  }

  get(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.generation !== this.lifecycle.generation || !entry.resource) return null;
    return this.publicHandle(entry);
  }

  release(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.destroyEntry(entry);
    this.entries.delete(id);
    return true;
  }

  clear() {
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
    this.knownAllocatedBytes = 0;
    this.unknownAllocationCount = 0;
  }

  dispose() {
    for (const entry of this.entries.values()) {
      if (entry.resource) {
        destroyGpuResource(entry.resource);
        entry.resource = null;
      }
    }
    this.knownAllocatedBytes = 0;
    this.unknownAllocationCount = 0;
    this.generation = this.lifecycle.generation;
  }

  destroy() {
    this.clear();
    if (this.unregister) this.unregister();
    this.unregister = null;
  }

  recreateAll() {
    const descriptors = [...this.entries.values()].map((entry) => [entry.kind, entry.id, entry.descriptor]);
    this.dispose();
    return descriptors.map(([kind, id, descriptor]) => {
      switch (kind) {
        case RESOURCE_KINDS.BUFFER: return this.createBuffer(id, descriptor);
        case RESOURCE_KINDS.TEXTURE: return this.createTexture(id, descriptor);
        case RESOURCE_KINDS.SAMPLER: return this.createSampler(id, descriptor);
        case RESOURCE_KINDS.BIND_GROUP_LAYOUT: return this.createBindGroupLayout(id, descriptor);
        case RESOURCE_KINDS.BIND_GROUP: return this.createBindGroup(id, descriptor);
        default: throw publicError('unsupported-gpu-resource', 'Unsupported resource kind.');
      }
    });
  }

  isHandleCurrent(handle) {
    return Boolean(handle && handle.generation === this.lifecycle.generation && this.entries.get(handle.id)?.resource === handle.resource);
  }

  telemetry() {
    return Object.freeze({
      generation: this.lifecycle.generation,
      knownAllocatedBytes: this.knownAllocatedBytes,
      memoryBudgetBytes: this.memoryBudgetBytes,
      unknownAllocationCount: this.unknownAllocationCount,
      externalUsageBytes: null,
      externalUsageKnown: false,
      note: 'Only resources created through DeviceResourceManager are counted; browser/driver/external GPU usage is unknown.',
      resources: Object.freeze([...this.entries.values()].map((entry) => Object.freeze({
        id: entry.id,
        kind: entry.kind,
        generation: entry.generation,
        label: entry.descriptor.label || null,
        knownBytes: entry.knownBytes,
        live: Boolean(entry.resource),
      }))),
    });
  }

  requireCurrentDevice() {
    const device = this.lifecycle.device;
    if (!device || this.lifecycle.state !== 'ready') {
      throw publicError('gpu-device-not-ready', 'GPU device is not ready.');
    }
    if (this.generation !== this.lifecycle.generation) this.dispose();
    return device;
  }

  destroyEntry(entry) {
    if (entry.resource) destroyGpuResource(entry.resource);
    if (entry.knownBytes === UNKNOWN_BYTES) this.unknownAllocationCount = Math.max(0, this.unknownAllocationCount - 1);
    else this.knownAllocatedBytes = Math.max(0, this.knownAllocatedBytes - entry.knownBytes);
    entry.resource = null;
  }

  publicHandle(entry) {
    return Object.freeze({
      id: entry.id,
      kind: entry.kind,
      label: entry.descriptor.label || null,
      generation: entry.generation,
      knownBytes: entry.knownBytes,
      resource: entry.resource,
    });
  }
}
