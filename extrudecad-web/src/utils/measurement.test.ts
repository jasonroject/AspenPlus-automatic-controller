import test from 'node:test';
import assert from 'node:assert/strict';
import { measureXY } from './measurement';

test('XY measurement preserves signed deltas and computes a 3-4-5 distance', () => {
  const result = measureXY({ x: 0, y: 0 }, { x: 30, y: 40 });
  assert.deepEqual({ dx: result.dx, dy: result.dy, distance: result.distance }, { dx: 30, dy: 40, distance: 50 });
  assert.ok(Math.abs(result.angleDeg - 53.13010235415598) < 1e-10);
});

test('XY measurement is translation invariant and reversing points reverses direction', () => {
  const result = measureXY({ x: 1000, y: -2000 }, { x: 1030, y: -1960 });
  assert.deepEqual(result, measureXY({ x: 0, y: 0 }, { x: 30, y: 40 }));
  const reverse = measureXY({ x: 30, y: 40 }, { x: 0, y: 0 });
  assert.equal(reverse.dx, -30);
  assert.equal(reverse.dy, -40);
  assert.equal(reverse.distance, 50);
  assert.ok(Math.abs(reverse.angleDeg + 126.86989764584402) < 1e-10);
});

test('coincident points return a finite zero measurement', () => {
  assert.deepEqual(measureXY({ x: 1.5, y: -2.5 }, { x: 1.5, y: -2.5 }), { dx: 0, dy: 0, distance: 0, angleDeg: 0 });
});
