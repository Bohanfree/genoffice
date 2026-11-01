'use strict';
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

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
  async request(method, url, { headers = {}, body, file, signal, hashOnly = false, maxBytes = 1024 * 1024 } = {}) {
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw new DavError('invalid-remote-path');
    const { username, password } = await this.credentials();
    const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
    const size = file ? (await fs.promises.stat(file)).size : body ? Buffer.byteLength(body) : 0;
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      let stream;
      const req = transport.request(url, { method, signal, headers: { Authorization: authorization,
        'Content-Length': size, ...headers } }, res => {
        const chunks = [], hash = hashOnly ? createHash('sha256') : null; let length = 0;
        res.on('data', chunk => {
          length += chunk.length;
          if (length > maxBytes) { res.destroy(); reject(new DavError('response-too-large')); }
          else if (hash) hash.update(chunk); else chunks.push(chunk);
        });
        res.on('error', () => reject(new DavError('network-error')));
        res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag,
          body: hash ? undefined : Buffer.concat(chunks).toString('utf8'),
          hash: hash?.digest('hex'), size: length }));
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
  async matchingRemote(url, task, signal) {
    let result;
    try { result = await this.request('GET', url, { signal, hashOnly:true, maxBytes:task.size }); }
    catch (e) { if (e.code === 'response-too-large') return null; throw e; }
    if (result.status === 404) return null;
    this.check(result, [200]);
    return result.size === task.size && result.hash === task.hash ? result : null;
  }
  async upload(task, file, { remoteName, expectedEtag, hasRemote, signal, onCollision, onWriteStarted }) {
    // Only document files are stored remotely. Names/identity and retry state live locally.
    for (let attempt = 0; attempt < 100; attempt++) {
      const final = this.url([remoteName]);
      if (task.writeStarted) {
        // A disconnect/crash may have hidden a successful PUT. Stream the bytes to
        // verify them rather than treating a large document as a text response.
        const same = await this.matchingRemote(final, task, signal);
        if (same) return { etag:same.etag || null, remote:final.href };
      }
      if (hasRemote && !expectedEtag) throw new DavError('missing-etag');
      onWriteStarted?.();
      const result = await this.request('PUT', final, { file, signal, headers: {
        'Content-Type':'application/octet-stream',
        ...(hasRemote ? { 'If-Match':expectedEtag } : { 'If-None-Match':'*' })
      }});
      if (result.status === 412) {
        if (hasRemote) throw new DavError('conflict', 412);
        // A new document must never replace a same-name file from another source.
        // Persist each assigned name before a write so retries keep that name.
        remoteName = onCollision?.();
        if (!remoteName) throw new DavError('name-conflict', 412);
        continue;
      }
      this.check(result, [200, 201, 204]);
      if (result.etag) return { etag:result.etag, remote:final.href };
      const same = await this.matchingRemote(final, task, signal);
      if (!same) throw new DavError('conflict');
      return { etag:same.etag || null, remote:final.href };
    }
    throw new DavError('too-many-name-collisions');
  }
}
module.exports = { DavClient, DavError };
