import test from 'node:test';
import assert from 'node:assert/strict';
import { CadShape, createPointShape, createSketchLineShape } from './cadEngine';
import { GripSession, previewGrip, lineContinuation } from './gripEditing';
import { validateSketchGraph } from './sketchGraph';
import { parseProject, serializeProject } from './projectFile';
import { createHistoryState, pushHistoryState, undoHistoryState } from './historyManager';

function fixture(): GripSession {
  const a = createPointShape({ x: 0, y: 0 }), b = createPointShape({ x: 30, y: 0 }), c = createPointShape({ x: 30, y: 40 });
  const ab: CadShape = { ...createSketchLineShape(a.points[0], b.points[0]), endpointIds: [a.id, b.id] };
  const bc: CadShape = { ...createSketchLineShape(b.points[0], c.points[0]), endpointIds: [b.id, c.id] };
  return { snapshot: [a, b, c, ab, bc], selectedIds: [ab.id], shapeId: ab.id, vertexIndex: 1, base: b.points[0], mode: 'stretch' };
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('hot endpoint stretch previews shared neighbors without mutating the project', () => {
  const grip = fixture(), before = structuredClone(grip.snapshot);
  const next = previewGrip(grip, { x: 40, y: 15 });
  assert.deepEqual(grip.snapshot, before);
  assert.deepEqual(next[1].points[0], { x: 40, y: 15 });
  assert.deepEqual(next[3].points[1], next[4].points[0]);
  assert.deepEqual(next[0], before[0]); assert.deepEqual(next[2], before[2]);
  validateSketchGraph(next);
});
test('move transforms each shared node once when both point and linked lines are selected', () => {
  const grip = fixture(); grip.mode = 'move'; grip.selectedIds = grip.snapshot.map(s => s.id);
  const next = previewGrip(grip, grip.base, '@0,20');
  for (let i = 0; i < 3; i++) assert.deepEqual(next[i].points[0], { x: grip.snapshot[i].points[0].x, y: grip.snapshot[i].points[0].y + 20 });
  validateSketchGraph(next);
});
test('stretch uses only the active endpoint even with multiple selected lines', () => {
  const grip = fixture(); grip.selectedIds.push(grip.snapshot[4].id);
  const next = previewGrip(grip, grip.base, '@10,0');
  assert.deepEqual(next[2], grip.snapshot[2]);
  assert.deepEqual(next[1].points[0], { x: 40, y: 0 });
});
test('midpoint stretch translates its line and move expands to the entire selection', () => {
  const grip = fixture(); grip.vertexIndex = undefined; grip.base = { x: 15, y: 0 }; grip.selectedIds.push(grip.snapshot[4].id);
  const stretch = previewGrip(grip, grip.base, '@0,10');
  assert.deepEqual(stretch[2], grip.snapshot[2]);
  const move = previewGrip({ ...grip, mode: 'move' }, grip.base, '@0,10');
  assert.deepEqual(move[2].points[0], { x: 30, y: 50 });
});
test('rotate, scale and mirror use the fixed grip base and preserve Z', () => {
  const grip = fixture(); grip.snapshot = grip.snapshot.map(s => ({ ...s, zOffset: 12 }));
  const rotate = previewGrip({ ...grip, mode: 'rotate' }, grip.base, '90');
  near(rotate[0].points[0].x, 30); near(rotate[0].points[0].y, -30);
  const scale = previewGrip({ ...grip, mode: 'scale' }, grip.base, '2');
  assert.deepEqual(scale[0].points[0], { x: -30, y: 0 });
  const mirror = previewGrip({ ...grip, mode: 'mirror' }, grip.base, '90');
  near(mirror[0].points[0].x, 60); near(mirror[0].points[0].y, 0);
  for (const next of [rotate, scale, mirror]) { validateSketchGraph(next); assert.ok(next.every(s => s.zOffset === 12)); }
});
test('mouse scale uses the farthest selected point and mouse angle uses +X', () => {
  const grip = fixture();
  const scale = previewGrip({ ...grip, mode: 'scale' }, { x: 90, y: 0 });
  assert.deepEqual(scale[0].points[0], { x: -30, y: 0 });
  const rotate = previewGrip({ ...grip, mode: 'rotate' }, { x: 30, y: 10 });
  near(rotate[0].points[0].y, -30);
});
test('locks, zero-length lines and invalid scale reject the complete preview', () => {
  const grip = fixture();
  assert.throws(() => previewGrip(grip, grip.base, '0,0'), /零长度/);
  assert.throws(() => previewGrip(grip, grip.base, '0.000000000001,0'), /过短/);
  const locked = { ...grip, snapshot: grip.snapshot.map((s, i) => i === 4 ? { ...s, locked: true } : s) };
  assert.throws(() => previewGrip(locked, grip.base, '@1,2'), /锁定/);
  for (const input of ['0', '-1', 'Infinity', '1e100', 'abc']) assert.throws(() => previewGrip({ ...grip, mode: 'scale' }, grip.base, input));
  assert.throws(() => previewGrip({ ...grip, mode: 'move' }, grip.base, '@100000,0'), /范围/);
});
test('one confirmed grip edit is one undo and no-op does not add history', () => {
  const grip = fixture(), history = createHistoryState(grip.snapshot);
  const next = previewGrip(grip, grip.base, '@3,4');
  const committed = pushHistoryState(history, next);
  assert.deepEqual(undoHistoryState(committed).present, grip.snapshot);
  assert.equal(pushHistoryState(history, previewGrip(grip, grip.base)), history);
});
test('LINE continuation reuses the live last endpoint after editing and reload', () => {
  const grip = fixture();
  const next = previewGrip({ ...grip, shapeId: grip.snapshot[4].id, base: { x: 30, y: 40 } }, grip.base, '@10,5');
  const loaded = parseProject(serializeProject(next));
  assert.deepEqual(lineContinuation(loaded), { point: { x: 40, y: 45 }, pointId: loaded[2].id, zOffset: 0 });
});
test('LINE continuation follows surviving lines after undo or deletion', () => {
  const { snapshot } = fixture();
  assert.equal(lineContinuation(snapshot.slice(0, -1)).pointId, snapshot[1].id);
  assert.throws(() => lineContinuation(snapshot.slice(0, 3)), /没有可续画/);
});
test('hidden continuation targets are not silently replaced by older visible lines', () => {
  const { snapshot } = fixture();
  assert.throws(() => lineContinuation(snapshot.map((s, i) => i === 4 ? { ...s, visible: false } : s)), /隐藏/);
  assert.throws(() => lineContinuation(snapshot.map((s, i) => i === 2 ? { ...s, visible: false } : s)), /不可用/);
});
test('legacy independent LINE continues from its exact endpoint and plane', () => {
  const line = { ...createSketchLineShape({ x: 0, y: 0 }, { x: 12.3456, y: 23.4567 }), zOffset: 7 };
  assert.deepEqual(lineContinuation([line]), { point: line.points[1], pointId: undefined, zOffset: 7 });
});

test('full-turn rotation and unit scale preserve exact decimals and redo history', () => {
  const grip = fixture();
  const before = createHistoryState(grip.snapshot);
  const undone = undoHistoryState(pushHistoryState(before, previewGrip(grip, grip.base, '@3,4')));
  for (const [mode, input] of [['rotate', '360'], ['rotate', '-720'], ['scale', '1']] as const) {
    const next = previewGrip({ ...grip, mode }, grip.base, input);
    assert.deepEqual(next, grip.snapshot);
    assert.equal(pushHistoryState(undone, next), undone);
  }
});
