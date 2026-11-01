'use strict';
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');

class DavError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

class DavClient {
  constructor({ endpoint, credentials, allowHttpForTests = false, timeout = 45000 }) {
    this.base = new URL(endpoint);
    if (this.base.username || this.base.password || this.base.search || this.base.hash ||
        (this.base.protocol !== 'https:' && !(allowHttpForTests && this.base.protocol === 'http:'))) {
      throw new DavError('invalid-endpoint');
    }
    if (!this.base.pathname.endsWith('/')) this.base.pathname += '/';
    this.credentials = credentials; this.timeout = timeout;
  }
  url(parts) {
    if (parts.some(p => typeof p !== 'string' || !p || p === '.' || p === '..' || /[/\\]/.test(p))) throw new DavError('invalid-remote-path');
    return new URL(parts.map(encodeURIComponent).join('/'), this.base);
  }
  async request(method, url, { headers = {}, body, file, signal } = {}) {
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw new DavError('invalid-remote-path');
    const { username, password } = await this.credentials();
    const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
    const size = file ? (await fs.promises.stat(file)).size : body ? Buffer.byteLength(body) : 0;
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      let stream;
      const req = transport.request(url, { method, signal, headers: { Authorization: authorization,
        'Content-Length': size, ...headers } }, res => {
        const chunks = []; let length = 0;
        res.on('data', chunk => {
          length += chunk.length;
          if (length > 1024 * 1024) { res.destroy(); reject(new DavError('response-too-large')); }
          else chunks.push(chunk);
        });
        res.on('error', () => reject(new DavError('network-error')));
        res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag,
          body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.setTimeout(this.timeout, () => req.destroy(new DavError('network-timeout')));
      req.on('error', e => { stream?.destroy(); reject(e instanceof DavError ? e : new DavError(e.name === 'AbortError' ? 'cancelled' : 'network-error')); });
      if (file) { stream = fs.createReadStream(file); stream.on('error', () => req.destroy(new DavError('snapshot-unreadable'))); stream.pipe(req); }
      else req.end(body);
    });
  }
  check(result, codes) {
    if (!codes.includes(result.status)) throw new DavError(result.status === 412 ? 'conflict' :
      [401, 403].includes(result.status) ? 'authentication-or-permission' : 'http-error', result.status);
    return result;
  }
  async upload(task, file, { deviceId, expectedEtag, hasManifest, signal }) {
    const parts = ['backups-v1', deviceId, task.documentId];
    for (let n = 1; n <= parts.length; n++) this.check(await this.request('MKCOL', this.url(parts.slice(0, n)), { signal }), [201, 405]);
    this.check(await this.request('MKCOL', this.url([...parts, 'versions']), { signal }), [201, 405]);
    const filename = task.id + '-' + task.hash + task.extension;
    const final = this.url([...parts, 'versions', filename]);
    // Stable per-task temporary name permits cleanup after process/network failure.
    // Each attempt first removes only its own abandoned transfer, never other files.
    const temp = this.url([...parts, 'versions', '.upload-' + task.id]);
    this.check(await this.request('DELETE', temp, { signal }), [200, 204, 404]);
    try {
    this.check(await this.request('PUT', temp, { file, signal, headers: { 'If-None-Match': '*' } }), [200, 201, 204]);
    const moved = await this.request('MOVE', temp, { signal, headers: { Destination: final.href, Overwrite: 'F' } });
    if ([405, 501].includes(moved.status)) {
      this.check(await this.request('PUT', final, { file, signal, headers: { 'If-None-Match': '*' } }), [200, 201, 204, 412]);
      // Only remove the unique incomplete transfer object created by this attempt.
      this.check(await this.request('DELETE', temp, { signal }), [200, 204, 404]);
    } else if (moved.status === 412) {
      this.check(await this.request('DELETE', temp, { signal }), [200, 204, 404]);
    } else this.check(moved, [201, 204]);
    } catch (error) {
      // One bounded best-effort cleanup; a later queue retry cleans again.
      await this.request('DELETE', temp, { signal:AbortSignal.timeout(5000) }).catch(() => {});
      throw error;
    }
    if (hasManifest && !expectedEtag) throw new DavError('missing-etag');
    const manifest = { schema: 1, documentId: task.documentId, deviceId,
      originalName: task.name, sha256: task.hash, bytes: task.size, savedAt: task.capturedAt,
      version: task.id, content: 'versions/' + filename };
    let result = await this.request('PUT', this.url([...parts, 'latest.json']), {
      signal, body: JSON.stringify(manifest), headers: { 'Content-Type': 'application/json',
        ...(hasManifest ? { 'If-Match': expectedEtag } : { 'If-None-Match': '*' }) },
    });
    if (result.status === 412) {
      // A committed manifest response can be lost on disconnect. Only reconcile
      // the exact immutable task; never adopt another writer's version silently.
      const existing = await this.request('GET', this.url([...parts, 'latest.json']), { signal });
      let same = false;
      try { const value = JSON.parse(existing.body); same = existing.status === 200 &&
        value.version === task.id && value.sha256 === task.hash && value.deviceId === deviceId && value.documentId === task.documentId; } catch {}
      if (same) result = existing;
    }
    this.check(result, [200, 201, 204]);
    let etag = result.etag;
    if (!etag) {
      const head = this.check(await this.request('HEAD', this.url([...parts, 'latest.json']), { signal }), [200]);
      etag = head.etag;
    }
    return { etag: etag || null, remote: final.href };
  }
}
module.exports = { DavClient, DavError };
