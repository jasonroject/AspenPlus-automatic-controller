import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelZoom, zoomPanAt } from './viewZoom';

test('wheel zoom normalizes pixel, line and page input without large jumps', () => {
  assert.equal(wheelZoom(1, 32, 0, 800, .0001, 1000), wheelZoom(1, 2, 1, 800, .0001, 1000));
  assert.equal(wheelZoom(1, 800, 0, 800, .0001, 1000), wheelZoom(1, 1, 2, 800, .0001, 1000));
  assert.ok(wheelZoom(1, -120, 0, 800, .0001, 1000) > 1);
  assert.ok(wheelZoom(1, 120, 0, 800, .0001, 1000) < 1);
});

test('wheel zoom respects both limits and opposite wheel input restores the scale', () => {
  assert.equal(wheelZoom(1000, -120, 0, 800, .0001, 1000), 1000);
  assert.equal(wheelZoom(.0001, 120, 0, 800, .0001, 1000), .0001);
  const zoomed = wheelZoom(2.8, -120, 0, 800, .00028, 2800);
  assert.ok(Math.abs(wheelZoom(zoomed, 120, 0, 800, .00028, 2800) - 2.8) < 1e-12);
});

test('off-center zoom preserves the exact cursor world coordinate after prior panning', () => {
  const pan = { x: 83.4, y: -51.2 }, cursor = { x: -135.7, y: 92.1 };
  const before = { x: (cursor.x - pan.x) / 2.8, y: (cursor.y - pan.y) / 2.8 };
  for (const ratio of [.2, 1, 1.25, 100]) {
    const after = zoomPanAt(pan, cursor, ratio);
    assert.ok(Math.abs((cursor.x - after.x) / (2.8 * ratio) - before.x) < 1e-10);
    assert.ok(Math.abs((cursor.y - after.y) / (2.8 * ratio) - before.y) < 1e-10);
  }
  assert.deepEqual(pan, { x: 83.4, y: -51.2 });
});
