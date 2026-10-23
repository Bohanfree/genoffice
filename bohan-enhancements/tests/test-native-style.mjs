import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildStyleMatrix } from '../tables/wps-table-beautify-core.mjs'

// Run the actual shipped command, mutation, formula listener, style merge and
// journal code. Only app services (workbook, DI and viewport) are in-memory.
const source = readFileSync(process.env.BOHAN_SHEETS_RENDERER, 'utf8')
assert.equal(
  createHash('sha256').update(source).digest('hex'),
  'cd03b813680981ce46769bc245d254dfbe4ecef48546fee8412baa663b76131a',
)
const between = (start, end) => {
  const at = source.indexOf(start)
  assert(at >= 0, start)
  const to = source.indexOf(end, at + start.length)
  assert(to > at, end)
  return source.slice(at, to)
}
const Tools = {
  deepClone: structuredClone,
  isArray: Array.isArray,
  isString: (v) => typeof v === 'string',
  isObject: (v) => v !== null && typeof v === 'object',
  isEmptyObject: (v) => !v || Object.keys(v).length === 0,
  removeNull: (o) => {
    if (o) for (const k of Object.keys(o)) if (o[k] == null) delete o[k]
  },
  hasIntersectionBetweenTwoRanges: (a, b, c, d) => a <= d && c <= b,
}
const dependencies = {
  Tools,
  _defineProperty$F: (o, k, v) => (o[k] = v),
  CellValueType: { STRING: 1, NUMBER: 2, BOOLEAN: 3, FORCE_STRING: 4 },
  isTextFormat: (p) => p === '@',
  isRealNum: (v) => v !== '' && Number.isFinite(Number(v)),
  isBooleanString: (v) => /^(TRUE|FALSE)$/i.test(v),
  willLoseNumericPrecision: () => false,
  isSameStyleTextRun: (a, b) => JSON.stringify(a.ts) === JSON.stringify(b.ts),
  CommandType: { COMMAND: 0, MUTATION: 2 },
  UniverType: { UNIVER_SHEET: 2 },
  IUniverInstanceService: 'instances',
  ICommandService: 'commands',
  IUndoRedoService: 'undos',
  SheetsSelectionsService: 'selection',
  SheetSkeletonService: 'skeleton',
  SheetInterceptorService: 'interceptor',
  SetFormulaDataMutation: { id: 'formula.mutation.set-formula-data' },
  SetArrayFormulaDataMutation: { id: 'formula.mutation.set-array-formula-data' },
  findLast: (a, p) => a.findLast(p),
  CustomCommandExecutionError: class extends Error {},
  STACK_CAPACITY: 20,
  toDisposable: (dispose) => ({ dispose }),
}
const declarations = [
  between('var ObjectMatrix = class ObjectMatrix2 {', 'function convertCellToRange('),
  between('function defineExactKeys() {', 'const DEFAULT_STYLES ='),
  between('function isFormulaString(value) {', 'function handleStyleToString('),
  between('function normalizeTextRuns(textRuns,', 'function insertTextRuns('),
  between('function getCellType(styles,', 'function getSheetCommandTargetWorkbook('),
  between('function isPlainRecord$1(value) {', 'const SetRowDataMutationFactory ='),
  between(
    'function createRangeIteratorWithSkipFilteredRows(sheet) {',
    'const ignoreRangeThemeInterceptorFilter =',
  ),
  between('const SetStyleCommand = {', 'const SetBoldCommand ='),
  between('const SetRangeValuesCommand = {', 'function getInsertRangeMutations('),
  between('function updateFormulaDataByCellValue(', 'function clearArrayFormulaCellDataByCell('),
  between('function formulaDataItemToCellData(', 'function isFormulaDataItem('),
  between('function recordSetRangeValues(', 'function recordSetNumfmt('),
  between('function mergeIntoJournal(', 'const XLSX_HORIZONTAL_TO_UNIVER ='),
  between('function toSaveEdits(', 'function makeSharedFormulaResolver('),
  `class NativeUndo {constructor(){this._batchingStatus=new Map();this.undo=[];this.redo=[];} _getUndoStack(){return this.undo;} _getRedoStack(){return this.redo;} _pitchUndoElement(){return this.undo.at(-1);} _updateStatus(){}
 ${between('  pushUndoRedo(item) {', '  clearUndoRedo(unitID) {')}
 ${between('  __tempBatchingUndoRedo(unitId) {', '  _updateStatus() {')}
 ${between('  _tryBatchingElements(item, newItem) {', '  _getFocusedUnitId() {')}}`,
  `class NativeFormulaModel {constructor(){this.data={book:{sheet:{}}};this.ids={};}getFormulaData(){return this.data;} _getSheetFormulaIdMap(){return this.ids;}
 ${between('  updateFormulaData(unitId, sheetId, cellValue) {', '  updateArrayFormulaRange(')}}`,
  `class NativeCommandService {constructor(){this._disposed=false;this._commandExecutionStack=[];this._beforeCommandExecutionListeners=[];this._commandExecutedListeners=[];this._collabMutationListeners=[];this.registry=new Map();this._commandRegistry={getCommand:id=>this.registry.has(id)?[this.registry.get(id)]:null};}
 _pushCommandExecutionStack(v){this._commandExecutionStack.push(v);return {dispose:()=>this._commandExecutionStack.pop()};} _syncExecute(c,p,o){return c.handler(this.accessor,p,o);} executeCommand(...a){return this.syncExecuteCommand(...a);}
 ${between('  syncExecuteCommand(id2, params, options2) {', '  _pushCommandExecutionStack(stackItem) {')}}`,
  `class NativeFormulaController {
 ${between('  _handleSetRangeValuesMutation(params) {', '  _handleWorkbookDisposed(unitId, sheetId) {')}}`,
  `const AFFECT_LAYOUT_STYLES=['ff','fs','tr','tb'];`,
  `return {ObjectMatrix,SetStyleCommand,SetRangeValuesMutation,SetRangeValuesCommand,NativeUndo,NativeFormulaModel,NativeCommandService,NativeFormulaController,recordSetRangeValues,toSaveEdits};`,
].join('\n')
// Resolve the real target helper separately; its end lies before selection helpers.
const targetHelper = between(
  'function getSheetCommandTarget(univerInstanceService, params = {}) {',
  'function ',
)
dependencies.getSheetCommandTarget = Function(
  'UniverType',
  targetHelper + ';return getSheetCommandTarget;',
)(dependencies.UniverType)
dependencies.mapObjectMatrix = (matrix, fn) => {
  const result = {}
  for (const r in matrix)
    for (const c in matrix[r]) {
      result[r] ??= {}
      result[r][c] = fn(+r, +c, matrix[r][c])
    }
  return result
}
dependencies.sequenceExecute = (items, commands) => ({
  result: items.every((m) => commands.syncExecuteCommand(m.id, m.params)),
})
dependencies.followSelectionOperation = () => ({ id: 'noop', params: {} })
dependencies.getSuitableRangesInView = (ranges) => ({ suitableRanges: ranges, remainingRanges: [] })
dependencies.getRangesHeight = () => ({})
dependencies.INDENT_STEP_PX = 12
dependencies.isSheetRemoved = () => false
const native = Function(...Object.keys(dependencies), declarations)(...Object.values(dependencies))
const {
  ObjectMatrix,
  SetStyleCommand,
  SetRangeValuesMutation,
  SetRangeValuesCommand,
  NativeUndo,
  NativeFormulaModel,
  NativeCommandService,
  NativeFormulaController,
  recordSetRangeValues,
  toSaveEdits,
} = native
const adapter = readFileSync(
  new URL('../adapters/v0.12.29/sheets-host.txt', import.meta.url),
  'utf8',
)
const restoreWpsBeautifyAlignmentJournal = Function(
  adapter.slice(0, adapter.indexOf('function openWpsBeautifyFromRibbon')) +
    ';return restoreWpsBeautifyAlignmentJournal;',
)()

