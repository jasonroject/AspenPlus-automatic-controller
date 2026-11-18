import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBooleanShapes,
  computeBounds2D,
  computePolygonArea,
  computePolygonBoolean2D,
  computeSignedPolygonArea,
  type BooleanOperationType,
  type CadShape,
  type Point2D,
} from './cadEngine';

function rect(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

function shape(id: string, points: Point2D[], holePoints?: Point2D[]): CadShape {
  return {
    id, name: id, type: 'polygon', points, holePoints,
    zHeight: 30, zOffset: 0, bevel: 0, color: '#abcdef',
    materialPreset: 'aluminum', visible: true,
  };
}

function area(geometry: { points: Point2D[]; holePoints?: Point2D[] }): number {
  return computePolygonArea(geometry.points) - computePolygonArea(geometry.holePoints ?? []);
}

function sortedPoints(points: Point2D[]): Point2D[] {
  return [...points].sort((a, b) => a.x - b.x || a.y - b.y);
}

test('A minus containing or equal B is empty, with no reversed frame or source mutation', () => {
  const a = shape('A', rect(-5, -5, 5, 5));
  for (const b of [shape('B', rect(-10, -10, 10, 10)), shape('B', [...a.points].reverse())]) {
    const original = structuredClone([a, b]);
    assert.equal(computePolygonBoolean2D(a.points, b.points, 'subtraction'), null);
    const result = computeBooleanShapes(a, b, 'subtraction');
    assert.equal(result.ok, false);
    assert.equal(result.resultShape, null);
    assert.match(result.message, /结果为空/);
    assert.deepEqual([a, b], original);
  }
});

test('equal profiles union and intersect without creating perturbation slivers', () => {
  const a = rect(0.123456789, 0.234567891, 10.123456789, 5.234567891);
  for (const op of ['union', 'intersection'] as const) {
    const result = computePolygonBoolean2D(a, [...a].reverse(), op);
    assert.ok(result);
    assert.deepEqual(sortedPoints(result.points), sortedPoints(a));
    assert.equal(result.holePoints, undefined);
  }
});

test('shared edges preserve input precision and have no positive-area intersection', () => {
  const a = rect(0.123456789, 0.234567891, 10.123456789, 5.234567891);
  const b = rect(10.123456789, 0.234567891, 20.123456789, 5.234567891);
  const union = computePolygonBoolean2D(a, b, 'union');
  assert.ok(union);
  assert.deepEqual(sortedPoints(union.points), sortedPoints(rect(a[0].x, a[0].y, b[2].x, b[2].y)));
  const difference = computePolygonBoolean2D(a, b, 'subtraction');
  assert.ok(difference);
  assert.deepEqual(sortedPoints(difference.points), sortedPoints(a));
  assert.equal(computePolygonBoolean2D(a, b, 'intersection'), null);
});

test('sub-millimetre features survive clipping without rounding or area cutoffs', () => {
  const a = rect(0, 0, 0.00123, 0.00234);
  const b = rect(0.00061, 0, 0.002, 0.00234);
  const result = computePolygonBoolean2D(a, b, 'intersection');
  assert.ok(result);
  const bounds = computeBounds2D(result.points);
  assert.equal(bounds.minX, 0.00061);
  assert.equal(bounds.maxX, 0.00123);
  assert.equal(bounds.maxY, 0.00234);
  assert.ok(Math.abs(area(result) - 0.00062 * 0.00234) < 1e-20);
});

test('the tool hole is material-free in subtraction, intersection and union', () => {
  const a = shape('A', rect(-5, -5, 5, 5));
  const b = shape('B', rect(-10, -10, 10, 10), rect(-2, -2, 2, 2));
  const expected: Record<BooleanOperationType, number> = { subtraction: 16, intersection: 84, union: 400 };
  for (const op of ['subtraction', 'intersection', 'union'] as const) {
    const low = computePolygonBoolean2D(a.points, b.points, op, a.holePoints, b.holePoints);
    assert.ok(low);
    assert.equal(area(low), expected[op]);
    const high = computeBooleanShapes(a, b, op);
    assert.ok(high.ok);
    assert.ok(high.resultShape);
    assert.equal(area(high.resultShape), expected[op]);
  }
});

test('an existing target hole survives intersecting outer-edge cuts and unions', () => {
  const a = shape('A', rect(-10, -10, 10, 10), rect(-7, -2, -3, 2));
  const b = shape('B', rect(5, -15, 15, 15));
  for (const [op, expectedArea] of [['subtraction', 284], ['union', 584]] as const) {
    const result = computeBooleanShapes(a, b, op);
    assert.ok(result.resultShape);
    assert.equal(area(result.resultShape), expectedArea);
    assert.deepEqual(sortedPoints(result.resultShape.holePoints!), sortedPoints(a.holePoints!));
    assert.ok(computeSignedPolygonArea(result.resultShape.points) > 0);
    assert.ok(computeSignedPolygonArea(result.resultShape.holePoints!) < 0);
  }
});

test('union fills only the covered portion of an existing hole', () => {
  const a = shape('A', rect(-10, -10, 10, 10), rect(-4, -4, 4, 4));
  const b = shape('B', rect(0, -6, 12, 6));
  const result = computeBooleanShapes(a, b, 'union');
  assert.ok(result.resultShape);
  assert.equal(area(result.resultShape), 392);
  assert.deepEqual(sortedPoints(result.resultShape.holePoints!), sortedPoints(rect(-4, -4, 0, 4)));
});

test('a second separate hole is rejected as a whole without losing the first hole', () => {
  const a = shape('A', rect(-10, -10, 10, 10), rect(-6, -2, -2, 2));
  const b = shape('B', rect(2, -2, 6, 2));
  const original = structuredClone([a, b]);
  assert.equal(computePolygonBoolean2D(a.points, b.points, 'subtraction', a.holePoints), null);
  const result = computeBooleanShapes(a, b, 'subtraction');
  assert.equal(result.ok, false);
  assert.equal(result.resultShape, null);
  assert.match(result.message, /多个孔/);
  assert.deepEqual([a, b], original);
});

test('a cut splitting A into two bodies is rejected without keeping only the largest', () => {
  const a = shape('A', rect(-10, -10, 10, 10));
  const b = shape('B', rect(1, -15, 3, 15));
  const original = structuredClone([a, b]);
  assert.equal(computePolygonBoolean2D(a.points, b.points, 'subtraction'), null);
  const result = computeBooleanShapes(a, b, 'subtraction');
  assert.equal(result.ok, false);
  assert.equal(result.resultShape, null);
  assert.match(result.message, /多个独立轮廓/);
  assert.deepEqual([a, b], original);
});

test('disjoint operands stay in place: union is unsupported, intersection empty, subtraction unchanged', () => {
  const a = shape('A', rect(-10, -10, 10, 10));
  const b = shape('B', rect(30, 30, 40, 40));
  const original = structuredClone([a, b]);
  const union = computeBooleanShapes(a, b, 'union');
  assert.equal(union.ok, false);
  assert.equal(union.wasAutoAligned, false);
  assert.match(union.message, /多个独立轮廓/);
  const intersection = computeBooleanShapes(a, b, 'intersection');
  assert.equal(intersection.ok, false);
  assert.match(intersection.message, /结果为空/);
  const subtraction = computeBooleanShapes(a, b, 'subtraction');
  assert.ok(subtraction.resultShape);
  assert.equal(subtraction.wasAutoAligned, false);
  assert.deepEqual(sortedPoints(subtraction.resultShape.points), sortedPoints(a.points));
  assert.deepEqual([a, b], original);
});

test('all boolean operations use A height and elevation even when B is at a different Z', () => {
  const a = { ...shape('A', rect(-10, -10, 10, 10)), zHeight: 7, zOffset: -12 };
  const b = { ...shape('B', rect(0, 0, 20, 20)), zHeight: 80, zOffset: 200 };
  const original = structuredClone([a, b]);
  for (const op of ['union', 'intersection', 'subtraction'] as const) {
    const result = computeBooleanShapes(a, b, op);
    assert.ok(result.resultShape);
    assert.equal(result.resultShape.zHeight, 7);
    assert.equal(result.resultShape.zOffset, -12);
  }
  assert.deepEqual([a, b], original);
});

test('invalid coordinates fail clearly without mutating the operands', () => {
  const a = shape('A', rect(-10, -10, 10, 10));
  const b = shape('B', [{ x: NaN, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]);
  const original = structuredClone([a, b]);
  assert.equal(computePolygonBoolean2D(a.points, b.points, 'union'), null);
  const result = computeBooleanShapes(a, b, 'union');
  assert.equal(result.ok, false);
  assert.equal(result.resultShape, null);
  assert.match(result.message, /轮廓无效/);
  assert.deepEqual([a, b], original);
});

test('a hole touching the outer boundary is rejected before creating a non-closed extrusion', () => {
  const a = shape('A', rect(0, 0, 10, 10));
  const b = shape('B', [{ x: 5, y: 0 }, { x: 7, y: 2 }, { x: 5, y: 4 }, { x: 3, y: 2 }]);
  const original = structuredClone([a, b]);
  assert.equal(computePolygonBoolean2D(a.points, b.points, 'subtraction'), null);
  const result = computeBooleanShapes(a, b, 'subtraction');
  assert.equal(result.ok, false);
  assert.equal(result.resultShape, null);
  assert.match(result.message, /无法挤出闭合实体/);
  assert.deepEqual([a, b], original);
});

test('a real 1e-5 mm gap between a hole and the outer ring stays intact', () => {
  const a = shape('A', rect(0, 0, 10, 10));
  const gap = 1e-5;
  const b = shape('B', [{ x: 5, y: gap }, { x: 7, y: 2 }, { x: 5, y: 4 }, { x: 3, y: 2 }]);
  const result = computeBooleanShapes(a, b, 'subtraction');
  assert.ok(result.ok);
  assert.ok(result.resultShape?.holePoints);
  assert.equal(Math.min(...result.resultShape.holePoints.map((p) => p.y)), gap);
  assert.deepEqual(sortedPoints(result.resultShape.points), sortedPoints(a.points));
});

test('legacy empty hole arrays on either operand are treated as no hole', () => {
  const a = shape('A', rect(-10, -10, 10, 10));
  const b = shape('B', rect(0, 0, 20, 20));
  const emptyHoleCases: [Point2D[] | undefined, Point2D[] | undefined][] = [[[], undefined], [undefined, []], [[], []]];
  for (const [holeA, holeB] of emptyHoleCases) {
    const low = computePolygonBoolean2D(a.points, b.points, 'intersection', holeA, holeB);
    assert.ok(low);
    assert.equal(area(low), 100);
    const high = computeBooleanShapes({ ...a, holePoints: holeA }, { ...b, holePoints: holeB }, 'intersection');
    assert.ok(high.resultShape);
    assert.equal(area(high.resultShape), 100);
  }
});

test('nonempty one- or two-vertex holes remain invalid on either operand', () => {
  const a = shape('A', rect(-10, -10, 10, 10));
  const b = shape('B', rect(0, 0, 20, 20));
  for (const hole of [[{ x: 1, y: 1 }], [{ x: 1, y: 1 }, { x: 2, y: 1 }]]) {
    for (const [holeA, holeB] of [[hole, undefined], [undefined, hole]]) {
      const result = computeBooleanShapes({ ...a, holePoints: holeA }, { ...b, holePoints: holeB }, 'intersection');
      assert.equal(result.ok, false);
      assert.match(result.message, /轮廓无效/);
    }
  }
});
