"""Safety and reproducibility checks for the versioned overlay builder."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stage', ROOT / 'stage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fingerprint(paths):
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


class StageTests(unittest.TestCase):
    def test_rejects_unknown_inputs_before_creating_output(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            resources, output = base / 'Resources', base / 'output'
            originals = []
            # Cover both known filenames: neither a familiar path nor an explicit
            # version may make unverified bytes acceptable.
            for config in module.VERSIONS.values():
                target = resources / 'modules/docs/renderer/assets' / config['names']['docs']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'unknown version')
                originals.append(target)
            before = fingerprint(originals)
            for version in [None, *module.VERSIONS]:
                with self.subTest(version=version):
                    with self.assertRaisesRegex(ValueError, 'unsupported'):
                        module.stage(resources, output, version)
                    self.assertFalse(output.exists())
                    self.assertEqual(fingerprint(originals), before)
            with self.assertRaisesRegex(ValueError, 'Unsupported adapter version'):
                module.stage(resources, output, '0.0.0')

    def test_rejects_in_place_and_existing_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            resources = Path(temp) / 'Resources'
            resources.mkdir()
            for output in [resources, resources / 'output', resources.parent]:
                with self.assertRaises(ValueError):
                    module.stage(resources, output)
            existing = resources.parent / 'existing'
            existing.mkdir()
            marker = existing / 'keep.txt'
            marker.write_bytes(b'preserve existing output')
            with self.assertRaisesRegex(ValueError, 'already exists'):
                module.stage(resources, existing)
            self.assertEqual(marker.read_bytes(), b'preserve existing output')

    @unittest.skipUnless(os.environ.get('BOHAN_BASELINE_RESOURCES'), 'Clean released app supplied only for local compatibility acceptance')
    def test_verified_build_preserves_input_and_rejects_repatching(self):
        resources = Path(os.environ['BOHAN_BASELINE_RESOURCES'])
        inputs = [path for config in module.VERSIONS.values()
                  for app, name in config['names'].items()
                  if (path := resources / 'modules' / app / 'renderer/assets' / name).is_file()]
        if (resources / 'app.asar').is_file():
            inputs.append(resources / 'app.asar')
        before = fingerprint(inputs)
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            output = base / 'overlay'
            files = module.stage(resources, output)
            manifest = json.loads((output / 'bohan-overlay.json').read_text())
            version = manifest['upstreamVersion']
            config = module.VERSIONS[version]
            self.assertEqual(len(files), 13 if version == '0.12.117' else 12)
            self.assertEqual(manifest['release'], f'bohan-v{version}.1')
            self.assertEqual(manifest['sourceBaseline'], 'v0.12.115' if version == '0.12.117' else 'v0.12.29')
            self.assertEqual(set(files), set(manifest['files']))
            for app, expected in config['expected'].items():
                name = f"modules/{app}/renderer/assets/{config['names'][app]}"
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), expected)
            for name, expected in files.items():
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), expected)
            self.assertEqual(fingerprint(inputs), before)

            # Installing the overlay and attempting to patch it again must fail
            # without creating a partial new output or changing that installation.
            output_before = fingerprint([output / name for name in files])
            repeated = base / 'second-overlay'
            with self.assertRaisesRegex(ValueError, 'unsupported'):
                module.stage(output, repeated)
            self.assertFalse(repeated.exists())
            self.assertEqual(fingerprint([output / name for name in files]), output_before)

            if version == '0.12.117':
                # A clean renderer set alone is insufficient: independently
                # modified host bytes must stop staging before any writes.
                mixed = base / 'mixed-resources'
                for app, name in config['names'].items():
                    target = mixed / 'modules' / app / 'renderer/assets' / name
                    target.parent.mkdir(parents=True)
                    shutil.copyfile(resources / 'modules' / app / 'renderer/assets' / name, target)
                shutil.copyfile(output / 'app.asar', mixed / 'app.asar')
                mixed_paths = [p for p in mixed.rglob('*') if p.is_file()]
                mixed_before = fingerprint(mixed_paths)
                rejected = base / 'rejected-host-overlay'
                with self.assertRaisesRegex(ValueError, 'Unsupported or already modified'):
                    module.stage(mixed, rejected)
                self.assertFalse(rejected.exists())
                self.assertEqual(fingerprint(mixed_paths), mixed_before)
            self.assertEqual(fingerprint(inputs), before)


if __name__ == '__main__':
    unittest.main()
