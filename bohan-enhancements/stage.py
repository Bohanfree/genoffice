#!/usr/bin/env python3
"""Stage a complete compatibility overlay; never write to the application."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent
NAMES = {
    'docs': 'index-Du0wBiwy.js',
    'sheets': 'index-rnPExjWA.js',
    'pdf': 'index-DpDiqQ18.js',
}
BASELINES = {
    'docs': 'ad802dabe59fc64e1a0cc0f94259286dada718b68bf39049860195d9dd80990f',
    'sheets': 'cd03b813680981ce46769bc245d254dfbe4ecef48546fee8412baa663b76131a',
    'pdf': 'd4e754f74e06dd25a4f781ea422194e0e73c78ef985334f6542b08ab52ea5999',
}
EXPECTED_RENDERERS = {
    'docs': '72a64f3cc93d4d778c852669eae88b2838c1b09673829d9117b47495271342f0',
    'sheets': '720d2433b998da67c6c43574b4a095dc9ba638dfe8970c095a9ee0b85f415a2c',
    'pdf': 'cacb5ed907984070dd81a0552572fe7424e09cbcc5b7ada5ee81e61f027faefa',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stage(resources, output):
    resources, output = Path(resources).resolve(), Path(output).resolve()
    if output == resources or resources in output.parents or output in resources.parents:
        raise ValueError('Output must be separate from the input Resources tree.')
    if output.exists():
        raise ValueError('Output already exists; use a fresh directory.')
    sources = {}
    # Check every module before creating any output or applying transformations.
    for module, name in NAMES.items():
        raw = (resources / 'modules' / module / 'renderer/assets' / name).read_bytes()
        if digest(raw) != BASELINES[module]:
            raise ValueError(f'{module}: unsupported or already modified renderer; expected clean macOS 0.12.29.')
        sources[module] = raw.decode('utf-8')
    spec = importlib.util.spec_from_file_location('bohan_01229', ROOT / 'adapters/v0.12.29/patches.py')
    patches = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patches)
    rendered = {
        'docs': patches.patch_word(patches.patch_official(sources['docs'])),
        'sheets': patches.patch_sheets(sources['sheets']),
        'pdf': patches.patch_pdf(sources['pdf']),
    }
    for module, source in rendered.items():
        if digest(source.encode('utf-8')) != EXPECTED_RENDERERS[module]:
            raise ValueError(f'{module}: generated renderer differs from the verified release.')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Stage atomically so a failed build never leaves a partial overlay.
    with tempfile.TemporaryDirectory(prefix='bohan-stage-', dir=output.parent) as temporary:
        dest = Path(temporary) / 'overlay'
        for module, source in rendered.items():
            target = dest / 'modules' / module / 'renderer/assets'
            target.mkdir(parents=True)
            (target / NAMES[module]).write_text(source, encoding='utf-8')
        docs = dest / 'modules/docs/renderer/assets'
        sheets = dest / 'modules/sheets/renderer/assets'
        for name in ('official-typeset-core.mjs', 'official-typeset-ui.mjs'):
            shutil.copyfile(ROOT / 'official' / name, docs / name)
        for name in ('wps-word-table-core.mjs', 'wps-word-table-ui.mjs', 'wps-word-table-adapter.mjs', 'wps-word-presets.json'):
            shutil.copyfile(ROOT / 'tables' / name, docs / name)
        for name in ('wps-table-beautify-core.mjs', 'wps-table-beautify-ui.mjs', 'wps-presets.json'):
            shutil.copyfile(ROOT / 'tables' / name, sheets / name)
        files = {p.relative_to(dest).as_posix(): digest(p.read_bytes()) for p in sorted(dest.rglob('*')) if p.is_file()}
        (dest / 'bohan-overlay.json').write_text(json.dumps({
            'release': 'bohan-v0.12.29.1', 'upstreamVersion': '0.12.29',
            'baselineRenderers': BASELINES, 'files': files,
        }, indent=2) + '\n', encoding='utf-8')
        dest.rename(output)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True, help='Clean macOS 0.12.29 Contents/Resources directory')
    parser.add_argument('--output', type=Path, required=True, help='New output directory outside Resources')
    args = parser.parse_args()
    try:
        files = stage(args.resources, args.output)
    except (ValueError, FileNotFoundError, AssertionError) as error:
        parser.exit(1, f'Staging stopped: {error}\n')
    print(f'Staged {len(files)} verified files at {args.output}. Application was not modified.')


if __name__ == '__main__':
    main()
