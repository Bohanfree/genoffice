"""Safety and reproducibility checks for the versioned overlay builder."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stage', ROOT / 'stage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StageTests(unittest.TestCase):
    def test_rejects_unknown_inputs_before_creating_output(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            resources, output = base / 'Resources', base / 'output'
            target = resources / 'modules/docs/renderer/assets'
            target.mkdir(parents=True)
            original = target / module.NAMES['docs']
            original.write_bytes(b'unknown version')
            with self.assertRaisesRegex(ValueError, 'unsupported'):
                module.stage(resources, output)
            self.assertFalse(output.exists())
            self.assertEqual(original.read_bytes(), b'unknown version')

    def test_rejects_in_place_and_existing_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            resources = Path(temp) / 'Resources'
            resources.mkdir()
            for output in [resources, resources / 'output', resources.parent]:
                with self.assertRaises(ValueError):
                    module.stage(resources, output)
            existing = resources.parent / 'existing'
            existing.mkdir()
            with self.assertRaisesRegex(ValueError, 'already exists'):
                module.stage(resources, existing)

    @unittest.skipUnless(os.environ.get('BOHAN_BASELINE_RESOURCES'), 'Clean released app supplied only for local compatibility acceptance')
    def test_exact_verified_renderer_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'overlay'
            files = module.stage(Path(os.environ['BOHAN_BASELINE_RESOURCES']), output)
            self.assertEqual(len(files), 12)
            for app, expected in module.EXPECTED_RENDERERS.items():
                self.assertEqual(files[f'modules/{app}/renderer/assets/{module.NAMES[app]}'], expected)


if __name__ == '__main__':
    unittest.main()
