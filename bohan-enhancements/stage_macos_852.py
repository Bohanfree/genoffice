"""Pinned macOS ARM64 852 overlay: renderer/WebDAV host plus SMB repair."""
import importlib.util
import json
import struct
from pathlib import Path
import stage_webdav_852 as stage_webdav
from stage_main import parse_asar, entries, member_bytes, digest

ROOT = Path(__file__).resolve().parent
EXPECTED_ASAR = 'f5b4cff7107d091d384a6346c6bf39db2335eecd46297a210e514c77be6a11b2'


def patch_asar(archive):
    # Patch only the independently verified 0.12.852 macOS ARM64 host archive.
    shared = stage_webdav.patch_asar(archive)
    header, _ = parse_asar(shared)
    source = member_bytes(shared, 'out/main/index.js').decode('utf-8')
    spec = importlib.util.spec_from_file_location('smb117', ROOT / 'adapters/v0.12.117/main.py')
    smb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(smb)
    assert source.count(smb.ORIGINAL_SAVE) == 1
    source = source.replace(smb.ORIGINAL_SAVE, smb.PATCHED_SAVE, 1)
    anchor = 'const RETRYABLE_RENAME_CODES = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);'
    assert source.count(anchor) == 1
    source = source.replace(anchor, anchor.replace('"EBUSY"]', '"EBUSY", "EAGAIN"]'), 1)
    parts, position = [], 0
    for name, item in sorted(((n, i) for n, i in entries(header) if 'offset' in i and not i.get('unpacked')), key=lambda v: int(v[1]['offset'])):
        data = source.encode('utf-8') if name == 'out/main/index.js' else member_bytes(shared, name)
        item.update(offset=str(position), size=len(data))
        position += len(data)
        parts.append(data)
        if name == 'out/main/index.js':
            integrity = item['integrity']
            block = integrity['blockSize']
            integrity.update(hash=digest(data), blocks=[digest(data[i:i+block]) for i in range(0, len(data), block)])
    raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    body = struct.pack('<I', len(raw)) + raw + b'\0' * (-len(raw) % 4)
    pickle = struct.pack('<I', len(body)) + body
    result = struct.pack('<II', 4, len(pickle)) + pickle + b''.join(parts)
    for name, item in entries(header):
        if name != 'out/main/index.js' and 'offset' in item and not item.get('unpacked'):
            assert member_bytes(result, name) == member_bytes(shared, name), name
    if EXPECTED_ASAR and digest(result) != EXPECTED_ASAR:
        raise ValueError('Generated macOS host differs from the verified build.')
    return result


def bootstrap_bytes():
    source = (ROOT / 'webdav/bootstrap.cjs').read_text()
    old_label = '增强版 0.12.446.7 · 双向同步与历史版本'
    assert source.count(old_label) == 1
    source = source.replace(old_label, '增强版 0.12.852-macos.1 · 双向同步与历史版本', 1)
    source = source.replace("      if(channel==='home:folder-list' && remote) {\n        try {return await cloud.list(args[0]);}catch(e) {await showError(e);return {dir:args[0],folders:[],files:[],missing:true};}\n      }", "      if(channel==='home:folder-list' && remote) {\n        if (!cloud) return {dir:args[0],folders:[],files:[],missing:true};\n        try {return await cloud.list(args[0]);}catch {return {dir:args[0],folders:[],files:[],missing:true};}\n      }")
    source = source.replace("      if(channel==='home:open-path' && remote) {\n", "      if(channel==='home:open-path' && remote) {\n        if (!cloud) { configure(); return; }\n")
    source = source.replace("if(!cloud)return status();await cloud.sync()", "if(!cloud)return configure();await cloud.sync()")
    source = source.replace("  const showError = e => dialog.showMessageBox({", "  let errorVisible = false, lastErrorAt = 0;\n  const showError = async e => {\n    if (errorVisible || Date.now() - lastErrorAt < 15000) return;\n    errorVisible = true; lastErrorAt = Date.now();\n    try { await dialog.showMessageBox({")
    source = source.replace("检查网络、账号和同步状态。'});", "检查网络、账号和同步状态。'}); } finally { errorVisible = false; }\n  };")
    start = source.index('  const configure = () => {')
    end = source.index('  const currentFile =', start)
    source = source[:start] + '''  const macCredentials = require('./credentials-darwin.cjs');
  const configure = () => macCredentials.configure(require('electron'), app.getPath('userData'));
''' + source[end:]
    start = source.index('        const executable = path.join(process.env.SystemRoot')
    end = source.index('\n      }});', start)
    source = source[:start] + '''        try {
          const value = macCredentials.read(require('electron').safeStorage, app.getPath('userData'));
          if (value.username !== config.username || value.endpoint !== config.endpoint) throw new Error();
          cachedCredential = value; credentialExpires = Date.now() + 60000; return value;
        } catch { const e = new Error('credential-unavailable'); e.code = 'credential-unavailable'; throw e; }''' + source[end:]
    return source.encode('utf-8')
