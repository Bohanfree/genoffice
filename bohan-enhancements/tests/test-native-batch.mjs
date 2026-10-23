import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(process.env.BOHAN_SHEETS_RENDERER, 'utf8')
const method = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
// Execute the actual shipped native batching methods with a small in-memory mutation store.
const Service = Function(
  'STACK_CAPACITY',
  'toDisposable',
  `return class {
 constructor(){this._batchingStatus=new Map();this.undo=[];this.redo=[];}
 _getUndoStack(){return this.undo;} _getRedoStack(){return this.redo;} _pitchUndoElement(){return this.undo.at(-1);} _updateStatus(){}
 ${method('  pushUndoRedo(item) {', '  clearUndoRedo(unitID) {')}
 ${method('  __tempBatchingUndoRedo(unitId) {', '  _updateStatus() {')}
 ${method('  _tryBatchingElements(item, newItem) {', '  _getFocusedUnitId() {')}
}`,
)(20, (dispose) => ({ dispose }))
const service = new Service(),
  state = { style: 'original', row: 20, column: 80 }
const initial = structuredClone(state),
  batch = service.__tempBatchingUndoRedo('book'),
  groups = []
let cursor = 0
for (const [key, value] of [
  ['style', 'WPS'],
  ['row', 25],
  ['column', 100],
  ['row', 40],
]) {
  const undo = { key, value: state[key] },
    redo = { key, value }
  state[key] = value
  service.pushUndoRedo({ unitID: 'book', undoMutations: [undo], redoMutations: [redo] })
  const item = service._pitchUndoElement()
  groups.push(item.undoMutations.slice(cursor))
  cursor = item.undoMutations.length
}
const item = service._pitchUndoElement()
item.undoMutations = groups.reverse().flat()
batch.dispose()
assert.equal(service.undo.length, 1)
assert.equal(service._batchingStatus.size, 0)
for (const mutation of item.undoMutations) state[mutation.key] = mutation.value
assert.deepEqual(state, initial)
for (const mutation of item.redoMutations) state[mutation.key] = mutation.value
assert.deepEqual(state, { style: 'WPS', row: 40, column: 100 })
console.log(
  'Shipped GenOffice batching methods verified: one history item, reverse command groups restore overlapping dimensions, redo restores result.',
)
