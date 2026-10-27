import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Schema } from 'prosemirror-model'
import { nativeDocsHelpers } from './native-docs-helpers.mjs'

const native = nativeDocsHelpers(process.env.BOHAN_DOCS_RENDERER)
assert.deepEqual(native.buildTextMarkPatch({ fontFamily: '仿宋', fontSize: 16, color: '#abc123' }),
  { font: '仿宋', eastAsiaFont: '仿宋', eaSlotEmpty: false, sizeHalfPoints: 32, color: 'ABC123' })
assert.deepEqual(native.buildTextMarkPatch({ fontFamily: 'Arial' }), { fontAscii: 'Arial' })
assert.equal(native.alignAttrFor('left', false), null)
assert.equal(native.alignAttrFor('right', true), null)
assert.equal(native.effectiveBidi({ bidiInferred: true }), true)
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    docParagraph: { group: 'block', content: 'inline*' },
    docHeading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    docProtected: { group: 'block', atom: true, attrs: { label: {}, previewText: {} } },
  },
  marks: { bold: {}, del: {}, redaction: { attrs: { label: { default: null } } } },
})
const doc = schema.nodes.doc.create(null, [
  schema.nodes.docHeading.create(null, schema.text('关于测试的通知')),
  schema.nodes.docParagraph.create(null, [schema.text('原始'), schema.text('正文', [schema.marks.bold.create()])]),
  schema.nodes.docProtected.create({ label: '保留对象', previewText: '图示说明' }),
])
// This is the GUI failure trigger: a ProseMirror Fragment is not a JSON array.
assert.throws(() => native.blockText(doc.firstChild), /content.map is not a function/)
assert.equal(native.blockText(doc.firstChild.toJSON()), '关于测试的通知')
assert.deepEqual(native.topLevelBlocks(doc).map(({ node }) => native.blockText$1(node)),
  ['关于测试的通知', '原始正文', '保留对象 图示说明'])

const source = readFileSync(new URL('../adapters/v0.12.117/official-host.txt', import.meta.url), 'utf8')
let dialog, status = ''
const snapshot = doc.toJSON()
const editor = { isEditable: true, state: { doc } }
const identity = {}
const sandbox = {
  ...native,
  harness: {}, structuredClone,
  document: { getElementById: () => null },
  reactExports: { useRef: (value) => ({ current: value }) },
  fileCtxRef: { current: { doc: identity, editor } },
  aiPageCtxRef: { current: { locked: false, sections: [], effective: [] } },
  aiStyleUpsertsRef: { current: {} },
  setStatus: (value) => { status = value },
  loadSystemFontFamilies: async () => ['仿宋'],
  openOfficialDialog: (value) => { dialog = value },
}
vm.runInNewContext(source + '\nharness.open = openOfficialTypeset;', sandbox)
await sandbox.harness.open()
assert.equal(status, '')
assert.ok(dialog, 'Real ProseMirror blocks must reach the public-document dialog')
assert.deepEqual(Array.from(dialog.blocks, (b) => b.text), ['关于测试的通知', '原始正文', '保留对象 图示说明'])
assert.deepEqual(doc.toJSON(), snapshot)
console.log('PASS: 117 shipped JSON/ProseMirror readers distinguished; real ProseMirror heading, paragraph and protected object reach the official dialog unchanged.')
