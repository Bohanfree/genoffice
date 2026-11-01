import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
const source = readFileSync(process.env.BOHAN_PDF_RENDERER, 'utf8')
const runner = source.slice(
  source.indexOf('async function runAutoOcr('),
  source.indexOf('function OcrTextLayer('),
)
const helpers = readFileSync(new URL('../pdf/ocr-cache.txt', import.meta.url), 'utf8')
const context = vm.createContext({
  crypto: webcrypto,
  Uint8Array,
  AUTO_OCR_PAGE_CAP: 40,
  isScannedEntry: (entry) => entry.text.trim().length < 8,
  buildOcrPageData: (lines) => (lines.length ? { lines } : null),
})
vm.runInContext(helpers + '\n' + runner, context)
const a = await context.genOfficeOcrContentKey(new Uint8Array([1, 2, 3]))
assert.equal(a, await context.genOfficeOcrContentKey(new Uint8Array([1, 2, 3])))
assert.notEqual(a, await context.genOfficeOcrContentKey(new Uint8Array([1, 2, 4])))
const known = new Set([0])
const rendered = []
const controller = new AbortController()
const options = {
  doc: {},
  cache: {
    get: async () => [
      { text: '' },
      { text: '' },
      { text: 'Native text remains native' },
      { text: '' },
    ],
  },
  fromPage: () => 0,
  geom: (page) => page,
  render: async (_, page) => {
    rendered.push(page)
    return 'png'
  },
  ocrPage: async () => [{ text: 'recognized' }],
  hasPage: (page) => known.has(page),
  onPage: async (page) => {
    await Promise.resolve()
    known.add(page)
  },
  onProgress: () => {},
  signal: controller.signal,
}
const first = await context.runAutoOcr({ ...options, limit: 1 })
assert.equal(first.stop, 'cap')
assert.deepEqual(rendered, [1])
const resumed = await context.runAutoOcr({ ...options, pending: first.pending })
assert.equal(resumed.stop, 'complete')
assert.deepEqual(rendered, [1, 3])
await context.runAutoOcr(options)
assert.deepEqual(rendered, [1, 3], 'cached pages must not render or invoke OCR again')
controller.abort()
known.clear()
const cancelled = await context.runAutoOcr(options)
assert.equal(cancelled.stop, 'cancelled')
assert.deepEqual(rendered, [1, 3], 'cancellation must stop before expensive rendering')
const effect = source.slice(
  source.indexOf('  const ocrPending ='),
  source.indexOf('    setPageBlocks', source.indexOf('  const ocrPending =')),
)
assert(!effect.includes('startOcrPass('), 'opening or cache restoration must never trigger OCR')
console.log(
  'Passed: exact-content keys; cached/native-page skipping; cap/resume; cancellation; no OCR on open.',
)

// Execute the shipped component's real hook sequence with a restored OCR page.
// In 446 the upstream eager bake memo referenced pageGeomRef before initialization.
if (process.env.BOHAN_ADAPTER_VERSION === '0.12.446') {
  const start = source.indexOf('  const [ocrPages, setOcrPages] =');
  const refEnd = source.indexOf('  pageGeomRef.current = pageGeom;', start) + '  pageGeomRef.current = pageGeom;'.length;
  const memoStart = source.indexOf('  const ocrBakeInserts =', start);
  const memoEnd = source.indexOf('  }, [ocrPages, pageGeom]);', memoStart) + '  }, [ocrPages, pageGeom]);'.length;
  const fragment = source.slice(start, Math.max(refEnd, memoEnd));
  let firstState = true;
  const renderContext = vm.createContext({
    reactExports: {
      useState(init) {
        const value = firstState ? new Map([[0, { words: [{ text: 'cached OCR' }] }]]) : typeof init === 'function' ? init() : init;
        firstState = false;
        return [value, () => {}];
      },
      useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }),
    },
    createSearchIndexCache: () => ({}), allSizes: [{ width: 600, height: 300 }],
    order: null, deleted: new Set(), spread: false, spreadRows: (v) => v,
    rowOfVisIdx: (i) => i, filePath: 'fixture.pdf', rotations: new Map(),
    rotationsRef: { current: new Map() }, pageOrigins: [[0, 0]], baseRots: [0], pageUserUnits: [1],
    blankSizeNow: () => ({ width: 600, height: 300 }),
    buildOcrBakeInserts: (page, words, geom) => [{ page, text: words[0].text, width: geom.pw }],
  });
  const inserts = vm.runInContext(fragment + '\nocrBakeInserts', renderContext);
  assert.equal(inserts[0].input.text, 'cached OCR');
  assert.equal(inserts[0].input.width, 600);
  console.log('Passed: restored OCR pages render without accessing uninitialized geometry.');
}
