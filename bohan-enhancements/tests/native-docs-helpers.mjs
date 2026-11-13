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
    process.env.BOHAN_ADAPTER_VERSION === '0.13.18'
      ? '89d1b6c8bc28fb63be83a7a6deed4128f7b0f9c449fa83d7052ba3ce79362765'
      : process.env.BOHAN_ADAPTER_VERSION === '0.12.852'
      ? '49d9cb06f64cebd46fbd56c3fe27930ba664aaabe9dd8f590f4dd00525ad2150'
      : process.env.BOHAN_ADAPTER_VERSION === '0.12.446'
      ? '536c67aa6459bb0c912aa866841b586cbd8b158b6cb68fd0ec1c42a67f27c2e3'
      : '3628cbe61e08bc9b898c531cca62b0ad8d52752e657f2402046b8aab68b1019d')
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
