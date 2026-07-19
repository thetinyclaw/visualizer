// Browser-native same-origin asset loader/cache for Visualizer v4.
// Deduplicates in-flight requests, rejects cross-origin by default, and sanitizes public errors.

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
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

function resolveSameOriginUrl(input, baseUrl = globalThis.location?.href || 'http://localhost/') {
  let url;
  try {
    url = new URL(input, baseUrl);
  } catch (error) {
    throw assetError('asset-url-invalid', 'Asset URL is invalid.');
  }
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) throw assetError('asset-cross-origin-rejected', 'Cross-origin assets are rejected by default.');
  if (!['http:', 'https:'].includes(url.protocol)) throw assetError('asset-url-scheme-rejected', 'Only same-origin HTTP(S) assets are allowed.');
  return url;
}

function inferResponseType(contentType, explicit) {
  if (explicit) return explicit;
  const type = sanitizeContentType(contentType);
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type.startsWith('image/')) return 'blob';
  return 'arrayBuffer';
}

async function decodeResponse(response, responseType) {
  if (responseType === 'json') return Object.freeze(await response.json());
  if (responseType === 'text') return response.text();
  if (responseType === 'blob') return response.blob();
  return response.arrayBuffer();
}

export class AssetLoader {
  constructor({
    baseUrl = globalThis.location?.href || 'http://localhost/',
    fetchImpl = globalThis.fetch?.bind(globalThis),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    allowedContentTypes = DEFAULT_ALLOWED_TYPES,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw assetError('asset-fetch-unavailable', 'Fetch API is unavailable.');
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.allowedContentTypes = new Set([...allowedContentTypes].map(sanitizeContentType));
  }

  async load(uri, options = {}) {
    const url = resolveSameOriginUrl(uri, this.baseUrl);
    const maxBytes = Number(options.maxBytes ?? this.maxBytes);
    const timeoutMs = Number(options.timeoutMs ?? this.timeoutMs);
    const timeoutController = new AbortController();
    const mergedController = mergeSignals([timeoutController.signal, options.signal]);
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: options.cacheMode || 'force-cache',
        signal: mergedController.signal,
        headers: Object.freeze({ Accept: 'application/json, application/octet-stream, image/*;q=0.9, text/plain;q=0.5' }),
      });
      if (!response || !response.ok) throw assetError('asset-fetch-failed', 'Asset request failed.');
      const contentLength = Number(response.headers?.get?.('content-length') || 0);
      if (contentLength && contentLength > maxBytes) throw assetError('asset-too-large', 'Asset exceeds configured size bound.');
      const contentType = sanitizeContentType(response.headers?.get?.('content-type'));
      const allowed = this.allowedContentTypes.has(contentType) || [...this.allowedContentTypes].some((type) => type.endsWith('/*') && contentType.startsWith(type.slice(0, -1)));
      if (contentType && !allowed) throw assetError('asset-content-type-rejected', 'Asset content type is not allowed.');
      const responseType = inferResponseType(contentType, options.responseType);
      const data = await decodeResponse(response, responseType);
      const byteLength = data instanceof ArrayBuffer ? data.byteLength :
        data && typeof Blob !== 'undefined' && data instanceof Blob ? data.size :
        typeof data === 'string' ? new TextEncoder().encode(data).byteLength :
        contentLength || JSON.stringify(data).length;
      if (byteLength > maxBytes) throw assetError('asset-too-large', 'Asset exceeds configured size bound.');
      return Object.freeze({
        key: immutableKey(url, responseType),
        url: url.href,
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
  constructor(loader = new AssetLoader()) {
    this.loader = loader;
    this.entries = new Map();
    this.inflight = new Map();
  }

  async load(uri, options = {}) {
    const url = resolveSameOriginUrl(uri, this.loader.baseUrl);
    const key = immutableKey(url, options.responseType || 'auto');
    const cached = this.entries.get(key);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = this.loader.load(url.href, options).then((asset) => {
      const finalKey = immutableKey(url, asset.responseType);
      const immutableAsset = Object.freeze({ ...asset, key: finalKey });
      this.entries.set(key, immutableAsset);
      this.entries.set(finalKey, immutableAsset);
      return immutableAsset;
    }).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  get(key) { return this.entries.get(key) || null; }

  release(keyOrUri) {
    const asset = this.entries.get(keyOrUri) || [...this.entries.values()].find((value) => value.url === keyOrUri);
    if (!asset) return false;
    for (const [key, value] of [...this.entries]) {
      if (value === asset || value.url === keyOrUri) this.entries.delete(key);
    }
    return true;
  }

  clear({ abortInflight = false } = {}) {
    this.entries.clear();
    if (abortInflight) this.inflight.clear();
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

export { resolveSameOriginUrl };
