import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { TableMap, CellSelection } from 'prosemirror-tables'

// Read the verified vendor renderer, rather than reimplementing its helpers.
// The 117 Mailings feature introduced a JSON blockText; ProseMirror's reader
// became blockText$1. Keeping both here exposes accidental symbol selection.
export function nativeDocsHelpers(path) {
  const source = readFileSync(path, 'utf8')
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '3628cbe61e08bc9b898c531cca62b0ad8d52752e657f2402046b8aab68b1019d')
  const between = (start, end) => {
    const at = source.indexOf(start)
    assert(at >= 0, start)
    assert.equal(source.indexOf(start, at + start.length), -1, `ambiguous ${start}`)
    const to = source.indexOf(end, at + start.length)
    assert(to > at, end)
    return source.slice(at, to)
  }
  const declarations = [
    between('const hasDelMark$1 =', 'function isTrackedDeleted('),
    between('function topLevelBlocks(', 'function matchTarget('),
    between('function blockText(node)', 'function mergeAllRecords('),
    between('const EAST_ASIAN_FONT_RE =', 'function defaultEastAsiaFontFor('),
    between('const HEX$1 =', 'function checkHex('),
    between('function buildTextMarkPatch(', 'function applyFontRange('),
    between('function effectiveBidi(', 'function isRtlUiLang('),
    between('function alignAttrFor(', 'function dirFlipAttrs('),
    between('function cellAround(', 'function isInTable('),
    between('function isInTable(', 'function selectionCell('),
    between('function selectionCell(', 'function cellNear('),
    between('function cellNear(', 'function pointsAtCell('),
    between('function selectedRect(', 'function addColumn('),
    between('function selectedTable(', 'function updateSelectedTableAttrs('),
    'return {topLevelBlocks,blockText,blockText$1,selectedTable,buildTextMarkPatch,alignAttrFor,effectiveBidi};',
  ].join('\n')
  return Function('TableMap', 'CellSelection', declarations)(TableMap, CellSelection)
}
