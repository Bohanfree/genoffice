import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Schema } = require('prosemirror-model'),
  { EditorState, NodeSelection, TextSelection } = require('prosemirror-state'),
  { history, undo, redo, closeHistory, undoDepth } = require('prosemirror-history'),
  { TableMap } = require('prosemirror-tables')
import { createWordTableBridge } from '../tables/wps-word-table-adapter.mjs'
import { buildWordMatrix, mergedWordStyle } from '../tables/wps-word-table-core.mjs'
import { nativeDocsHelpers } from './native-docs-helpers.mjs'
const attrs = (keys) => Object.fromEntries(keys.map((k) => [k, { default: null }]))
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    docParagraph: {
      group: 'block',
      content: 'inline*',
      attrs: attrs([
        'align',
        'bidi',
        'spaceBefore',
        'spaceAfter',
        'spaceBeforeAuto',
        'spaceAfterAuto',
        'emptyRunSize',
        'emptyRunFont',
        'markSize',
        'lineSpacing',
        'lineRule',
        'lineRawTwips',
        'snapToGrid',
        'indentLeft',
        'indentRight',
        'indentFirstLine',
        'indentFirstLineChars',
      ]),
    },
    docListItem: { content: 'inline*', attrs: attrs(['align', 'bidi', 'numId']) },
    docTable: {
      group: 'block',
      content: 'docTableRow+',
      tableRole: 'table',
      attrs: attrs([
        'tblStyleId',
        'tblFill',
        'borders',
        'widthPx',
        'widthPct',
        'colWidthsPct',
        'tblAutoFit',
        'tblAutoFitEdited',
      ]),
    },
    docTableRow: {
      content: 'docTableCell+',
      tableRole: 'row',
      attrs: attrs(['heightTwips', 'heightRule', 'repeatHeader', 'repeatHeaderEdited']),
    },
    docTableCell: {
      content: '(docParagraph | docListItem | nested)+',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        ...attrs([
          'colwidth',
          'gridGap',
          'fill',
          'color',
          'bold',
          'vAlign',
          'borders',
          'cellMar',
          'tcPrEdited',
        ]),
      },
    },
    image: { inline: true, group: 'inline', atom: true, attrs: { id: { default: 1 } } },
    nested: { atom: true, attrs: { model: { default: { x: 1 } } } },
  },
  marks: {
    bold: {},
    italic: {},
    underline: {},
    strike: {},
    link: { attrs: { href: {} } },
    docTextStyle: {
      attrs: attrs(['color', 'sizeHalfPoints', 'font', 'eastAsiaFont', 'fontAscii', 'highlight']),
    },
  },
})
const text = (value, color = '123456') =>
  schema.text(value, [
    schema.marks.docTextStyle.create({
      color,
      sizeHalfPoints: 32,
      font: '楷体',
      highlight: 'yellow',
    }),
    schema.marks.link.create({ href: 'https://example.com' }),
  ])
const para = (value) =>
  schema.nodes.docParagraph.create({ align: 'right' }, [
    text(value),
    schema.nodes.image.create(),
    text(value + '后'),
  ])
const cell = (content, options = {}) =>
    schema.nodes.docTableCell.create({ fill: 'OLDOLD', ...options }, content),
  row = (cells) => schema.nodes.docTableRow.create({ heightTwips: 700 }, cells)
const merged = cell(
  [
    para('合并'),
    schema.nodes.docListItem.create({ numId: 5 }, text('列表')),
    schema.nodes.nested.create(),
  ],
  { colspan: 2, colwidth: [100, 120] },
)
const table = schema.nodes.docTable.create({ tblStyleId: 'OldStyle', widthPx: 330 }, [
  row([merged, cell([para('标题')])]),
  row([
    cell([para('正文一'), para('正文二')]),
    cell([para('正文三')]),
    cell([schema.nodes.docParagraph.create()]),
  ]),
  row([cell([para('末行一')]), cell([para('末行二')]), cell([para('末行三')])]),
])
const initialDoc = schema.nodes.doc.create(null, [para('表前'), table, para('表后')]),
  tablePos = initialDoc.firstChild.nodeSize
