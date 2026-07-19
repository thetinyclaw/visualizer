// Browser-native same-origin asset loader/cache for Visualizer v4.
// Deduplicates in-flight requests, rejects cross-origin by default, and sanitizes public errors.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_GENERATED_PIXEL_DIMENSION = 4096;
const DEFAULT_ALLOWED_TYPES = Object.freeze([
  'application/json',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'text/plain',
]);

function assetError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeContentType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function immutableKey(url, responseType) {
  return `${responseType}:${url.href}`;
}

function mergeSignals(signals) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller;
}

function decodePathname(pathname) {
  const rawSegments = String(pathname || '').split('/');
  const decoded = [];
  for (const segment of rawSegments) {
    let value = segment;
    for (let depth = 0; depth < 3; depth += 1) {
      try {
        const next = decodeURIComponent(value);
        if (next === value) break;
        value = next;
      } catch (error) {
        throw assetError('asset-url-invalid', 'Asset URL is invalid.');
      }
    }
    if (value === '..' || value.includes('/') || value.includes('\\')) {
      throw assetError('asset-path-traversal-rejected', 'Asset path traversal is rejected.');
    }
    if (value === '.' || value === '') continue;
    decoded.push(value);
  }
  return `/${decoded.join('/')}`;
}

function normalizeBasePath(basePath, baseUrl) {
  if (!basePath) return null;
  const url = new URL(basePath, baseUrl);
  return `${decodePathname(url.pathname).replace(/\/+$/, '')}/`;
}

function isUnderBasePath(pathname, normalizedBasePath) {
  if (!normalizedBasePath) return true;
  const normalized = `${decodePathname(pathname).replace(/\/+$/, '')}/`;
  return normalized === normalizedBasePath || normalized.startsWith(normalizedBasePath);
}

function resolveSameOriginUrl(input, baseUrl = globalThis.location?.href || 'http://localhost/', allowedBasePath = null) {
  let url;
  let base;
  try {
    base = new URL(baseUrl);
    url = new URL(input, base);
  } catch (error) {
    throw assetError('asset-url-invalid', 'Asset URL is invalid.');
  }
  if (url.origin !== base.origin) throw assetError('asset-cross-origin-rejected', 'Cross-origin assets are rejected by default.');
  if (!['http:', 'https:'].includes(url.protocol)) throw assetError('asset-url-scheme-rejected', 'Only same-origin HTTP(S) assets are allowed.');
  const normalizedBasePath = normalizeBasePath(allowedBasePath, base);
  if (!isUnderBasePath(url.pathname, normalizedBasePath)) throw assetError('asset-path-outside-base-rejected', 'Asset URL is outside the allowed base path.');
  return url;
}

function validateFinalResponseUrl(response, requestUrl, allowedBasePath) {
  const finalUrl = response?.url;
  if (typeof finalUrl !== 'string' || finalUrl.length === 0) {
    throw assetError('asset-final-url-missing', 'Asset final URL is unavailable.');
  }
  const resolved = resolveSameOriginUrl(finalUrl, requestUrl.href, allowedBasePath);
  if (resolved.origin !== requestUrl.origin) throw assetError('asset-cross-origin-rejected', 'Cross-origin assets are rejected by default.');
  return resolved;
}

function inferResponseType(contentType, explicit) {
  if (explicit) return explicit;
  const type = sanitizeContentType(contentType);
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type.startsWith('image/')) return 'blob';
  if (type === 'text/plain') return 'text';
  return 'arrayBuffer';
}

function byteLengthOf(data, fallback = 0) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data && typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  return fallback || JSON.stringify(data).length;
}

