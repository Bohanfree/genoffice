"""Pinned 0.13.18 host/preload integration for the background backup service."""
import stage_webdav_shared

BASELINE_ASAR = 'd30966f9c9b18ec3725b15891d62f825b5d5edc192e33ed81b5845525530a429'
EXPECTED_ASAR = 'd7e8da3ef90fcc2f3c48401e19ecf56b58be5fb4d93c7260122fbc016e17bd6b'
PRELOADS = {
    'docs': '52bd2a6cb0d90086f00bdcc74f636303d1a1f49acdfc75b7bac1dddf0d7baf8e',
    'pdf': '8cf74c12be28d909f674861f52442ce996e9c93ce6e9446c2530390e2a461f19',
}


def preload_bytes(module, original):
    return stage_webdav_shared.preload_bytes(PRELOADS, module, original)


def patch_asar(archive):
    return stage_webdav_shared.patch_asar(
        archive,
        baseline_asar=BASELINE_ASAR,
        expected_asar=EXPECTED_ASAR,
        out_preload_hash='f3a9008f21e31790c849031f4075e9778e26e3bd26fc373d2a26f4f2f212cb9d',
        renderer_name='out/renderer/assets/index-CVjVj1AC.js',
    )
