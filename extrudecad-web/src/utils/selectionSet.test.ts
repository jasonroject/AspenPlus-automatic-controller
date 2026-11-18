import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionOperation, updateSelection } from './selectionSet';

test('replacing or adding a crossing result deduplicates shared nodes and preserves selection order', () => {
  const original = ['A', 'AB'];
  assert.deepEqual(updateSelection(original, ['B', 'AB', 'B'], 'replace'), ['B', 'AB']);
  assert.deepEqual(updateSelection(original, ['B', 'AB', 'B'], 'add'), ['A', 'AB', 'B']);
  assert.deepEqual(original, ['A', 'AB']);
});
test('Shift removal never adds an unselected hit and removes every matching selected object', () => {
  assert.deepEqual(updateSelection(['A', 'AB', 'B'], ['B', 'T', 'AB'], 'remove'), ['A']);
  assert.deepEqual(updateSelection(['A'], ['T'], 'remove'), ['A']);
});
test('Ctrl single-object toggle remains reversible and empty add/remove preserves existing selections', () => {
  assert.deepEqual(updateSelection(['A', 'B'], ['B', 'T'], 'toggle'), ['A', 'T']);
  for (const operation of ['add', 'remove', 'toggle'] as const) assert.deepEqual(updateSelection(['A'], [], operation), ['A']);
  assert.deepEqual(updateSelection(['A'], [], 'replace'), []);
});

test('live selection modifiers prioritize Shift removal and restore replacement when released', () => {
  assert.equal(selectionOperation({ shiftKey: true, ctrlKey: true, metaKey: false }), 'remove');
  assert.equal(selectionOperation({ shiftKey: false, ctrlKey: true, metaKey: false }), 'add');
  assert.equal(selectionOperation({ shiftKey: false, ctrlKey: false, metaKey: true }), 'add');
  assert.equal(selectionOperation({ shiftKey: false, ctrlKey: false, metaKey: false }), 'replace');
});