async function readBoundedBytes(response, maxBytes, signal) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength && contentLength > maxBytes) throw assetError('asset-too-large', 'Asset exceeds configured size bound.');
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        if (signal?.aborted) throw assetError('asset-aborted', 'Asset request was aborted or timed out.');
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (error) { /* sanitized below */ }
          throw assetError('asset-too-large', 'Asset exceeds configured size bound.');
        }
        chunks.push(chunk);
      }
    } finally {
      if (signal?.aborted) {
        try { await reader.cancel(); } catch (error) { /* sanitized below */ }
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw assetError('asset-too-large', 'Asset exceeds configured size bound.');
  return new Uint8Array(buffer);
}

async function decodeBoundedResponse(response, responseType, maxBytes, signal) {
  const bytes = await readBoundedBytes(response, maxBytes, signal);
  if (responseType === 'arrayBuffer') return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (responseType === 'blob') return new Blob([bytes], { type: sanitizeContentType(response.headers?.get?.('content-type')) || undefined });
  const text = new TextDecoder().decode(bytes);
  if (responseType === 'text') return text;
  if (responseType === 'json') {
    try { return Object.freeze(JSON.parse(text)); }
    catch (error) { throw assetError('asset-decode-failed', 'Asset could not be decoded.'); }
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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

function assertPositiveBoundedInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_GENERATED_PIXEL_DIMENSION) {
    throw assetError('asset-generated-invalid', `Generated pixel ${label} must be a positive bounded integer.`);
  }
  return value;
}

function assertByte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw assetError('asset-generated-invalid', `Generated pixel ${label} channel must be an integer byte.`);
  }
  return value;
}

function byteArrayFrom(value, label) {
  const values = ArrayBuffer.isView(value) ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) : value;
  if (!Array.isArray(values)) throw assetError('asset-generated-invalid', `Generated pixel ${label} must be an array of byte values.`);
  return values.map((entry, index) => assertByte(entry, `${label}[${index}]`));
}

function makeGeneratedPixel(asset, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const width = assertPositiveBoundedInteger(asset.width ?? 1, 'width');
  const height = assertPositiveBoundedInteger(asset.height ?? 1, 'height');
  const expectedBytes = width * height * 4;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maxBytes) {
    throw assetError('asset-too-large', 'Generated pixel texture exceeds configured size bound.');
  }

  let pixels;
  if (asset.pixels !== undefined) {
    const source = byteArrayFrom(asset.pixels, 'pixels');
    if (source.length !== expectedBytes) {
      throw assetError('asset-generated-invalid', 'Generated pixel payload length must exactly match width × height × 4.');
    }
    pixels = new Uint8Array(source);
  } else {
    const rgba = byteArrayFrom(asset.rgba ?? [255, 255, 255, 255], 'rgba');
    if (rgba.length !== 4) {
      throw assetError('asset-generated-invalid', 'Generated pixel rgba payload must contain exactly four byte values.');
    }
    pixels = new Uint8Array(expectedBytes);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(rgba, offset);
  }
  return Object.freeze({ width, height, pixels });
}

const BUILTIN_GENERATED_LOADERS = Object.freeze({
  'blue-noise': makeBlueNoise,
  pixel: makeGeneratedPixel,
  'pixel-texture': makeGeneratedPixel,
});
const ALLOWED_GENERATED_LOADER_NAMES = Object.freeze(new Set(Object.keys(BUILTIN_GENERATED_LOADERS)));

function mergeGeneratedLoaders(generatedLoaders = {}) {
  const merged = { ...BUILTIN_GENERATED_LOADERS };
  for (const [name, loader] of Object.entries(generatedLoaders || {})) {
    if (ALLOWED_GENERATED_LOADER_NAMES.has(name) && typeof loader === 'function') merged[name] = loader;
  }
  return merged;
}

