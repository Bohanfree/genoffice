"""Pinned Windows 446 host/preload integration for the background backup service."""
import copy
import json
import struct
from pathlib import Path
from stage_main import parse_asar, entries, digest, member_bytes

BASELINE_ASAR = 'e581129575ef8aed2b89687e4cd30aff8a6bc9170d09a3d84923865d1c759d65'
EXPECTED_ASAR = 'ae1456304bc9fba520966d18c88768d8b2365366b643c6383a52c4173f7309de'
PRELOADS = {
    'docs': '5b2e13405228e3114e4ef9edc50996d20517eb6c6a52cb96a86fda1cff5c238a',
    'pdf': '9b1c72bc75cbc1f9cb8b01097accf685fafef25f479076e971556bd6a270c9cd',
}


def preload_bytes(module, original):
    if digest(original) != PRELOADS[module]:
        raise ValueError('Unsupported or already modified backup preload.')
    return original + b'\nelectron.contextBridge.exposeInMainWorld("bohanBackup", { opened: (acceptedPath) => electron.ipcRenderer.send("bohan:webdav-opened", acceptedPath) });\n'


def patch_asar(archive):
    if digest(archive) != BASELINE_ASAR:
        raise ValueError('Unsupported or already modified Windows 446 host archive.')
    header, base = parse_asar(archive)
    original = copy.deepcopy(header)
    main = dict(entries(header))['out/main/index.js']
    offset = int(main['offset'])
    end = offset + main['size']
    source = member_bytes(archive, 'out/main/index.js').decode('utf-8')
    anchor = '"use strict";\n'
    assert source.startswith(anchor)
    prefix = 'globalThis.__bohanWebDav = require(require("node:path").join(process.resourcesPath, "bohan-webdav/bootstrap.cjs")).install(require("electron"));\n'
    source = source.replace(anchor, anchor + prefix, 1)
    anchor = '  setSheetsWorkbookOpenedHook((wc, path2) => {\n'
    assert source.count(anchor) == 1
    # This native hook fires only after a successful workbook open or committed save,
    # and supplies the original CSV/XLS path instead of its temporary import file.
    source = source.replace(anchor, anchor + '    globalThis.__bohanWebDav.observe(wc.id, path2, "open-or-save");\n', 1)
    patched = source.encode('utf-8')
    delta = len(patched) - main['size']
    for _, item in entries(header):
        if 'offset' in item and int(item['offset']) >= end:
            item['offset'] = str(int(item['offset']) + delta)
    main['size'] = len(patched)
    integrity = main['integrity']
    block = integrity['blockSize']
    integrity['hash'] = digest(patched)
    integrity['blocks'] = [digest(patched[i:i+block]) for i in range(0, len(patched), block)]
    raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    body = struct.pack('<I', len(raw)) + raw + b'\0' * (-len(raw) % 4)
    pickle = struct.pack('<I', len(body)) + body
    payload = archive[base:]
    result = struct.pack('<II', 4, len(pickle)) + pickle + payload[:offset] + patched + payload[end:]
    for name, item in entries(original):
        if name != 'out/main/index.js' and 'offset' in item and not item.get('unpacked'):
            if member_bytes(result, name) != member_bytes(archive, name):
                raise ValueError('Unexpected ASAR member change: ' + name)
    if EXPECTED_ASAR and digest(result) != EXPECTED_ASAR:
        raise ValueError('Generated backup host differs from the verified release.')
    return result
