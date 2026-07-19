// Executable WebGPU resources and deduplicated scene-asset loading for Visualizer v4.

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

function usageFlags(names, browserFlags, fallback, label) {
  if (!Array.isArray(names) || names.length === 0) throw new TypeError(`${label} usage must be a nonempty array.`);
  return names.reduce((flags, name) => {
    const key = name.toUpperCase().replaceAll('-', '_');
    const value = browserFlags && browserFlags[key] !== undefined ? browserFlags[key] : fallback[name];
    if (value === undefined) throw new TypeError(`Unsupported ${label} usage.`);
    return flags | value;
  }, 0);
}

function assertId(id) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('Resource id is required.');
}

function asBytes(data) {
  if (!ArrayBuffer.isView(data)) throw new TypeError('GPU upload data must be an ArrayBuffer view.');
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export class GpuResourceManager {
  constructor(device, {
    bufferUsage = globalThis.GPUBufferUsage,
    textureUsage = globalThis.GPUTextureUsage,
  } = {}) {
    if (!device || typeof device.createBuffer !== 'function' || typeof device.createTexture !== 'function') {
      throw new TypeError('GpuResourceManager requires a GPUDevice-compatible object.');
    }
    this.device = device;
    this.bufferUsage = bufferUsage;
    this.textureUsage = textureUsage;
    this.resources = new Map();
    this.disposed = false;
  }

  get size() { return this.resources.size; }

  get(id) { return this.resources.get(id) || null; }

  assertAvailable(id) {
    assertId(id);
    if (this.disposed) throw new Error('GPU resource manager is disposed.');
    if (this.resources.has(id)) throw new Error(`GPU resource ${id} already exists.`);
  }

  track(id, resource) {
    this.resources.set(id, resource);
    return resource;
  }

  createBuffer(id, { byteLength, usage, data = null, label = id } = {}) {
    this.assertAvailable(id);
    if (!Number.isInteger(byteLength) || byteLength <= 0) throw new TypeError('GPU buffer byteLength must be positive.');
    const size = Math.ceil(byteLength / 4) * 4;
    const buffer = this.device.createBuffer({
      label,
      size,
      usage: usageFlags(usage, this.bufferUsage, BUFFER_USAGE_FALLBACK, 'buffer'),
    });
    this.track(id, buffer);
    if (data !== null) {
      const bytes = asBytes(data);
      if (bytes.byteLength > size) {
        this.destroy(id);
        throw new RangeError('GPU buffer upload exceeds allocated size.');
      }
      this.device.queue.writeBuffer(buffer, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return buffer;
  }

  createTextureFromPixels(id, {
    width,
    height,
    pixels,
    format = 'rgba8unorm',
    usage = ['texture-binding', 'copy-dst'],
  } = {}) {
    this.assertAvailable(id);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError('GPU texture dimensions must be positive integers.');
    }
    const source = asBytes(pixels);
    const sourceStride = width * 4;
    if (source.byteLength !== sourceStride * height) throw new RangeError('RGBA texture pixel length does not match dimensions.');
    const texture = this.device.createTexture({
      label: id,
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage: usageFlags(usage, this.textureUsage, TEXTURE_USAGE_FALLBACK, 'texture'),
    });
    this.track(id, texture);

    // WebGPU requires bytesPerRow alignment to 256 for multi-row writeTexture uploads.
    const bytesPerRow = height === 1 ? sourceStride : Math.ceil(sourceStride / 256) * 256;
    let upload = source;
    if (bytesPerRow !== sourceStride) {
      upload = new Uint8Array(bytesPerRow * height);
      for (let row = 0; row < height; row += 1) {
        upload.set(source.subarray(row * sourceStride, (row + 1) * sourceStride), row * bytesPerRow);
      }
    }
    this.device.queue.writeTexture(
      { texture },
      upload,
      { offset: 0, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    return texture;
  }

  destroy(id) {
    const resource = this.resources.get(id);
    if (!resource) return false;
    this.resources.delete(id);
    if (typeof resource.destroy === 'function') resource.destroy();
    return true;
  }

  dispose() {
    for (const id of [...this.resources.keys()]) this.destroy(id);
    this.disposed = true;
  }
}

function publicAssetError() {
  const error = new Error('Scene asset could not be loaded.');
  error.code = 'asset-load-failed';
  return error;
}

function makeBlueNoise() {
  const width = 64;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);
  let state = 0x9e3779b9;
  for (let index = 0; index < width * height; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const value = state & 0xff;
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return Object.freeze({ width, height, pixels });
}

export class AssetCache {
  constructor({
    fetchFn = globalThis.fetch,
    generatedLoaders = { 'blue-noise': makeBlueNoise },
  } = {}) {
    this.fetchFn = fetchFn;
    this.generatedLoaders = new Map(Object.entries(generatedLoaders));
    this.entries = new Map();
  }

  get size() { return this.entries.size; }

  get(id) { return this.entries.get(id) || null; }

  load(asset) {
    if (!asset || typeof asset.id !== 'string' || typeof asset.type !== 'string' || typeof asset.uri !== 'string') {
      return Promise.reject(publicAssetError());
    }
    if (this.entries.has(asset.id)) return this.entries.get(asset.id);
    const pending = this.loadUncached(asset).catch(() => {
      this.entries.delete(asset.id);
      throw publicAssetError();
    });
    this.entries.set(asset.id, pending);
    return pending;
  }

  async loadUncached(asset) {
    if (asset.uri.startsWith('generated://')) {
      const key = asset.uri.slice('generated://'.length);
      const loader = this.generatedLoaders.get(key);
      if (!loader) throw new Error('Unknown generated asset.');
      return loader(asset);
    }
    if (typeof this.fetchFn !== 'function') throw new Error('Fetch unavailable.');
    const response = await this.fetchFn(asset.uri, { credentials: 'same-origin' });
    if (!response || !response.ok) throw new Error('Asset response failed.');
    if (asset.type === 'json') return response.json();
    return new Uint8Array(await response.arrayBuffer());
  }

  async loadManifest(assets) {
    const values = await Promise.all(assets.map((asset) => this.load(asset)));
    return new Map(assets.map((asset, index) => [asset.id, values[index]]));
  }

  clear() {
    this.entries.clear();
  }
}
