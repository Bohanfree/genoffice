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


# Each adapter is pinned to the exact clean macOS vendor build.
VERSIONS = {
    '0.12.29': {
        'names': NAMES, 'baselines': BASELINES, 'expected': EXPECTED_RENDERERS,
        'release': 'bohan-v0.12.29.1',
    },
    '0.12.117': {
        'names': {'docs': 'index-CYNQkvnc.js', 'sheets': 'index-CG8lQClX.js', 'pdf': 'index-wUHEIxfM.js'},
        'baselines': {
            'docs': '3628cbe61e08bc9b898c531cca62b0ad8d52752e657f2402046b8aab68b1019d',
            'sheets': 'f70f46c222f2b56c2c2d667ebfeb22f9fecf9e4becc3e12c95c1d57c7239447a',
            'pdf': 'ff357988957e170579dd1ed1ec6d7f2954479b3b8b744d68fe8a676df35ad885',
        },
        'expected': {
            'docs': '970b182ab5ef223888f064f27b74e35b20596e7a1202800d0059a91639f02f2a',
            'sheets': 'db759763e2179128c589cc33da3b28eb9098eb79e9e8069f7b7bcb25754cb4a3',
            'pdf': 'b7e2db6d99f4fe966688711e523dfee931b278aa71122044966c7a84e2801532',
        },
        'release': 'bohan-v0.12.117.1',
    },
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stage(resources, output, version=None):
    resources, output = Path(resources).resolve(), Path(output).resolve()
    if output == resources or resources in output.parents or output in resources.parents:
        raise ValueError('Output must be separate from the input Resources tree.')
    if output.exists():
        raise ValueError('Output already exists; use a fresh directory.')
    candidates = [version] if version else list(VERSIONS)
    selected = None
    for candidate in candidates:
        if candidate not in VERSIONS:
            raise ValueError(f'Unsupported adapter version: {candidate}')
        config = VERSIONS[candidate]
        paths = {m: resources / 'modules' / m / 'renderer/assets' / n for m, n in config['names'].items()}
        if all(p.is_file() and digest(p.read_bytes()) == config['baselines'][m] for m, p in paths.items()):
            selected = candidate
            break
    if selected is None:
        raise ValueError('unsupported or already modified renderer; supply a clean supported macOS app.')
    config = VERSIONS[selected]
    sources = {m: p.read_text(encoding='utf-8') for m, p in paths.items()}
    spec = importlib.util.spec_from_file_location('bohan_adapter', ROOT / f'adapters/v{selected}/patches.py')
    patches = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patches)
    main_archive = None
    if selected == '0.12.117':
        # Validate and transform the host before writing any output.
        spec_main = importlib.util.spec_from_file_location('bohan_stage_main', ROOT / 'stage_main.py')
        stage_main = importlib.util.module_from_spec(spec_main)
        spec_main.loader.exec_module(stage_main)
        main_archive = stage_main.patch_asar((resources / 'app.asar').read_bytes())
    rendered = {
        'docs': patches.patch_word(patches.patch_official(sources['docs'])),
        'sheets': patches.patch_sheets(sources['sheets']),
        'pdf': patches.patch_pdf(sources['pdf']),
    }
    for module, source in rendered.items():
        if digest(source.encode('utf-8')) != config['expected'][module]:
            raise ValueError(f'{module}: generated renderer differs from the verified release.')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Stage atomically so a failed build never leaves a partial overlay.
    with tempfile.TemporaryDirectory(prefix='bohan-stage-', dir=output.parent) as temporary:
        dest = Path(temporary) / 'overlay'
        for module, source in rendered.items():
            target = dest / 'modules' / module / 'renderer/assets'
            target.mkdir(parents=True)
            (target / config['names'][module]).write_text(source, encoding='utf-8')
        if main_archive is not None:
            (dest / 'app.asar').write_bytes(main_archive)
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
            'release': config['release'], 'upstreamVersion': selected,
            'sourceBaseline': 'v0.12.115' if selected == '0.12.117' else 'v0.12.29',
            'baselineRenderers': config['baselines'], 'files': files,
        }, indent=2) + '\n', encoding='utf-8')
        dest.rename(output)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True, help='Clean supported macOS Contents/Resources directory')
    parser.add_argument('--output', type=Path, required=True, help='New output directory outside Resources')
    parser.add_argument('--version', choices=VERSIONS, help='Require this adapter; otherwise detect exact baseline hashes')
    args = parser.parse_args()
    try:
        files = stage(args.resources, args.output, args.version)
    except (ValueError, FileNotFoundError, AssertionError) as error:
        parser.exit(1, f'Staging stopped: {error}\n')
    print(f'Staged {len(files)} verified files at {args.output}. Application was not modified.')


if __name__ == '__main__':
    main()