function fixture(restoreAlignment = true) {
  const cells = new ObjectMatrix({
    0: {
      0: {
        v: '富文本',
        t: 1,
        p: {
          body: {
            dataStream: '富文本\r\n',
            textRuns: [{ st: 0, ed: 3, ts: { it: 1, ff: '楷体', va: 3 } }],
            paragraphs: [],
          },
        },
        s: { ff: '楷体', fs: 16, n: { pattern: '@' }, ht: 3, vt: 1, tb: 2 },
      },
      1: { v: 7, t: 2, f: '=SUM(B2:B3)', s: { n: { pattern: '0.00' }, it: 1 } },
    },
    1: {
      0: { v: '001', t: 1, s: { n: { pattern: '@' }, ht: 3 } },
      1: { v: 3, t: 2, f: '=B3', si: 'shared', custom: { retained: true } },
    },
    2: { 1: { v: 4, t: 2, si: 'shared' } },
  })
  const styles = {
    getStyleByCell: (c) => (typeof c.s === 'string' ? styles.values.get(c.s) : c.s),
    get: (k) => styles.values.get(k),
    values: new Map(),
    setValue: (s) => {
      const k = JSON.stringify(s)
      styles.values.set(k, structuredClone(s))
      return k
    },
  }
  const worksheet = {
    getCellMatrix: () => cells,
    getSheetId: () => 'sheet',
    getRowFiltered: (_r) => false,
    getCellHeight: () => 20,
  }
  const workbook = {
    getUnitId: () => 'book',
    getSheetBySheetId: () => worksheet,
    getStyles: () => styles,
  }
  const commands = new NativeCommandService(),
    undo = new NativeUndo(),
    model = new NativeFormulaModel(),
    journal = { cells: new Map() }
  model.data.book.sheet = {
    0: { 1: { f: '=SUM(B2:B3)' } },
    1: { 1: { f: '=B3', si: 'shared' } },
    2: { 1: { f: '=B3', si: 'shared', y: 1 } },
  }
  model.ids.shared = { f: '=B3', r: 1, c: 1 }
  const services = {
    instances: { getUnit: () => workbook, getUniverSheetInstance: () => workbook },
    commands,
    undos: undo,
    selection: { getCurrentSelections: () => [] },
    skeleton: { getSkeleton: () => null },
    interceptor: {
      onCommandExecute: () => ({ undos: [], redos: [] }),
      generateMutationsOfAutoHeight: () => ({ undos: [], redos: [] }),
    },
  }
  const accessor = { get: (k) => services[k] }
  commands.accessor = accessor
  for (const c of [
    SetStyleCommand,
    SetRangeValuesMutation,
    SetRangeValuesCommand,
    { id: 'noop', type: 1, handler: () => true },
  ])
    commands.registry.set(c.id, c)
  for (const id of ['formula.mutation.set-formula-data', 'formula.mutation.set-array-formula-data'])
    commands.registry.set(id, { id, type: 2, handler: () => true })
  let formulaTouches = 0
  model.updateArrayFormulaCellData = () => {
    formulaTouches++
    return false
  }
  model.updateArrayFormulaRange = () => {
    formulaTouches++
    return false
  }
  model.updateImageFormulaData = () => {}
  model.getArrayFormulaRange = () => ({})
  model.getArrayFormulaCellData = () => ({})
  const controller = new NativeFormulaController()
  controller._commandService = commands
  controller._formulaDataModel = model
  const at = source.indexOf('        this._handleSetRangeValuesMutation(params);')
  const prefix = 'this.disposeWithMe(this._commandService.beforeCommandExecuted('
  const start = source.lastIndexOf(prefix, at) + prefix.length,
    end = source.indexOf('}));', at) + 1
  const listener = Function(
    'SetRangeValuesMutation',
    'SetStyleCommand',
    'SetBorderCommand',
    'ClearSelectionFormatCommand',
    'SetRangeCustomMetadataCommand',
    `return ${source.slice(start, end)};`,
  ).call(
    controller,
    SetRangeValuesMutation,
    SetStyleCommand,
    { id: 'border' },
    { id: 'clear-format' },
    { id: 'metadata' },
  )
  commands._beforeCommandExecutionListeners.push(listener)
  const baseline = { sha: 'baseline' }
  commands._commandExecutedListeners.push((c, o) => {
    if (c.id === SetRangeValuesMutation.id && !o.fromFormula) {
      recordSetRangeValues(journal, 'sheet', c.params.cellValue)
      if (restoreAlignment)
        restoreWpsBeautifyAlignmentJournal(
          journal,
          'sheet',
          c.params.__wpsBeautifyAlignmentUndo,
          baseline.sha,
        )
    }
  })
  return {
    cells,
    styles,
    commands,
    undo,
    model,
    journal,
    baseline,
    formulaTouches: () => formulaTouches,
  }
}
const area = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }
const { presets } = JSON.parse(
  readFileSync(new URL('../tables/wps-presets.json', import.meta.url), 'utf8'),
)
const visibleStyle = (s) => {
  if (!s) return undefined
  const clean = structuredClone(s)
  for (const key of Object.keys(clean)) if (clean[key] == null) delete clean[key]
  if (clean.bd) {
    for (const side of Object.keys(clean.bd)) if (clean.bd[side] == null) delete clean.bd[side]
    if (!Object.keys(clean.bd).length) delete clean.bd
  }
  return Object.keys(clean).length ? clean : undefined
}
const visibleCells = (matrix, styles) => {
  const result = structuredClone(matrix)
  for (const r of Object.keys(result)) {
    for (const c of Object.keys(result[r])) {
      const cell = result[r][c],
        style = visibleStyle(styles.getStyleByCell(cell))
      if (style) cell.s = style
      else delete cell.s
      if (!Object.keys(cell).length) delete result[r][c]
    }
    if (!Object.keys(result[r]).length) delete result[r]
  }
  return result
}
const old = fixture()
// The exact shipped content command invokes its formula listener for s-only data.
assert(
  old.commands.syncExecuteCommand(SetRangeValuesCommand.id, {
    unitId: 'book',
    subUnitId: 'sheet',
    range: area,
    value: buildStyleMatrix(presets[0], 3, 2),
  }),
)
assert.deepEqual(old.model.data.book.sheet, {})
assert(old.formulaTouches() > 0)

