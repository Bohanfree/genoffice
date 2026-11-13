#!/usr/bin/env python3
"""Stage a complete compatibility overlay; never write to the application."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import sys

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
    '0.13.18': {
        'names': {'docs': 'index-KtdbObLf.js', 'sheets': 'index-DnRmLg-4.js', 'pdf': 'index-CvV35At_.js'},
        'baselines': {
            'docs': '89d1b6c8bc28fb63be83a7a6deed4128f7b0f9c449fa83d7052ba3ce79362765',
            'sheets': 'ebac45517c74dd40032e2c06b461b77682ab8a07091b8c1cc5c61126295e3f6c',
            'pdf': '4a8823a20114fa35f92fa63a320c5a0fe2e6165fb0cd57a5ec40cbb3e6d7cb1c',
        },
        'expected': {
            'docs': '90cc20a37ae706d69978dfc191a6033abb4bad9bc3a50e4122130a1dac211fac',
            'sheets': 'cc359101c460f9b6ee4f432b1fcfa84269d64d02ffafc5144947c7ca362fb296',
            'pdf': 'dea291f7c9f0f4fbc7b0efe15b6ce92c30afa63d8b6acb6ce9db653e713b4089',
        },
        'release': 'bohan-v0.13.18-macos.1', 'platform': 'darwin-arm64',
        'sourceBaseline': 'v0.13.18',
    },
    '0.12.852': {
        'names': {'docs': 'index-DMyQV0sR.js', 'sheets': 'index-CS27lpgu.js', 'pdf': 'index-B8Me_X6W.js'},
        'baselines': {
            'docs': '49d9cb06f64cebd46fbd56c3fe27930ba664aaabe9dd8f590f4dd00525ad2150',
            'sheets': 'f26df5b4ce00fa0f609ddeb8c93a5cc183d8b8c7b0364c78e6ebf565f64e1cdc',
            'pdf': '9ad13036f87730d5c7bb62d9c7b1eec5c2f06113aab21efbf6beea2e16f1c101',
        },
        'expected': {
            'docs': 'ae0c3c49cddc2e97b7238663ecb78ea84c0fbf5db01a1ada9a8343488d5a671e',
            'sheets': '47e87a98d3826fe162cc19a2c46ced7310f914e868ece35cc27edcf03dd009d7',
            'pdf': '9600079d11aa4a3b2941c3dea31393c53ca9d7ee2bacda8ef50778282137b449',
        },
        'release': 'bohan-v0.12.852-macos.1', 'platform': 'darwin-arm64',
        'sourceBaseline': 'v0.12.852',
    },
    '0.12.446': {
        'names': {'docs': 'index-hHkjX_DW.js', 'sheets': 'index-ayY7qpCu.js', 'pdf': 'index-H9Qe9zLW.js'},
        'baselines': {
            'docs': '536c67aa6459bb0c912aa866841b586cbd8b158b6cb68fd0ec1c42a67f27c2e3',
            'sheets': 'd2e968d1ac0d312a5276e31f39f43988a739617cbd5828259ad9166fae159300',
            'pdf': '64cac6fe9a2c1d98c22cc8c68ab9c5de52748715e6710aa4af1e23e2e28a0986',
        },
        'expected': {
            'docs': '088516ee5b767991530c76f999a7b9ed8f2f5117b08c62b89396b45edab54d50',
            'sheets': '27cb15980364e0348563414d426019a943267a70a56c16624f57edb393759c67',
            'pdf': 'c910b72cae9e9455201166ca2cb095e603123f09be3aaab5d1715dcaa446ede2',
        },
        'release': 'bohan-v0.12.446.7', 'platform': 'win32-x64',
        'sourceBaseline': 'v0.12.446',
    },
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


def stage(resources, output, version=None, platform=None):
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
        raise ValueError('unsupported or already modified renderer; supply a clean supported desktop app.')
    config = dict(VERSIONS[selected])
    platform = platform or ('darwin-arm64' if sys.platform == 'darwin' and selected in ('0.12.446', '0.12.852', '0.13.18') else config.get('platform', 'darwin'))
    mac446 = selected == '0.12.446' and platform == 'darwin-arm64'
    mac852 = selected == '0.12.852' and platform == 'darwin-arm64'
    mac1318 = selected == '0.13.18' and platform == 'darwin-arm64'
    if selected in ('0.12.852', '0.13.18') and platform != 'darwin-arm64':
        raise ValueError(f'The {selected} adapter supports only macOS ARM64.')
    if mac446:
        config.update(platform=platform, release='bohan-v0.12.446.7-macos.1')
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
    if selected in ('0.12.446', '0.12.852', '0.13.18'):
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        if mac1318:
            import stage_webdav_1318 as stage_webdav
            import stage_macos_1318 as stage_macos
            main_archive = stage_macos.patch_asar((resources / 'app.asar').read_bytes())
        elif mac852:
            import stage_webdav_852 as stage_webdav
            import stage_macos_852 as stage_macos
            main_archive = stage_macos.patch_asar((resources / 'app.asar').read_bytes())
        elif mac446:
            import stage_webdav
            import stage_macos
            main_archive = stage_macos.patch_asar((resources / 'app.asar').read_bytes())
        else:
            import stage_webdav
            main_archive = stage_webdav.patch_asar((resources / 'app.asar').read_bytes())
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
            (target / config['names'][module]).write_bytes(source.encode('utf-8'))
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
        if selected in ('0.12.446', '0.12.852', '0.13.18'):
            for module in ('docs', 'pdf'):
                relative = Path('modules') / module / 'preload/index.js'
                target = dest / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(stage_webdav.preload_bytes(module, (resources / relative).read_bytes()))
            extra = ('Configure-WebDAV.ps1', 'credentials.ps1') if mac446 or mac852 or mac1318 else ('*darwin*',)
            shutil.copytree(ROOT / 'webdav', dest / 'bohan-webdav', ignore=shutil.ignore_patterns('__pycache__', *extra))
            if mac446 or mac852 or mac1318:
                (dest / 'bohan-webdav/bootstrap.cjs').write_bytes(stage_macos.bootstrap_bytes())
        files = {p.relative_to(dest).as_posix(): digest(p.read_bytes()) for p in sorted(dest.rglob('*')) if p.is_file()}
        (dest / 'bohan-overlay.json').write_text(json.dumps({
            'release': config['release'], 'upstreamVersion': selected,
            'sourceBaseline': config.get('sourceBaseline', 'v0.12.115' if selected == '0.12.117' else 'v0.12.29'),
            'platform': config.get('platform', 'darwin'),
            'baselineRenderers': config['baselines'], 'files': files,
        }, indent=2) + '\n', encoding='utf-8')
        dest.rename(output)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True, help='Clean supported desktop Resources directory')
    parser.add_argument('--output', type=Path, required=True, help='New output directory outside Resources')
    parser.add_argument('--version', choices=VERSIONS, help='Require this adapter; otherwise detect exact baseline hashes')
    parser.add_argument('--platform', choices=['darwin-arm64', 'win32-x64'], help='446 desktop platform; defaults to the current host')
    args = parser.parse_args()
    try:
        files = stage(args.resources, args.output, args.version, args.platform)
    except (ValueError, FileNotFoundError, AssertionError) as error:
        parser.exit(1, f'Staging stopped: {error}\n')
    print(f'Staged {len(files)} verified files at {args.output}. Application was not modified.')


if __name__ == '__main__':
    main()