const preset = {
  id: 'fixture',
  name: '测试样式',
  themeColor: '#4F81BD',
  cells: Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => ({
      fill: r === 0 ? '4F81BD' : r % 2 ? 'FFFFFF' : 'DCE6F1',
      font: { bold: r === 0, color: r === 0 ? 'FFFFFF' : '000000' },
      paragraph: { align: 'center' },
      vAlign: 'center',
      borders: Object.fromEntries(
        ['top', 'right', 'bottom', 'left'].map((side) => [
          side,
          {
            style: 'single',
            szEighths: r === 5 && side === 'bottom' ? 16 : 4,
            color: c === 4 && side === 'right' ? 'C0504D' : '4F81BD',
          },
        ]),
      ),
    })),
  ),
}
const matrix = buildWordMatrix(preset, 3, 3, { headerRows: 1 })
assert.equal(
  mergedWordStyle(matrix, { top: 0, left: 0, right: 3, bottom: 1 }).borders.right.color,
  'C0504D',
)
assert.equal(matrix[2][0].borders.bottom.szEighths, 16)
assert.equal(buildWordMatrix(preset, 3, 3, { headerRows: 0 })[0][0].fill, 'FFFFFF')
let dispatches = 0,
  state = EditorState.create({
    schema,
    doc: initialDoc,
    plugins: [history()],
    selection: NodeSelection.create(initialDoc, tablePos),
  })
const editor = {
  schema,
  isEditable: true,
  get state() {
    return state
  },
  view: {
    dispatch(tr) {
      dispatches++
      state = state.apply(tr)
    },
  },
}
globalThis.document = {
  createElement() {
    return {
      getContext() {
        return {
          font: '',
          measureText(t) {
            return { width: t.length * 16 }
          },
        }
      },
    }
  },
}
const notices = [],
  helpers = {
    TableMap,
    closeHistory,
    availableWidth: 600,
    notify: (m) => notices.push(m),
    selectedTable(st) {
      const $p = st.selection.$head
      for (let d = $p.depth; d > 0; d--)
        if ($p.node(d).type.name === 'docTable') return { node: $p.node(d), pos: $p.before(d) }
      return null
    },
    buildTextMarkPatch(font) {
      const p = {}
      if ('color' in font) p.color = font.color
      if ('fontSize' in font) p.sizeHalfPoints = Math.round(font.fontSize * 2)
      if ('fontFamily' in font)
        Object.assign(p, { font: font.fontFamily, eastAsiaFont: font.fontFamily })
      return p
    },
    alignAttrFor: (a) => a,
    effectiveBidi: () => false,
  }
if (process.env.BOHAN_DOCS_RENDERER) {
  Object.assign(helpers, nativeDocsHelpers(process.env.BOHAN_DOCS_RENDERER))
  // A caret inside a cell exercises the shipped selectedTable helper, whereas
  // selecting the whole table takes the bridge's own NodeSelection branch.
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, tablePos + 4)))
  assert.equal(helpers.selectedTable(state).pos, tablePos)
}
const bridge = createWordTableBridge(editor, helpers)
assert.equal(bridge.inspect().cellCount, 8)
const before = state.doc.toJSON()
bridge.apply({ preset, options: { layout: 'preserve', headerRows: 1 } })
assert.equal(dispatches, 2)
assert.equal(undoDepth(state), 1)
assert.equal(state.doc.textContent, initialDoc.textContent)
assert.equal(state.doc.nodeAt(tablePos).firstChild.firstChild.attrs.colspan, 2)
assert.deepEqual(state.doc.nodeAt(tablePos).firstChild.firstChild.attrs.colwidth, [100, 120])
assert.equal(state.doc.nodeAt(tablePos).firstChild.attrs.heightTwips, 700)
let visited = 0
state.doc.nodeAt(tablePos).descendants((n) => {
  if (n.isText) {
    visited++
    const mark = n.marks.find((m) => m.type.name === 'docTextStyle')
    assert.equal(mark.attrs.sizeHalfPoints, 32)
    assert.equal(mark.attrs.font, '楷体')
    assert.equal(mark.attrs.highlight, 'yellow')
    assert(n.marks.some((m) => m.type.name === 'link'))
  }
  if (n.type.name === 'docParagraph' || n.type.name === 'docListItem')
    assert.equal(n.attrs.align, 'center')
})
assert(visited > 15)
assert(
  undo(state, (tr) => {
    state = state.apply(tr)
  }),
)
assert.deepEqual(state.doc.toJSON(), before)
assert(
  redo(state, (tr) => {
    state = state.apply(tr)
  }),
)
const styled = state.doc.toJSON()
assert.notDeepEqual(styled, before)
// Independent undo boundary: immediate text edit is a separate undo event.
const contentPos = tablePos + 3
let edit = state.tr.insertText('新', contentPos)
state = state.apply(edit)
assert.equal(undoDepth(state), 2)
undo(state, (tr) => (state = state.apply(tr)))
assert.deepEqual(state.doc.toJSON(), styled)
// Stale dialog does not apply to a changed document.
state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, tablePos)))
const stale = createWordTableBridge(editor, helpers)
stale.inspect()
state = state.apply(state.tr.insertText('变', 1))
assert.throws(() => stale.apply({ preset, options: {} }), /文档内容已变化/)
// Explicit layout updates merged width arrays and row minimum; no forced font.
state = EditorState.create({
  schema,
  doc: initialDoc,
  plugins: [history()],
  selection: NodeSelection.create(initialDoc, tablePos),
})
const layout = createWordTableBridge(editor, helpers)
layout.inspect()
layout.apply({ preset, options: { layout: 'fit', headerRows: 1 } })
assert.equal(undoDepth(state), 1)
const t = state.doc.nodeAt(tablePos)
assert.equal(t.firstChild.firstChild.attrs.colwidth.length, 2)
assert(Math.abs(t.attrs.widthPx - 600) < 0.01)
assert.equal(t.firstChild.attrs.heightRule, 'atLeast')
// Read-only defense applies even after opening.
state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, tablePos)))
const locked = createWordTableBridge(editor, helpers)
locked.inspect()
editor.isEditable = false
assert.throws(() => locked.apply({ preset, options: {} }), /只读/)
console.log(
  'PASS: Word merged cells, all paragraphs/runs, preserved links/atoms/fonts, content, native one-event undo/redo, isolated rapid typing, stale-doc and read-only guards, explicit layout',
)
// Captured WPS Word presets: 300 concrete cell styles and native property transformations.
const { readFileSync } = await import('node:fs')
const captured = JSON.parse(
  readFileSync(new URL('../tables/wps-word-presets.json', import.meta.url)),
).presets
let compared = 0
const rowsForSource = []
for (let r = 0; r < 6; r++)
  rowsForSource.push(
    row(
      Array.from({ length: 5 }, (_, c) =>
        cell([
          schema.nodes.docParagraph.create(
            { align: 'right' },
            text(
              r === 0
                ? '标题' + c
                : c === 0
                  ? String(r)
                  : c === 1
                    ? '文字项目'
                    : c === 4
                      ? '12%'
                      : '123.45',
            ),
          ),
        ]),
      ),
    ),
  )
