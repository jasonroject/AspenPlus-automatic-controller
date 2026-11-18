import test from 'node:test';
import assert from 'node:assert/strict';
import { type CadShape, type Point2D, computeBounds2D, resizeShape2D, translateShape2D } from './cadEngine';

function shape(points: Point2D[], holePoints?: Point2D[]): CadShape {
  return {
    id: 'precision', name: 'Precision profile', type: 'polygon', points, holePoints,
    zHeight: 0.25, zOffset: 1.23456789, bevel: 0, color: '#abcdef',
    materialPreset: 'aluminum', visible: true,
  };
}

function circle(cx: number, cy: number, radius: number): Point2D[] {
  return Array.from({ length: 72 }, (_, index) => {
    const angle = index * Math.PI * 2 / 72;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

function close(actual: number, expected: number, tolerance = 1e-14) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
}

test('zero translation preserves precise outline and hole coordinates', () => {
  const original = shape(circle(0.123456789, -0.234567891, 0.0123456789), circle(0.123456789, -0.234567891, 0.004567891));
  const snapshot = structuredClone(original);
  assert.deepEqual(translateShape2D(original, 0, 0), snapshot);
  assert.deepEqual(original, snapshot);
});

test('translating a small circular profile preserves both diameters and every hole radius', () => {
  const cx = 0.123456789;
  const cy = -0.234567891;
  const outerRadius = 0.0123456789;
  const innerRadius = 0.004567891;
  const original = shape(circle(cx, cy, outerRadius), circle(cx, cy, innerRadius));
  const snapshot = structuredClone(original);
  const dx = 0.006789123;
  const dy = -0.009876543;
  const moved = translateShape2D(original, dx, dy);
  for (const [points, radius] of [[moved.points, outerRadius], [moved.holePoints!, innerRadius]] as const) {
    close(computeBounds2D(points).widthX, radius * 2);
    close(computeBounds2D(points).depthY, radius * 2);
    for (const point of points) close(Math.hypot(point.x - (cx + dx), point.y - (cy + dy)), radius);
  }
  assert.equal(moved.zOffset, original.zOffset);
  assert.equal(moved.zHeight, original.zHeight);
  assert.deepEqual(original, snapshot);
});

test('single-axis resizing retains the other axis exactly for the outline and hole', () => {
  const original = shape(circle(1.123456789, -2.234567891, 0.0123456789), circle(1.123456789, -2.234567891, 0.004567891));
  const bounds = computeBounds2D(original.points);
  const width = 0.037654321;
  const resizedX = resizeShape2D(original, width, bounds.depthY);
  close(computeBounds2D(resizedX.points).widthX, width);
  assert.deepEqual(resizedX.points.map((point) => point.y), original.points.map((point) => point.y));
  assert.deepEqual(resizedX.holePoints!.map((point) => point.y), original.holePoints!.map((point) => point.y));
  resizedX.points.forEach((point, index) => close(point.x, bounds.centroid.x + (original.points[index].x - bounds.centroid.x) * width / bounds.widthX));
  const depth = 0.043210987;
  const resizedY = resizeShape2D(original, bounds.widthX, depth);
  close(computeBounds2D(resizedY.points).depthY, depth);
  assert.deepEqual(resizedY.points.map((point) => point.x), original.points.map((point) => point.x));
  assert.deepEqual(resizedY.holePoints!.map((point) => point.x), original.holePoints!.map((point) => point.x));
});

test('sub-millimetre profiles can resize to precise dimensions below two millimetres', () => {
  const original = shape([
    { x: -0.0002, y: -0.0003 }, { x: 0.0002, y: -0.0003 },
    { x: 0.0002, y: 0.0003 }, { x: -0.0002, y: 0.0003 },
  ]);
  const resized = resizeShape2D(original, 0.0123456789, 0.0234567891);
  close(computeBounds2D(resized.points).widthX, 0.0123456789);
  close(computeBounds2D(resized.points).depthY, 0.0234567891);
  assert.equal(resized.zHeight, original.zHeight);
  assert.equal(resized.zOffset, original.zOffset);
  assert.deepEqual(resizeShape2D(original, 0.0004, 0.0006), original);
});

test('invalid editing values leave the original shape unchanged without throwing', () => {
  const original = shape(circle(0, 0, 1));
  for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(resizeShape2D(original, value, 1), original);
    assert.equal(resizeShape2D(original, 1, value), original);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(translateShape2D(original, value, 0), original);
    assert.equal(translateShape2D(original, 0, value), original);
  }
  const line = shape([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
  assert.equal(resizeShape2D(line, 1, 1), line);
  const extreme = shape([{ x: Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 1 }, { x: Number.MAX_VALUE, y: 2 }]);
  assert.equal(translateShape2D(extreme, Number.MAX_VALUE, 0), extreme);
});