export class AssetLoader {
  constructor({
    baseUrl = globalThis.location?.href || 'http://localhost/',
    allowedBasePath = null,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    allowedContentTypes = DEFAULT_ALLOWED_TYPES,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw assetError('asset-fetch-unavailable', 'Fetch API is unavailable.');
    this.baseUrl = baseUrl;
    this.allowedBasePath = allowedBasePath;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.allowedContentTypes = new Set([...allowedContentTypes].map(sanitizeContentType));
  }

  async load(uri, options = {}) {
    const allowedBasePath = options.allowedBasePath ?? this.allowedBasePath;
    const url = resolveSameOriginUrl(uri, this.baseUrl, allowedBasePath);
    const maxBytes = Number(options.maxBytes ?? this.maxBytes);
    const timeoutMs = Number(options.timeoutMs ?? this.timeoutMs);
    const timeoutController = new AbortController();
    const mergedController = mergeSignals([timeoutController.signal, options.signal]);
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: options.cacheMode || 'force-cache',
        signal: mergedController.signal,
        headers: Object.freeze({ Accept: 'application/json, application/octet-stream, image/*;q=0.9, text/plain;q=0.5' }),
      });
      if (!response || response.type === 'opaque' || response.type === 'opaqueredirect') throw assetError('asset-fetch-failed', 'Asset request failed.');
      if (!response.ok) throw assetError('asset-fetch-failed', 'Asset request failed.');
      const finalUrl = validateFinalResponseUrl(response, url, allowedBasePath);
      const contentType = sanitizeContentType(response.headers?.get?.('content-type'));
      const allowed = this.allowedContentTypes.has(contentType) || [...this.allowedContentTypes].some((type) => type.endsWith('/*') && contentType.startsWith(type.slice(0, -1)));
      if (contentType && !allowed) throw assetError('asset-content-type-rejected', 'Asset content type is not allowed.');
      const responseType = inferResponseType(contentType, options.responseType);
      const data = await decodeBoundedResponse(response, responseType, maxBytes, mergedController.signal);
      const byteLength = byteLengthOf(data, Number(response.headers?.get?.('content-length') || 0));
      if (byteLength > maxBytes) throw assetError('asset-too-large', 'Asset exceeds configured size bound.');
      return Object.freeze({
        key: immutableKey(finalUrl, responseType),
        url: finalUrl.href,
        responseType,
        contentType: contentType || null,
        byteLength,
        data,
      });
    } catch (error) {
      if (error?.code) throw error;
      if (mergedController.signal.aborted) throw assetError('asset-aborted', 'Asset request was aborted or timed out.');
      throw assetError('asset-fetch-failed', 'Asset request failed.');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class AssetCache {
  constructor(loader = new AssetLoader(), { generatedLoaders = BUILTIN_GENERATED_LOADERS } = {}) {
    if (loader && typeof loader.load !== 'function' && !(loader instanceof AssetLoader)) {
      const options = loader;
      loader = new AssetLoader(options);
      generatedLoaders = options.generatedLoaders || generatedLoaders;
    }
    this.loader = loader;
    this.generatedLoaders = new Map(Object.entries(mergeGeneratedLoaders(generatedLoaders)));
    this.entries = new Map();
    this.inflight = new Map();
    this.session = 0;
  }

  canonicalKey(uri, responseType = 'auto') {
    const url = resolveSameOriginUrl(uri, this.loader.baseUrl, this.loader.allowedBasePath);
    return immutableKey(url, responseType);
  }

  async load(uriOrAsset, options = {}) {
    if (uriOrAsset && typeof uriOrAsset === 'object') return this.loadAssetDescriptor(uriOrAsset, options);
    const url = resolveSameOriginUrl(uriOrAsset, this.loader.baseUrl, options.allowedBasePath ?? this.loader.allowedBasePath);
    const key = immutableKey(url, options.responseType || 'auto');
    const cached = this.entries.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const session = this.session;
    const promise = this.loader.load(url.href, { ...options, signal: mergeSignals([controller.signal, options.signal]).signal }).then((asset) => {
      if (this.session !== session || !this.inflight.has(key)) throw assetError('asset-aborted', 'Asset request was aborted or timed out.');
      const finalKey = immutableKey(new URL(asset.url), asset.responseType);
      const immutableAsset = Object.freeze({ ...asset, key: finalKey });
      this.entries.set(key, immutableAsset);
      this.entries.set(finalKey, immutableAsset);
      return immutableAsset;
    }).finally(() => {
      const entry = this.inflight.get(key);
      if (entry?.promise === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, { promise, controller, session, url: url.href });
    return promise;
  }

  loadAssetDescriptor(asset, options = {}) {
    if (!asset || typeof asset.id !== 'string' || typeof asset.type !== 'string' || typeof asset.uri !== 'string') {
      return Promise.reject(assetError('asset-load-failed', 'Scene asset could not be loaded.'));
    }
    if (asset.uri.startsWith('generated://')) return this.loadGeneratedAsset(asset);
    return this.load(asset.uri, { ...options, responseType: asset.type === 'json' ? 'json' : options.responseType });
  }

  loadGeneratedAsset(asset) {
    const key = `generated:${asset.id}:${asset.uri}`;
    const cached = this.entries.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) return pending.promise;
    const session = this.session;
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      const generatedKey = asset.uri.slice('generated://'.length);
      const loader = this.generatedLoaders.get(generatedKey);
      if (!loader) throw assetError('asset-load-failed', 'Scene asset could not be loaded.');
      const data = await loader(asset, { maxBytes: this.loader.maxBytes });
      if (controller.signal.aborted || this.session !== session || !this.inflight.has(key)) throw assetError('asset-aborted', 'Asset request was aborted or timed out.');
      const byteLength = data?.pixels ? byteLengthOf(data.pixels) : byteLengthOf(data);
      const immutableAsset = Object.freeze({ key, url: asset.uri, responseType: asset.type, contentType: 'generated', byteLength, data });
      this.entries.set(key, immutableAsset);
      this.entries.set(asset.id, immutableAsset);
      return immutableAsset;
    }).catch((error) => {
      if (error?.code) throw error;
      throw assetError('asset-load-failed', 'Scene asset could not be loaded.');
    }).finally(() => {
      const entry = this.inflight.get(key);
      if (entry?.promise === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, { promise, controller, session, url: asset.uri });
    return promise;
  }

  async loadManifest(assets, options = {}) {
    const values = await Promise.all(assets.map((asset) => this.loadAssetDescriptor(asset, options)));
    return new Map(assets.map((asset, index) => [asset.id, values[index]?.data ?? values[index]]));
  }

  get(key) { return this.entries.get(key) || null; }

  release(keyOrUri) {
    let asset = this.entries.get(keyOrUri) || [...this.entries.values()].find((value) => value.url === keyOrUri);
    let released = false;
    for (const [key, value] of [...this.entries]) {
      if (value === asset || value.url === keyOrUri || key === keyOrUri) {
        this.entries.delete(key);
        released = true;
      }
    }
    for (const [key, entry] of [...this.inflight]) {
      if (key === keyOrUri || entry.url === keyOrUri || entry.url === this.safeHref(keyOrUri)) {
        entry.controller.abort();
        this.inflight.delete(key);
        released = true;
      }
    }
    return released;
  }

  safeHref(value) {
    try { return resolveSameOriginUrl(value, this.loader.baseUrl, this.loader.allowedBasePath).href; }
    catch (error) { return null; }
  }

  clear({ abortInflight = false } = {}) {
    this.session += 1;
    this.entries.clear();
    if (abortInflight) {
      for (const entry of this.inflight.values()) entry.controller.abort();
      this.inflight.clear();
    }
  }

  telemetry() {
    let knownBytes = 0;
    const seen = new Set();
    for (const asset of this.entries.values()) {
      if (seen.has(asset)) continue;
      seen.add(asset);
      knownBytes += asset.byteLength || 0;
    }
    return Object.freeze({ entries: seen.size, inflight: this.inflight.size, knownBytes });
  }
}

export { resolveSameOriginUrl, makeBlueNoise };
