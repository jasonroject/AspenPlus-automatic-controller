import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBounds2D, computeShapeMetrics } from './cadEngine';
import { createPrecisionPrimitive, PrecisionPrimitiveSpec } from './precisionPrimitives';

const box: PrecisionPrimitiveSpec = { kind: 'box', centerX: 123.45, centerY: -74.25, zOffset: -6, width: 100, depth: 50, diameter: 40, zHeight: 12 };

test('dimensioned box preserves exact center, size, elevation and volume', () => {
  const shape = createPrecisionPrimitive(box);
  const bounds = computeBounds2D(shape.points);
  assert.ok(Math.abs(bounds.widthX - 100) < 1e-10);
  assert.ok(Math.abs(bounds.depthY - 50) < 1e-10);
  assert.ok(Math.abs(bounds.centroid.x - box.centerX) < 1e-10);
  assert.ok(Math.abs(bounds.centroid.y - box.centerY) < 1e-10);
  assert.equal(shape.zOffset, -6);
  assert.equal(shape.zHeight, 12);
  assert.equal(shape.bevel, 0);
  assert.ok(Math.abs(computeShapeMetrics(shape).volumeMm3 - 60000) < 1e-7);
});

test('dimensioned cylinder has 72 distinct points on the requested radius', () => {
  const spec = { ...box, kind: 'cylinder' as const, diameter: 1.234 };
  const shape = createPrecisionPrimitive(spec);
  assert.equal(shape.points.length, 72);
  assert.equal(new Set(shape.points.map((p) => `${p.x},${p.y}`)).size, 72);
  for (const point of shape.points) assert.ok(Math.abs(Math.hypot(point.x - spec.centerX, point.y - spec.centerY) - 0.617) < 1e-10);
  assert.ok(Math.abs(computeBounds2D(shape.points).widthX - spec.diameter) < 1e-10);
  assert.notEqual(createPrecisionPrimitive(spec).id, shape.id);
});

test('invalid dimensions and non-finite positions cannot create geometry', () => {
  for (const patch of [{ width: 0 }, { depth: -1 }, { zHeight: NaN }, { centerX: Infinity }, { zOffset: NaN }, { zHeight: Infinity }]) {
    assert.throws(() => createPrecisionPrimitive({ ...box, ...patch }));
  }
  assert.throws(() => createPrecisionPrimitive({ ...box, kind: 'cylinder', diameter: 0 }));
  assert.throws(() => createPrecisionPrimitive({ ...box, zOffset: Number.MAX_VALUE, zHeight: Number.MAX_VALUE }));
});
