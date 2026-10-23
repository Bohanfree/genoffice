import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildStyleMatrix,
  recolor,
  validatePreset,
  officeTint,
  measureLayout,
} from '../tables/wps-table-beautify-core.mjs'

// Deliberately synthetic fixture: validates interpolation mechanics, not WPS visual fidelity.
const fixture = {
  id: 'test',
  name: 'synthetic',
  themeColor: '#4F81BD',
  rowBandPeriod: 2,
  lastRow: true,
  cells: Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) => ({
      bg: { rgb: row === 0 ? '#4F81BD' : row % 2 ? '#FFFFFF' : '#EDF2F8' },
      cl: { rgb: row === 0 ? '#FFFFFF' : '#000000' },
      bl: row === 0 ? 1 : 0,
      bd: {
        l: column === 0 ? { s: 1, cl: { rgb: '#4F81BD' } } : null,
        r: column === 4 ? { s: 1, cl: { rgb: '#4F81BD' } } : null,
        b: row === 5 ? { s: 1, cl: { rgb: '#4F81BD' } } : null,
      },
      ht: 2,
      vt: 2,
      tb: 3,
      n: { pattern: '0.00' },
    })),
  ),
}
const original = JSON.stringify(fixture)
assert(validatePreset(fixture))
const matrix = buildStyleMatrix(fixture, 9, 8, { headerRows: 2 })
assert.equal(matrix.length, 9)
assert.equal(matrix[0].length, 8)
assert.equal(matrix[0][0].s.bg.rgb, '#4F81BD')
assert.equal(matrix[1][0].s.bl, 1)
assert.equal(matrix[2][0].s.bg.rgb, '#FFFFFF')
assert.equal(matrix[3][0].s.bg.rgb, '#EDF2F8')
assert.equal(matrix[8][0].s.bg.rgb, '#FFFFFF')
assert.equal(matrix[8][0].s.bd.b.s, 1)
assert.equal(matrix[2][7].s.bd.r.s, 1)
assert.equal(matrix[2][6].s.bd.r, null)
for (const row of matrix)
  for (const cell of row) {
    assert.deepEqual(Object.keys(cell), ['s'])
    for (const key of ['ff', 'ht', 'vt', 'tb', 'n']) assert(!(key in cell.s))
  }
const noHeaders = buildStyleMatrix(fixture, 4, 3, { headerRows: 0 })
assert.equal(noHeaders[0][0].s.bl, 0)
assert.equal(noHeaders[0][0].s.bg.rgb, '#FFFFFF')
const flat = buildStyleMatrix(fixture, 8, 3, { headerRows: 1, bandedRows: false })
assert(flat.slice(1).every((row) => row[0].s.bg.rgb === '#FFFFFF'))
const manyHeaders = buildStyleMatrix(fixture, 8, 3, { headerRows: 5 })
assert(manyHeaders.slice(0, 5).every((row) => row[0].s.bl === 1))
assert.equal(manyHeaders[5][0].s.bl, 0)
assert.equal(JSON.stringify(fixture), original)
assert.equal(recolor('#FFFFFF', '#4F81BD', '#C0504D'), '#FFFFFF')
assert.equal(recolor('#000000', '#4F81BD', '#C0504D'), '#000000')
assert.equal(recolor('#4F81BD', '#4F81BD', '#C0504D'), '#C0504D')
assert.throws(() => buildStyleMatrix(fixture, 100001, 1), /100000/)
assert.throws(() => buildStyleMatrix({}, 2, 2), /未就绪/)
for (const [t, color] of [
  [0.9, '#EDF2F8'],
  [0.8, '#DCE6F2'],
  [0.66, '#C3D4E9'],
  [0.6, '#B9CDE5'],
])
  assert.equal(officeTint('#4F81BD', t), color)
const { presets } = JSON.parse(
  readFileSync(new URL('../tables/wps-presets.json', import.meta.url), 'utf8'),
)
const withoutFont = (style) => {
  const result = structuredClone(style)
  delete result.ff
  return result
}
for (const p of presets)
  assert.deepEqual(
    buildStyleMatrix(p, 6, 5).map((row) => row.map((cell) => cell.s)),
    p.cells.map((row) => row.map(withoutFont)),
    p.id + ' must match all captured cells except source-preserved font family',
  )
const measure = (text, s) => text.length * s.fs * 0.75
const texts = Array.from({ length: 6 }, () => [
  '项目',
  '很长的内容用于测量换行和行高'.repeat(3),
  '1',
  '2',
  '3',
])
const layout = (name) => {
  const opts = { layout: name, headerRows: 1, mdw: 8, availableWidth: 500 }
  const m = buildStyleMatrix(fixture, 6, 5, opts)
  return { m, d: measureLayout(texts, m, opts, measure) }
}
const compact = layout('compact'),
  medium = layout('medium'),
  loose = layout('loose'),
  fit = layout('fit')
assert.equal(compact.m[0][0].s.fs, 11)
assert.equal(compact.m[1][0].s.fs, 10)
assert.equal(loose.m[0][0].s.fs, 12)
assert.equal(loose.m[1][0].s.fs, 11)
assert.equal(compact.d.rowHeights[0], (18.5 * 96) / 72)
assert.equal(medium.d.rowHeights[0], (22.5 * 96) / 72)
assert.equal(loose.d.rowHeights[0], (31.25 * 96) / 72)
assert(compact.d.columnWidths.every((w, c) => medium.d.columnWidths[c] === w + 16))
assert(Math.abs(fit.d.columnWidths.reduce((a, b) => a + b, 0) - 500) < 0.001)
assert(fit.d.rowHeights.some((h) => h > 30))
console.log(
  'Core tests passed, including 300 captured WPS cells, HLS tints, adaptive layouts, wrapping, and width constraints.',
)
