import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { makePlan, validateOfficialAttrs } from '../official/official-typeset-core.mjs'

const source = fs.readFileSync(
  new URL(`../adapters/v${process.env.BOHAN_ADAPTER_VERSION ?? '0.12.29'}/official-host.txt`, import.meta.url),
  'utf8',
)
function scenario({ failPage = false } = {}) {
  const state = { dialog: null, status: '', dispatches: 0 }
  const doc = (v) => ({
    v,
    textContent: '原文',
    content: { size: 4 },
    eq(other) {
      return other.v === v
    },
  })
  const ed = {
    isEditable: true,
    state: { doc: doc(0) },
    view: {
      dispatch(tr) {
        state.dispatches++
        ed.state.doc = tr.next
      },
    },
  }
  Object.defineProperty(ed.state, 'tr', {
    get() {
      return {
        next: ed.state.doc,
        replaceWith(a, b, c) {
          this.next = c
          return this
        },
        setMeta() {
          return this
        },
      }
    },
  })
  const bindDoc = (d) => {
    d.content = d
    d.size = 4
    return d
  }
  bindDoc(ed.state.doc)
  const identity = {},
    styleRef = { current: {} },
    pageRef = {
      current: { locked: false, sections: [{ settings: { x: 1 } }], effective: ['before'] },
    }
  const ctx = {
    doc: identity,
    editor: ed,
    dirtyRef: { current: false },
    section: { x: 1 },
    sections: pageRef.current.sections,
    sectionsDirty: [],
    sectionDirty: false,
  }
  for (const k of [
    'section',
    'sectionDirty',
    'sections',
    'sectionsDirty',
    'trailingStartType',
    'titlePg',
    'titlePgDirty',
    'pgNumEdit',
    'pgNumDirtySections',
    'styleUpserts',
  ])
    ctx['set' + k[0].toUpperCase() + k.slice(1)] = (v) => {
      ctx[k] = v
    }
  const harness = {}
  const sandbox = {
    harness,
    structuredClone,
    document: { getElementById: () => null },
    reactExports: { useRef: (v) => ({ current: v }) },
    fileCtxRef: { current: ctx },
    aiPageCtxRef: pageRef,
    aiStyleUpsertsRef: styleRef,
    setStatus: (s) => (state.status = s),
    loadSystemFontFamilies: async () => ['STFangsong'],
    topLevelBlocks: () => [{ index: 0, node: { type: { name: 'docParagraph' } } }],
    blockText: () => '原文',
    blockText$1: () => '原文',
    openOfficialDialog: (arg) => (state.dialog = arg),
    validateOfficialAttrs,
    resolveStyleDefinition: (input) => ({ value: { upsert: input } }),
    resolvePageSetup: () => ({ settings: { x: 2 } }),
    aiDocExtras: {
      styles: {
        list: () => Object.values(styleRef.current),
        upsert: (up) => {
          styleRef.current = { ...styleRef.current, [up.styleId]: up }
          ctx.styleUpserts = styleRef.current
        },
      },
    },
    executeOps: (editor, ops, opts) => {
      if (!opts.dryRun) editor.state.doc = bindDoc(doc(1))
      return { ok: true }
    },
    aiPageSetupAccess: {
      set: (i, p) => {
        if (failPage) return 'simulated page failure'
        pageRef.current.sections[i] = p
        pageRef.current.effective[i] = 'after'
        ctx.sections = pageRef.current.sections
        ctx.section = p.settings
        return null
      },
    },
  }
  vm.runInNewContext(source + '\nharness.open=openOfficialTypeset;', sandbox)
  return { harness, state, ed, ctx, pageRef, styleRef, identity, bindDoc, doc }
}
const plan = makePlan([{ index: 0, type: 'docParagraph', text: '原文' }])
{
  const s = scenario()
  await s.harness.open()
  assert.ok(s.state.dialog)
  assert.equal(s.state.dispatches, 0)
  assert.equal(s.ed.state.doc.v, 0)
  assert.deepEqual(s.styleRef.current, {})
  s.state.dialog.onApply(plan)
  assert.equal(s.ed.state.doc.v, 1)
  assert.equal(s.pageRef.current.sections[0].settings.x, 2)
  assert.ok(Object.keys(s.styleRef.current).length)
  await s.harness.open()
  assert.equal(s.state.dialog.canUndo, true)
  s.state.dialog.onUndo()
  assert.equal(s.ed.state.doc.v, 0)
  assert.equal(s.pageRef.current.sections[0].settings.x, 1)
  assert.deepEqual(s.styleRef.current, {})
}
{
  const s = scenario({ failPage: true })
  await s.harness.open()
  assert.throws(() => s.state.dialog.onApply(plan), /simulated page failure/)
  assert.equal(s.ed.state.doc.v, 0)
  assert.equal(s.pageRef.current.sections[0].settings.x, 1)
  assert.deepEqual(s.styleRef.current, {})
}
{
  const s = scenario()
  await s.harness.open()
  s.ed.state.doc = s.bindDoc(s.doc(7))
  assert.throws(() => s.state.dialog.onApply(plan), /文档已变化/)
  assert.equal(s.ed.state.doc.v, 7)
  assert.deepEqual(s.styleRef.current, {})
}
{
  const s = scenario()
  await s.harness.open()
  s.ctx.doc = {}
  assert.throws(() => s.state.dialog.onApply(plan), /文档已变化/)
  assert.equal(s.ed.state.doc.v, 0)
}
console.log(
  'Adapter checks passed: opening without mutation, full apply/undo, rollback on page failure, intervening edits and document-switch guards.',
)