const sampleTable = schema.nodes.docTable.create({ tblStyleId: 'OldStyle' }, rowsForSource),
  sampleDoc = schema.nodes.doc.create(null, [sampleTable])
for (const p of captured) {
  const matrix = buildWordMatrix(p, 6, 5, {
    headerRows: 1,
    bandedRows: true,
    themeColor: '#4F81BD',
  })
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 5; c++) {
      assert.deepEqual(matrix[r][c], p.cells[r][c], `${p.id} sample ${r},${c}`)
      compared++
    }
  state = EditorState.create({
    schema,
    doc: sampleDoc,
    plugins: [history()],
    selection: NodeSelection.create(sampleDoc, 0),
  })
  editor.isEditable = true
  const actual = createWordTableBridge(editor, helpers)
  actual.inspect()
  actual.apply({ preset: p, options: { layout: 'preserve', headerRows: 1, bandedRows: true } })
  const changed = state.doc.firstChild
  assert.equal(undoDepth(state), 1)
  assert.equal(changed.textContent, sampleTable.textContent)
  for (let r = 0; r < 6; r++) {
    assert.equal(changed.child(r).attrs.repeatHeader, r === 0)
    assert.equal(changed.child(r).attrs.repeatHeaderEdited, true)
    for (let c = 0; c < 5; c++) {
      const expected = p.cells[r][c],
        native = changed.child(r).child(c)
      assert.equal(native.attrs.fill, expected.fill)
      assert.deepEqual(native.attrs.borders, expected.borders)
      assert.equal(native.attrs.vAlign, expected.vAlign)
      native.descendants((n) => {
        if (n.type.name === 'docParagraph')
          for (const [key, value] of Object.entries(expected.paragraph))
            assert.equal(n.attrs[key], value, `${p.id} paragraph ${key}`)
        if (n.isText) {
          const mark = n.marks.find((m) => m.type.name === 'docTextStyle')
          assert.equal(mark.attrs.color, expected.font.color)
          assert.equal(mark.attrs.sizeHalfPoints, expected.font.fontSize * 2)
          assert.equal(mark.attrs.font, '楷体')
          assert.equal(
            n.marks.some((m) => m.type.name === 'bold'),
            expected.font.bold,
          )
          assert.equal(
            n.marks.some((m) => m.type.name === 'italic'),
            expected.font.italic,
          )
        }
      })
    }
  }
  const after = state.doc.toJSON()
  undo(state, (tr) => (state = state.apply(tr)))
  assert.deepEqual(state.doc.toJSON(), sampleDoc.toJSON())
  redo(state, (tr) => (state = state.apply(tr)))
  assert.deepEqual(state.doc.toJSON(), after)
}
const report = {
  presetCount: captured.length,
  cellsCompared: compared,
  cellMismatches: 0,
  nativeAttributeTransformations: true,
  mergedCells: true,
  sourceFontFamilyPreserved: true,
  wordMeasuredSize11: true,
  nativeUndoRedo: true,
  installed: false,
}
console.log('PASS captured Word presets:', JSON.stringify(report))
