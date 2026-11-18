import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultStarterScene } from './cadEngine';
import { parseProject, serializeProject, saveProjectToLocal, loadProjectFromLocal } from './projectFile';

test('projects round trip including empty workspaces and legacy arrays', () => {
  const scene = createDefaultStarterScene().map((shape) => ({ ...shape, holePoints: undefined, locked: false }));
  assert.deepEqual(parseProject(serializeProject(scene)), scene);
  assert.deepEqual(parseProject(JSON.stringify(scene)), scene);
  assert.deepEqual(parseProject(serializeProject([])), []);
  assert.deepEqual(parseProject('\uFEFF' + serializeProject([])), []);
});

test('corrupt imports fail rather than silently replacing the current workspace with partial data', () => {
  const scene = createDefaultStarterScene();
  assert.throws(() => parseProject(''), /空/);
  assert.throws(() => parseProject('{'), /损坏/);
  assert.throws(() => parseProject(JSON.stringify({ wrong: [] })), /shapes/);
  assert.throws(() => parseProject(JSON.stringify([...scene, { id: 'broken' } ])), /第 5 个图形/);
  assert.throws(() => parseProject(JSON.stringify([scene[0], scene[0]])), /重复/);
  assert.throws(() => parseProject(JSON.stringify({ version: 2, shapes: [] })), /版本/);
});

test('import normalizes unsafe material/color names and rejects non-finite dimensions', () => {
  const shape = { ...createDefaultStarterScene()[0], materialPreset: 'toString', color: 'red" onload="x', zHeight: 1e300, zOffset: 0 };
  const [loaded] = parseProject(JSON.stringify([shape]));
  assert.equal(loaded.materialPreset, 'aluminum');
  assert.equal(loaded.color, '#38bdf8');
  assert.throws(() => parseProject(JSON.stringify([shape]).replace('1e+300', '1e999')), /数据不完整/);
});

test('autosave reports disabled/quota-exceeded storage and safely ignores corrupt recovery data', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored = '';
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      setItem: (_key: string, value: string) => { stored = value; },
      getItem: () => stored,
    } });
    assert.equal(saveProjectToLocal([]), true);
    assert.deepEqual(loadProjectFromLocal(), []);
    stored = '{invalid';
    assert.equal(loadProjectFromLocal(), null);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage disabled'); } });
    assert.equal(saveProjectToLocal([]), false);
    assert.equal(loadProjectFromLocal(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
