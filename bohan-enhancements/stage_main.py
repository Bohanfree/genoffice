#!/usr/bin/env python3
"""Rebuild the pinned main-process overlay without changing other ASAR members."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent
BASELINE_ASAR = '50dcf025a9ec39ddae20c77cf06dff77b2081cb5261eb9e3c07b19bc11c335be'
EXPECTED_ASAR = '7e155b7a77addd0729883e445c173875b0941569298b97dd4085aad39075fc06'
MAIN_PATH = 'out/main/index.js'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def entries(tree, prefix=''):
    for name, item in tree['files'].items():
        if 'files' in item:
            yield from entries(item, prefix + name + '/')
        else:
            yield prefix + name, item


def parse_asar(archive):
    header_size = struct.unpack_from('<I', archive, 4)[0]
    json_size = struct.unpack_from('<I', archive, 12)[0]
    header = json.loads(archive[16:16 + json_size])
    return header, 8 + header_size


def member_bytes(archive, name):
    header, base = parse_asar(archive)
    item = dict(entries(header))[name]
    start = base + int(item['offset'])
    return archive[start:start + item['size']]


def patch_asar(archive):
    """Return a verified 0.12.117 archive; reject unsupported or patched input."""
    if digest(archive) != BASELINE_ASAR:
        raise ValueError('Unsupported or already modified macOS 0.12.117 app.asar.')
    spec = importlib.util.spec_from_file_location('bohan_main_012117', ROOT / 'adapters/v0.12.117/main.py')
    recipe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recipe)
    header, base = parse_asar(archive)
    original = {name: copy.deepcopy(item) for name, item in entries(header)}
    main = dict(entries(header))[MAIN_PATH]
    offset, end = int(main['offset']), int(main['offset']) + main['size']
    payload = archive[base:]
    source = payload[offset:end].decode('utf-8')
    patched = recipe.patch_main(source).encode('utf-8')
    delta = len(patched) - main['size']
    for _, item in entries(header):
        if 'offset' in item and int(item['offset']) >= end:
            item['offset'] = str(int(item['offset']) + delta)
    main['size'] = len(patched)
    integrity = main['integrity']
    integrity['hash'] = digest(patched)
    block_size = integrity['blockSize']
    integrity['blocks'] = [digest(patched[i:i + block_size]) for i in range(0, len(patched), block_size)]
    raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    body = struct.pack('<I', len(raw)) + raw + b'\0' * (-len(raw) % 4)
    pickle = struct.pack('<I', len(body)) + body
    result = struct.pack('<II', 4, len(pickle)) + pickle + payload[:offset] + patched + payload[end:]
    new_base = 8 + len(pickle)
    for name, item in entries(header):
        old = original[name]
        if 'offset' not in item or item.get('unpacked'):
            if item != old:
                raise ValueError(f'Unexpected metadata change: {name}')
            continue
        data = result[new_base + int(item['offset']):new_base + int(item['offset']) + item['size']]
        integrity = item.get('integrity')
        if integrity:
            block_size = integrity['blockSize']
            if digest(data) != integrity['hash'] or [digest(data[i:i + block_size]) for i in range(0, len(data), block_size)] != integrity['blocks']:
                raise ValueError(f'ASAR member integrity mismatch: {name}')
        if name != MAIN_PATH:
            before = archive[base + int(old['offset']):base + int(old['offset']) + old['size']]
            if data != before:
                raise ValueError(f'Unrelated ASAR member changed: {name}')
    if digest(result) != EXPECTED_ASAR:
        raise ValueError('Generated ASAR differs from the verified release.')
    return result
