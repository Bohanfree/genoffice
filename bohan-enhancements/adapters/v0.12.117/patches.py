"""Frozen, exact-anchor transformations for the verified macOS 0.12.117 build.

Each recipe executes against an isolated source string. No recipe writes files.
The upstream anchor excerpts retain the root Apache-2.0 license.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


def _patch(name, source, result):
    recipe = Path(__file__).with_name(name + '.py.txt')
    namespace = {'source': source, 'ROOT': ROOT}
    exec(compile(recipe.read_text(), str(recipe), 'exec'), namespace)
    return namespace[result]


def patch_official(source):
    return _patch('official', source, 's')


def patch_word(source):
    return _patch('word', source, 's')


def patch_sheets(source):
    return _patch('sheets', source, 'source')


def patch_pdf(source):
    return _patch('pdf', source, 'source')