for (const preset of presets) {
  const f = fixture(),
    before = structuredClone(f.cells.getMatrix()),
    formulas = structuredClone(f.model.data),
    matrix = buildStyleMatrix(preset, 3, 2)
  for (const row of matrix)
    for (const cell of row)
      for (const [side, edge] of Object.entries(cell.s.bd ?? {}))
        if (edge?.s === 0) cell.s.bd[side] = null
  const batch = f.undo.__tempBatchingUndoRedo('book'),
    groups = []
  let cursor = 0
  for (const type of new Set(matrix.flatMap((row) => row.flatMap((cell) => Object.keys(cell.s))))) {
    assert(
      f.commands.syncExecuteCommand(SetStyleCommand.id, {
        unitId: 'book',
        subUnitId: 'sheet',
        range: area,
        style: { type, value: matrix.map((row) => row.map((cell) => cell.s[type])) },
      }),
    )
    const item = f.undo._pitchUndoElement()
    groups.push(item.undoMutations.slice(cursor))
    cursor = item.undoMutations.length
  }
  const item = f.undo._pitchUndoElement()
  item.undoMutations = groups.reverse().flat()
  batch.dispose()
  assert.equal(f.undo.undo.length, 1)
  assert.deepEqual(f.model.data, formulas)
  assert.equal(f.formulaTouches(), 0)
  for (const r in before)
    for (const c in before[r]) {
      const original = before[r][c],
        current = f.cells.getValue(+r, +c)
      for (const key of ['v', 'f', 'si', 't', 'custom'])
        assert.deepEqual(current[key], original[key], preset.id + key)
      if (original.p) {
        assert.equal(current.p.body.dataStream, original.p.body.dataStream)
        const run = current.p.body.textRuns[0].ts
        assert.equal(run.it, 1)
        assert.equal(run.ff, '楷体')
        assert.equal(run.va, 3)
      }
      const style = f.styles.getStyleByCell(current)
      for (const key of ['n', 'ht', 'vt', 'tb'])
        assert.deepEqual(style?.[key], original.s?.[key], preset.id + key)
    }
  assert(
    toSaveEdits(f.journal).every(
      (e) => e.writeValue === false && !('formula' in e) && !('rich' in e),
    ),
  )
  const final = visibleCells(f.cells.getMatrix(), f.styles)
  for (const mutation of item.undoMutations)
    assert(
      f.commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params), {
        onlyLocal: true,
      }),
    )
  assert.deepEqual(visibleCells(f.cells.getMatrix(), f.styles), visibleCells(before, f.styles))
  for (const mutation of item.redoMutations)
    assert(
      f.commands.syncExecuteCommand(mutation.id, structuredClone(mutation.params), {
        onlyLocal: true,
      }),
    )
  assert.deepEqual(visibleCells(f.cells.getMatrix(), f.styles), final)
}
function alignmentSnapshot(f) {
  const marker = { fileSha256: f.baseline.sha, cells: [] }
  for (let row = area.startRow; row <= area.endRow; row++)
    for (let column = area.startColumn; column <= area.endColumn; column++) {
      const saved = { row, column },
        style = f.journal.cells.get('sheet')?.get(`${row}:${column}`)?.style
      for (const field of ['horizontalAlignment', 'verticalAlignment'])
        if (style && Object.hasOwn(style, field)) saved[field] = style[field]
      marker.cells.push(saved)
    }
  return marker
}
function nativeBatch(f, preset = presets[5]) {
  const marker = alignmentSnapshot(f),
    matrix = buildStyleMatrix(preset, 3, 2, { layout: 'medium' })
  for (const row of matrix)
    for (const cell of row)
      for (const [side, edge] of Object.entries(cell.s.bd ?? {}))
        if (edge?.s === 0) cell.s.bd[side] = null
  const batch = f.undo.__tempBatchingUndoRedo('book'),
    groups = []
  let cursor = 0
  for (const type of new Set(matrix.flatMap((row) => row.flatMap((cell) => Object.keys(cell.s))))) {
    assert(
      f.commands.syncExecuteCommand(SetStyleCommand.id, {
        unitId: 'book',
        subUnitId: 'sheet',
        range: area,
        style: { type, value: matrix.map((row) => row.map((cell) => cell.s[type])) },
      }),
    )
    const item = f.undo._pitchUndoElement()
    groups.push(item.undoMutations.slice(cursor))
    cursor = item.undoMutations.length
  }
  const item = f.undo._pitchUndoElement()
  item.undoMutations = groups.reverse().flat()
  item.undoMutations.findLast(
    (m) => m.id === SetRangeValuesMutation.id,
  ).params.__wpsBeautifyAlignmentUndo = marker
  batch.dispose()
  return item
}
function replay(f, mutations) {
  for (const m of mutations)
    assert(f.commands.syncExecuteCommand(m.id, structuredClone(m.params), { onlyLocal: true }))
}
function setAlignment(f, ht, vt) {
  for (const [type, value] of [
    ['ht', ht],
    ['vt', vt],
  ])
    if (value !== undefined)
      assert(
        f.commands.syncExecuteCommand(SetStyleCommand.id, {
          unitId: 'book',
          subUnitId: 'sheet',
          range: area,
          style: { type, value },
        }),
      )
}
const mainSource = readFileSync(
  '/Applications/GenOffice.app/Contents/Resources/modules/sheets/main/index.js',
  'utf8',
)
const fromMain = (start, end) => {
  const at = mainSource.indexOf(start),
    to = mainSource.indexOf(end, at + start.length)
  assert(at >= 0 && to > at)
  return mainSource.slice(at, to)
}
const buildAlignment = Function(
  'XLSX_VERTICAL',
  fromMain('const ALIGNMENT_CARRIED =', 'function buildProtection(') +
    fromMain('function readAttribute(element, name) {', 'function toArgb(') +
    ';return buildAlignment;',
)({ top: 'top', center: 'center', bottom: 'bottom' })
const alignNames = {
  ht: { 1: 'left', 2: 'center', 3: 'right' },
  vt: { 1: 'top', 2: 'center', 3: 'bottom' },
}
for (const [name, ht, vt, unsaved] of [
  ['none', undefined, undefined],
  ['center', 2, 2],
  ['right/bottom', 3, 3],
  ['left/top', 1, 1],
  ['prior unsaved', 3, 3, [1, 1]],
  ['partial unsaved', undefined, undefined, [3, undefined]],
]) {
  const f = fixture()
  f.cells.forValue((r, c, cell) => {
    const s = { ...cell.s }
    delete s.ht
    delete s.vt
    if (ht !== undefined) s.ht = ht
    if (vt !== undefined) s.vt = vt
    cell.s = s
  })
  if (unsaved) setAlignment(f, ...unsaved)
  const before = visibleCells(f.cells.getMatrix(), f.styles),
    prior = alignmentSnapshot(f),
    formulas = structuredClone(f.model.data)
  const item = nativeBatch(f),
    applied = visibleCells(f.cells.getMatrix(), f.styles)
  assert(toSaveEdits(f.journal).some((e) => e.style?.horizontalAlignment === 'center'))
  for (let cycle = 0; cycle < 2; cycle++) {
    replay(f, item.undoMutations)
    assert.deepEqual(visibleCells(f.cells.getMatrix(), f.styles), before, name + ' runtime undo')
    assert.deepEqual(alignmentSnapshot(f), prior, name + ' journal undo')
    assert.deepEqual(f.model.data, formulas, name + ' formula model')
    const baseAttrs = [
      ht === undefined ? '' : `horizontal="${alignNames.ht[ht]}"`,
      vt === undefined ? '' : `vertical="${alignNames.vt[vt]}"`,
      'textRotation="30" indent="2" shrinkToFit="1" readingOrder="2"',
    ]
      .filter(Boolean)
      .join(' ')
    const base = `<xf applyAlignment="1"><alignment ${baseAttrs}/></xf>`
    for (const saved of prior.cells) {
      const edit = toSaveEdits(f.journal).find(
        (e) => e.row === saved.row && e.column === saved.column,
      )
      const xml = buildAlignment(base, edit?.style ?? {}),
        expectedHt = saved.horizontalAlignment ?? alignNames.ht[ht],
        expectedVt = saved.verticalAlignment ?? alignNames.vt[vt]
      assert.equal(/horizontal="([^"]+)"/.exec(xml)?.[1], expectedHt, name + ' saved horizontal')
      assert.equal(/vertical="([^"]+)"/.exec(xml)?.[1], expectedVt, name + ' saved vertical')
      for (const attr of ['textRotation="30"', 'indent="2"', 'shrinkToFit="1"', 'readingOrder="2"'])
        assert(xml.includes(attr), name + attr)
    }
    replay(f, item.redoMutations)
    assert.deepEqual(visibleCells(f.cells.getMatrix(), f.styles), applied, name + ' redo')
  }
}
// The identical native path without the hook reproduces the saved-center bug.
const broken = fixture(false)
broken.cells.forValue((r, c, cell) => {
  cell.s = { ...cell.s }
  delete cell.s.ht
  delete cell.s.vt
})
const brokenBatch = nativeBatch(broken)
replay(broken, brokenBatch.undoMutations)
assert.equal(visibleCells(broken.cells.getMatrix(), broken.styles)[0][0].s.ht, undefined)
assert.equal(
  toSaveEdits(broken.journal).find((e) => e.row === 0 && e.column === 0).style.horizontalAlignment,
  'center',
)
// A saved/rebased document deliberately rejects a marker from its old baseline.
const rebased = fixture(),
  rebasedBatch = nativeBatch(rebased)
rebased.baseline.sha = 'after-save'
replay(rebased, rebasedBatch.undoMutations)
assert.equal(
  toSaveEdits(rebased.journal).find((e) => e.row === 0 && e.column === 1).style.horizontalAlignment,
  'center',
)
// Independent batch markers restore the prior unsaved alignment in sequence.
const multi = fixture()
setAlignment(multi, 3, 3)
const initial = alignmentSnapshot(multi),
  one = nativeBatch(multi, presets[0]),
  afterOne = alignmentSnapshot(multi),
  two = nativeBatch(multi, presets[5])
replay(multi, two.undoMutations)
assert.deepEqual(alignmentSnapshot(multi), afterOne)
replay(multi, one.undoMutations)
assert.deepEqual(alignmentSnapshot(multi), initial)
console.log(
  'PASS: shipped formula/style/journal execution for all 10 presets; saved-alignment bug reproduced without hook; baseline none/left/center/right and prior unsaved alignment restored through undo/redo, multiple batches and native OOXML alignment writer; sha guard rejects post-save stale marker.',
)
