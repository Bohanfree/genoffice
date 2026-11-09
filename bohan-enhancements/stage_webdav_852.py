"""Pinned 852 host/preload integration for the background backup service."""
import copy
import json
import struct
from pathlib import Path
from stage_main import parse_asar, entries, digest, member_bytes

BASELINE_ASAR = '4e61004b88e1ec3f1dfb9bd287ed7de068bfb875f5603747810113164ab10950'
EXPECTED_ASAR = '73bd71e5475dee17480a9292c45f95427508820612ef90f4b854bbf3d7cf96eb'
PRELOADS = {
    'docs': 'a48593daf315a70d2d6896011098a4d243558aa76201706ef40cd0aa92bd7c22',
    'pdf': 'd56f6607ec74c777f475d13abbca970a668753793ff0a94c725c03067404ff69',
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
    source = source.replace(anchor, '  globalThis.__bohanWebDav.attach({open:openDocumentPath,isOpen:file => [...tabManager?.openFilePaths() ?? [],...detachedFilePaths()].some(p => require("node:path").resolve(p).toLowerCase() === require("node:path").resolve(file).toLowerCase())});\n' + anchor + '    globalThis.__bohanWebDav.observe(wc.id, path2, "open-or-save");\n', 1)
    preload_name = 'out/preload/index.js'
    preload = member_bytes(archive, preload_name)
    assert digest(preload) == '6803658301f1d6596128d56166b746959be8765efb8284e33ff8c7ff49a30816'
    preload += b'\nelectron.contextBridge.exposeInMainWorld("bohanCloud", {history:value=>electron.ipcRenderer.invoke("bohan:cloud-history",value),sync:()=>electron.ipcRenderer.invoke("bohan:cloud-sync"),conflict:value=>electron.ipcRenderer.invoke("bohan:cloud-conflict",value)});\n'
    renderer_name = 'out/renderer/assets/index-BfJSsLAW.js'
    renderer = member_bytes(archive, renderer_name).decode('utf-8')
    anchor = 'className: "folder-panel-actions", children: [\n'
    assert renderer.count(anchor) == 1
    renderer = renderer.replace(anchor, anchor + '''          jsxRuntimeExports.jsx("button", {className:"folder-add-btn", "aria-label":"打开 WebDAV 云文档", title:"打开 WebDAV 云文档并刷新", onClick:()=>{loadRoot();setExpanded(e=>new Set([...e,"webdav://genoffice/"]));selectFolder("webdav://genoffice/");void window.bohanCloud.sync().then(()=>invalidateFolders([...listings.keys(),"webdav://genoffice/"]));},children:"☁"}),
''', 1)
    anchor = 'rowMenu === entry.path && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "row-menu", role: "menu", children: [\n'
    assert renderer.count(anchor) == 1
    renderer = renderer.replace(anchor, anchor + '''                  jsxRuntimeExports.jsx("button",{role:"menuitem",onClick:()=>{setRowMenu(null);void window.bohanCloud.history(entry.path);},children:"历史版本…"}),
                  jsxRuntimeExports.jsx("button",{role:"menuitem",onClick:()=>{setRowMenu(null);void window.bohanCloud.conflict(entry.path);},children:"同步冲突：保留双方…"}),
''', 1)
    anchor = 'draggable: !isRenaming && !entry.missing,'
    assert renderer.count(anchor) == 1
    renderer = renderer.replace(anchor, 'draggable: !isRenaming && !entry.missing && !entry.path.startsWith("webdav://genoffice/"),', 1)
    renderer = renderer.replace('root && !root.usable ?', 'root && !root.usable && !root.path.startsWith("webdav://genoffice/") ?', 1)
    anchor = 'children: locationLabel(entry.path, roots)'
    assert renderer.count(anchor) == 1
    renderer = renderer.replace(anchor, 'children: entry.cloudDocument || entry.path.startsWith("webdav://genoffice/") ? "WebDAV 云文档" : locationLabel(entry.path, roots)')
    # Cloud files use the existing native editor, but unsupported local-only
    # operations should not appear as active controls in their folder rows.
    anchor = 'className: `star-btn${entry.starred ? " starred" : ""}`,'
    assert renderer.count(anchor) == 1
    renderer = renderer.replace(anchor, anchor+'\n              disabled:entry.path.startsWith("webdav://genoffice/"),',1)
    anchor = 'role: "menuitem",\n                      onClick: () => {\n                        setRowMenu(null);\n                        void window.aiOffice.revealPath(entry.path);'
    assert renderer.count(anchor) == 1
    renderer = renderer.replace(anchor, 'role: "menuitem",\n                      disabled:entry.path.startsWith("webdav://genoffice/"),\n                      onClick: () => {\n                        setRowMenu(null);\n                        void window.aiOffice.revealPath(entry.path);',1)
    modified = {'out/main/index.js':source.encode('utf-8'), preload_name:preload, renderer_name:renderer.encode('utf-8')}
    # Rebuild every packed offset while preserving all unrelated member bytes.
    payload_parts = []
    position = 0
    for name,item in sorted(((n,i) for n,i in entries(header) if 'offset' in i and not i.get('unpacked')), key=lambda pair:int(pair[1]['offset'])):
        data = modified.get(name, member_bytes(archive,name))
        item['offset'] = str(position)
        item['size'] = len(data)
        position += len(data)
        payload_parts.append(data)
        if name in modified:
            integrity = item['integrity']
            block = integrity['blockSize']
            integrity['hash'] = digest(data)
            integrity['blocks'] = [digest(data[i:i+block]) for i in range(0,len(data),block)]
    raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    body = struct.pack('<I', len(raw)) + raw + b'\0' * (-len(raw) % 4)
    pickle = struct.pack('<I', len(body)) + body
    result = struct.pack('<II', 4, len(pickle)) + pickle + b''.join(payload_parts)
    for name, item in entries(original):
        if name not in modified and 'offset' in item and not item.get('unpacked'):
            if member_bytes(result, name) != member_bytes(archive, name):
                raise ValueError('Unexpected ASAR member change: ' + name)
    if EXPECTED_ASAR and digest(result) != EXPECTED_ASAR:
        raise ValueError('Generated backup host differs from the verified release.')
    return result
