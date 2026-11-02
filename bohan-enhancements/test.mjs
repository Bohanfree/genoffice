import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tests = ['test-cloud.mjs', 'test-webdav.mjs', 'test-core.mjs', 'test-word-table.mjs', 'test-official-adapter.mjs', 'test-font-resolution.mjs']
tests.push('test-macos-credentials.mjs', 'test-macos-unconfigured.mjs')
if (process.env.BOHAN_MACOS_MAIN) tests.push('test-macos-smb.mjs')
if (process.env.BOHAN_SHEETS_RENDERER) tests.push('test-native-style.mjs', 'test-native-batch.mjs')
if (process.env.BOHAN_DOCS_RENDERER) tests.push('test-native-docs.mjs')
if (process.env.BOHAN_PDF_RENDERER) tests.push('test-pdf-renderer.mjs')
for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(`./tests/${test}`, import.meta.url))],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
