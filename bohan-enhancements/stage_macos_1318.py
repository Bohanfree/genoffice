"""Pinned macOS ARM64 0.13.18 overlay: WebDAV host and Keychain setup (no SMB fallback)."""
import stage_macos_852
import stage_webdav_1318 as stage_webdav


def patch_asar(archive):
    return stage_webdav.patch_asar(archive)


def bootstrap_bytes():
    return stage_macos_852.bootstrap_bytes().replace(
        '增强版 0.12.852-macos.1 · 双向同步与历史版本'.encode('utf-8'),
        '增强版 0.13.18-macos.1 · 双向同步与历史版本'.encode('utf-8'),
        1,
    )
