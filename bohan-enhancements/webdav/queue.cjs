'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

function atomicJson(file, value) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function inside(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function keyFor(file) { const p = path.resolve(file); return process.platform === 'win32' ? p.toLowerCase() : p; }
function validName(name) { return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' && !/[/\\\x00-\x1f]/.test(name); }
function readableName(name, number = 1) {
  const extension = path.extname(name), stem = path.basename(name, extension);
  const suffix = number > 1 ? ` (${number})` : '';
  // Keep UTF-8 path components below common WebDAV filesystem limits.
  let base = stem || 'document';
  while (Buffer.byteLength(base + suffix + extension) > 220) base = [...base].slice(0, -1).join('');
  return base + suffix + extension;
}

class BackupQueue {
  constructor({ root, config, client, onChange = () => {}, clock = Date.now }) {
    this.root = root; this.config = config; this.client = client; this.onChange = onChange; this.clock = clock;
    fs.mkdirSync(path.join(root, 'snapshots'), { recursive: true });
    this.file = path.join(root, 'queue.json');
    if (fs.existsSync(this.file)) this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    else this.state = { schema: 2, deviceId: randomUUID(), documents: {}, tasks: [], history: [], errors: [] };
    const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
    if (![1, 2].includes(this.state.schema) || !uuid(this.state.deviceId) || !this.state.documents ||
        !Array.isArray(this.state.tasks) || !Array.isArray(this.state.history) || !Array.isArray(this.state.errors) ||
        !Object.entries(this.state.documents).every(([key, doc]) => path.isAbsolute(key) && uuid(doc?.id) &&
          (doc.remoteName === undefined || validName(doc.remoteName)) &&
          (doc.localPath === undefined || (path.isAbsolute(doc.localPath) && keyFor(doc.localPath) === key)) &&
          (doc.remotePath === undefined || (Array.isArray(doc.remotePath) && doc.remotePath.length > 0 && doc.remotePath.every(validName)))) ||
        !this.state.tasks.every(t => uuid(t?.id) && uuid(t.documentId) && typeof t.localKey === 'string' &&
          path.isAbsolute(t.localKey) && this.state.documents[t.localKey]?.id === t.documentId &&
          /^[a-f0-9]{64}$/.test(t.hash) && /^\.[a-z0-9]+$/.test(t.extension) &&
          typeof t.name === 'string' && path.basename(t.name) === t.name &&
          Number.isSafeInteger(t.size) && t.size >= 0 && ['queued','uploading','failed','conflict'].includes(t.status))) {
      throw new Error('unsupported-or-damaged-queue');
    }
    if (this.state.schema === 1) {
      // Preserve the previous local mapping/receipts and all old remote backups.
      // Old manifest ETags/hashes cannot describe a new directly named document.
      const legacy = path.join(root, 'queue-before-readable-backups.json');
      if (!fs.existsSync(legacy)) atomicJson(legacy, this.state);
      for (const doc of Object.values(this.state.documents)) {
        delete doc.remoteName; delete doc.nameNumber;
        doc.etag = null; doc.lastHash = null; doc.hasRemote = false; delete doc.hasManifest;
      }
      for (const t of this.state.tasks) {
        t.status = 'queued'; t.nextAttempt = 0; delete t.writeStarted;
      }
      this.state.schema = 2;
    }
    // Only our own unreferenced snapshots are disposable after a crash.
    const referenced = new Set(this.state.tasks.map(t => t.id + '.bin'));
    for (const entry of fs.readdirSync(path.join(root, 'snapshots'), { withFileTypes:true })) {
      const match = /^(.+)\.(partial|bin)$/.exec(entry.name);
      if (entry.isFile() && match && uuid(match[1]) && !referenced.has(entry.name))
        fs.unlinkSync(path.join(root, 'snapshots', entry.name));
    }
    // Never redirect existing queued bytes to a newly configured destination/account.
    this.destination = createHash('sha256').update(config.endpoint + '\n' + config.username).digest('hex');
    if (this.state.destination && this.state.destination !== this.destination && this.state.tasks.length) throw new Error('destination-has-pending-files');
    if (this.state.destination !== this.destination) {
      this.state.documents = {}; this.state.deviceId = randomUUID(); this.state.destination = this.destination;
    }
    for (const t of this.state.tasks) if (t.status === 'uploading') t.status = 'queued';
    this.captureChain = Promise.resolve(); this.locks = new Map(); this.pendingCaptures = 0; this.running = false; this.stopped = false; this.abort = null;
    this.persist();
  }
  persist() { atomicJson(this.file, this.state); try { this.onChange(this.summary()); } catch {} }
  exclusive(key, operation) {
    const previous = this.locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.locks.set(key,next);
    void next.finally(() => {if(this.locks.get(key) === next) this.locks.delete(key);}).catch(()=>{});
    return next;
  }
  assignName(doc, original, next = false) {
    if (doc.remoteName && !next) return doc.remoteName;
    let number = next ? (doc.nameNumber || 1) + 1 : 1, name;
    const used = new Set(Object.values(this.state.documents).filter(d => d !== doc).map(d => d.remoteName?.normalize('NFC').toLowerCase()));
    do { name = readableName(original, number++); } while (used.has(name.normalize('NFC').toLowerCase()));
    doc.remoteName = name; doc.nameNumber = number - 1;
    return name;
  }
  eligible(file) {
    return this.config.automaticUploadEnabled === true && !this.stopped && path.isAbsolute(file) &&
      !inside(file, this.root) && ![...(this.config.excludedDirectories || [])].some(r => inside(file, r)) &&
      !this.state.documents[keyFor(file)]?.paused && /\.(docx|odt|xlsx|xlsm|xls|csv|tsv|pptx|pdf|md|markdown|txt|html|htm)$/i.test(file);
  }
  enqueue(file, reason = 'save') {
    if (typeof file !== 'string' || !this.eligible(file)) return Promise.resolve(false);
    // Open immediately: an atomic save that follows cannot change the captured file handle.
    const opening = fs.promises.open(file, 'r'); opening.catch(() => {});
    this.pendingCaptures++;
    const operation = this.captureChain.then(() => this.capture(file, reason, opening)).finally(() => this.pendingCaptures--);
    this.captureChain = operation.catch(() => {});
    return operation;
  }
  async capture(file, reason, opening) {
    let handle, temporary;
    try {
      handle = await opening;
      if (!this.eligible(file)) return false;
      const before = await handle.stat();
      const limit = this.config.maxFileBytes ?? 512 * 1024 * 1024;
      if (!before.isFile() || before.size > limit) throw new Error('file-too-large-or-not-regular');
      if (this.state.tasks.reduce((sum, t) => sum + t.size, 0) + before.size > (this.config.maxQueueBytes ?? 2 * 1024 ** 3)) throw new Error('queue-full');
      const id = randomUUID(); temporary = path.join(this.root, 'snapshots', id + '.partial');
      const hash = createHash('sha256'); let count = 0;
      const hashing = new Transform({ transform(chunk, _encoding, done) {
        count += chunk.length;
        if (count > limit) return done(new Error('file-too-large-or-not-regular'));
        hash.update(chunk); done(null, chunk);
      }});
      await pipeline(handle.createReadStream({ autoClose: false }), hashing, fs.createWriteStream(temporary, { mode: 0o600, flags: 'wx' }));
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || count !== before.size) throw new Error('file-changed-during-snapshot');
      const digest = hash.digest('hex'), key = keyFor(file);
      const doc = this.state.documents[key] ||= { id: randomUUID(), lastHash: null, etag: null, hasRemote: false };
      doc.localPath = file;
      const tail = this.state.tasks.filter(t => t.documentId === doc.id).at(-1);
      if ((tail ? tail.hash : doc.lastHash) === digest) return false;
      const snapshot = path.join(this.root, 'snapshots', id + '.bin');
      await fs.promises.rename(temporary, snapshot); temporary = null;
      const task = { id, documentId: doc.id, localKey: key, name: path.basename(file), extension: path.extname(file).toLowerCase(),
        size: count, hash: digest, reason, capturedAt: new Date(this.clock()).toISOString(), status: 'queued', attempts: 0, nextAttempt: 0 };
      this.state.tasks.push(task); this.persist(); void this.pump(); return true;
    } catch (e) {
      const codes = ['file-too-large-or-not-regular', 'queue-full', 'file-changed-during-snapshot'];
      this.state.errors.unshift({ name: path.basename(file), code: codes.includes(e.message) ? e.message : 'snapshot-failed', time: new Date(this.clock()).toISOString() });
      this.state.errors = this.state.errors.slice(0, 50); this.persist(); return false;
    } finally { await handle?.close().catch(() => {}); if (temporary) await fs.promises.unlink(temporary).catch(() => {}); }
  }
  async pump() {
    if (this.running || this.stopped || !this.config.automaticUploadEnabled) return;
    this.running = true;
    try {
      for (;;) {
        const task = this.state.tasks.find(t => ['queued', 'failed'].includes(t.status) && t.nextAttempt <= this.clock() &&
          !this.state.documents[t.localKey]?.paused && !this.config.excludedDirectories?.some(r => inside(t.localKey, r)) &&
          !this.state.tasks.some(p => p.documentId === t.documentId && this.state.tasks.indexOf(p) < this.state.tasks.indexOf(t)));
        if (!task || this.stopped || !this.config.automaticUploadEnabled) break;
        const doc = this.state.documents[task.localKey];
        this.abort = new AbortController(); task.status = 'uploading'; this.persist();
        try {
          const snapshot = path.join(this.root, 'snapshots', task.id + '.bin');
          // Rehash durable bytes before transmission: corrupted local queue files never upload.
          const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(snapshot)) hash.update(chunk);
          if (hash.digest('hex') !== task.hash) throw new Error('snapshot-corrupt');
          const remoteName = this.assignName(doc, task.name); this.persist();
          const result = await this.exclusive(task.localKey, () => this.client.upload(task, snapshot, { remoteName, remotePath:doc.remotePath,
            expectedEtag: doc.etag, hasRemote: doc.hasRemote, signal: this.abort.signal,
            onWriteStarted: () => { task.writeStarted = true; this.persist(); },
            onCollision: () => { delete task.writeStarted; const name = this.assignName(doc, task.name, true); this.persist(); return name; }
          }));
          doc.lastHash = task.hash; doc.etag = result.etag; doc.hasRemote = true;
          this.state.history.unshift({ name: task.name, remoteName:doc.remoteName, hash: task.hash, time: new Date(this.clock()).toISOString(), remote: result.remote });
          this.state.history = this.state.history.slice(0, 100);
          this.state.tasks = this.state.tasks.filter(t => t.id !== task.id); this.persist();
          await fs.promises.unlink(snapshot).catch(() => {});
        } catch (e) {
          task.status = e.code === 'conflict' ? 'conflict' : 'failed'; task.attempts++;
          task.error = e.code || (e.message === 'snapshot-corrupt' ? 'snapshot-corrupt' : 'upload-failed');
          task.nextAttempt = this.clock() + Math.min(300000, 10000 * 2 ** Math.min(task.attempts - 1, 5)); this.persist();
        } finally { this.abort = null; }
      }
    } finally { this.running = false; }
  }
  start() { void this.pump(); this.timer = setInterval(() => void this.pump(), 5000); this.timer.unref?.(); }
  retry() { for (const t of this.state.tasks) if (t.status === 'failed') t.nextAttempt = 0; this.persist(); void this.pump(); }
  pauseDocument(file, paused) {
    const key = keyFor(file); const doc = this.state.documents[key] ||= { id: randomUUID(), lastHash: null, hasRemote: false, etag: null };
    doc.paused = paused; this.persist();
    if (paused) this.abort?.abort(); else void this.pump();
  }
  summary() {
    const count = status => this.state.tasks.filter(t => t.status === status).length;
    return { enabled: this.config.automaticUploadEnabled, queued: count('queued'), uploading: count('uploading'), failed: count('failed'),
      conflict: count('conflict'), backedUp: this.state.history.length, recent: this.state.history.slice(0, 10),
      pausedFiles: Object.entries(this.state.documents).filter(([, d]) => d.paused).map(([p]) => path.basename(p)),
      tasks: this.state.tasks.map(t => ({ name: t.name, status: t.status, error: t.error })), errors: this.state.errors.slice(0, 5) };
  }
  async close() { await this.captureChain; this.stopped = true; clearInterval(this.timer); this.abort?.abort(); }
}
module.exports = { BackupQueue, atomicJson, inside };
