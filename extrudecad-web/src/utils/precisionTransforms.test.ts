import test from 'node:test';
import assert from 'node:assert/strict';
import { CadShape, alignShapes2D, computeBounds2D, computeShapeMetrics, createPointShape, createPrimitiveShape, createSketchLineShape } from './cadEngine';
import { PrecisionTransform, getSelectionPivot, transformSelectedShapes } from './precisionTransforms';

function shapeAt(id: string, x: number, y: number, z: number, hollow = false): CadShape {
  const shape = createPrimitiveShape(hollow ? 'hollow-box' : 'box', 1);
  const move = (point: { x: number; y: number }) => ({ x: point.x + x, y: point.y + y });
  return { ...shape, id, bevel: 0, zOffset: z, points: shape.points.map(move), holePoints: shape.holePoints?.map(move) };
}

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
}

function linkedSketch(): CadShape[] {
  const a = { ...createPointShape({ x: 0, y: 0 }, 'A'), id: 'node-a' };
  const b = { ...createPointShape({ x: 10, y: 0 }, 'B'), id: 'node-b' };
  const c = { ...createPointShape({ x: 10, y: 10 }, 'C'), id: 'node-c' };
  const ab: CadShape = { ...createSketchLineShape(a.points[0], b.points[0], 'AB'), id: 'line-ab', endpointIds: [a.id, b.id] };
  const bc: CadShape = { ...createSketchLineShape(b.points[0], c.points[0], 'BC'), id: 'line-bc', endpointIds: [b.id, c.id] };
  return [a, b, c, ab, bc];
}

test('selection pivot uses combined XYZ bounds and excludes hidden, locked, and missing objects', () => {
  const a = shapeAt('a', -40, 20, 5);
  const b = { ...shapeAt('b', 60, -20, 50), zHeight: 10 };
  const hidden = { ...shapeAt('hidden', 1000, 1000, 1000), visible: false };
  const locked = { ...shapeAt('locked', -1000, -1000, -1000), locked: true };
  assert.deepEqual(getSelectionPivot([a, b, hidden, locked], ['a', 'b', 'hidden', 'locked', 'missing']), { x: 10, y: 0, z: 32.5 });
  assert.deepEqual(getSelectionPivot([a], []), { x: 0, y: 0, z: 0 });
});

test('relative XYZ move preserves group spacing and translates holes without decimal rounding', () => {
  const a = shapeAt('a', 0, 0, 5, true);
  const b = shapeAt('b', 80, -20, 17);
  const source = structuredClone([a, b]);
  const dx = 10.123456;
  const dy = -5.654321;
  const dz = 7.001234;
  const result = transformSelectedShapes([a, b], ['b', 'a'], { kind: 'move', dx, dy, dz });
  assert.equal(result.changed, 2);
  assert.deepEqual(result.selectedIds, ['b', 'a']);
  result.shapes.forEach((shape, index) => {
    shape.points.forEach((point, i) => {
      close(point.x, source[index].points[i].x + dx);
      close(point.y, source[index].points[i].y + dy);
    });
    close(shape.zOffset, source[index].zOffset + dz);
    assert.equal(shape.zHeight, source[index].zHeight);
  });
  close(result.shapes[0].holePoints![0].x, a.holePoints![0].x + dx);
  close(result.shapes[0].holePoints![0].y, a.holePoints![0].y + dy);
  assert.deepEqual([a, b], source, 'Source objects must remain unchanged');
});

test('default rotation uses one group pivot and retains holes, area, and Z placement', () => {
  const a = shapeAt('a', -40, 20, 5, true);
  const b = shapeAt('b', 80, -20, 17);
  const pivot = getSelectionPivot([a, b], ['a', 'b']);
  const result = transformSelectedShapes([a, b], ['a', 'b'], { kind: 'rotate', angleDeg: 90 });
  result.shapes.forEach((shape, index) => {
    const source = [a, b][index];
    const expected = (point: { x: number; y: number }) => ({ x: pivot.x - (point.y - pivot.y), y: pivot.y + (point.x - pivot.x) });
    shape.points.forEach((point, i) => {
      close(point.x, expected(source.points[i]).x);
      close(point.y, expected(source.points[i]).y);
    });
    close(computeShapeMetrics(shape).areaMm2, computeShapeMetrics(source).areaMm2);
    assert.equal(shape.zOffset, source.zOffset);
    assert.equal(shape.zHeight, source.zHeight);
    shape.holePoints?.forEach((point, i) => {
      close(point.x, expected(source.holePoints![i]).x);
      close(point.y, expected(source.holePoints![i]).y);
    });
  });
});

test('rotation honors a non-origin pivot and preserves fractional precision', () => {
  const a = shapeAt('a', 1.123456, 3.654321, 5);
  const pivot = { x: 23.123456, y: -15.654321 };
  const moved = transformSelectedShapes([a], ['a'], { kind: 'rotate', angleDeg: -90, pivot }).shapes[0];
  close(moved.points[0].x, pivot.x + a.points[0].y - pivot.y);
  close(moved.points[0].y, pivot.y - a.points[0].x + pivot.x);
});

test('uniform XYZ scaling doubles the whole group dimensions and multiplies volume by eight', () => {
  const shapes = [shapeAt('a', -40, 20, 5, true), shapeAt('b', 80, -20, 47)];
  const ids = ['a', 'b'];
  const pivot = getSelectionPivot(shapes, ids);
  const result = transformSelectedShapes(shapes, ids, { kind: 'scale', factor: 2 });
  assert.deepEqual(getSelectionPivot(result.shapes, ids), pivot);
  const beforeBounds = computeBounds2D(shapes.flatMap((shape) => shape.points));
  const afterBounds = computeBounds2D(result.shapes.flatMap((shape) => shape.points));
  close(afterBounds.widthX, beforeBounds.widthX * 2);
  close(afterBounds.depthY, beforeBounds.depthY * 2);
  result.shapes.forEach((shape, index) => {
    close(shape.zOffset, pivot.z + (shapes[index].zOffset - pivot.z) * 2);
    close(shape.zHeight, shapes[index].zHeight * 2);
    close(computeShapeMetrics(shape).volumeMm3, computeShapeMetrics(shapes[index]).volumeMm3 * 8);
  });
  close(result.shapes[0].holePoints![0].x, pivot.x + (shapes[0].holePoints![0].x - pivot.x) * 2);
});

test('scaling honors an explicit XYZ pivot and scales stored bevel', () => {
  const a = { ...shapeAt('a', 0, 0, 5, true), bevel: 0.4 };
  const pivot = { x: 25, y: -12, z: 101 };
  const transformed = transformSelectedShapes([a], ['a'], { kind: 'scale', factor: 0.5, pivot }).shapes[0];
  close(transformed.points[0].x, pivot.x + (a.points[0].x - pivot.x) * 0.5);
  close(transformed.points[0].y, pivot.y + (a.points[0].y - pivot.y) * 0.5);
  close(transformed.zOffset, 53);
  close(transformed.zHeight, a.zHeight * 0.5);
  close(transformed.bevel, 0.2);
});

test('copy appends independent unlocked objects, clears boolean lineage, and selects new IDs', () => {
  const a = { ...shapeAt('a', 0, 0, 5), booleanMeta: { op: 'union' as const, targetId: 'old-a', toolId: 'old-b', targetName: 'A', toolName: 'B' } };
  const b = shapeAt('b', 80, -20, 17);
  const result = transformSelectedShapes([a, b], ['b', 'a'], { kind: 'move', dx: 10, dy: 20, dz: 30, copy: true });
  assert.equal(result.changed, 2);
  assert.equal(result.shapes.length, 4);
  assert.equal(result.shapes[0], a);
  assert.equal(result.shapes[1], b);
  const copies = result.shapes.slice(2);
  assert.deepEqual(result.selectedIds, copies.map((shape) => shape.id));
  assert.equal(new Set(result.shapes.map((shape) => shape.id)).size, 4);
  assert.ok(copies.every((shape) => !shape.locked && !shape.booleanMeta));
  close(copies[0].points[0].x, b.points[0].x + 10);
  copies[1].points[0].x = 999;
  assert.notEqual(a.points[0].x, 999);
});

test('locked and hidden objects remain untouched for transforms and copies', () => {
  const a = shapeAt('a', 0, 0, 5);
  const locked = { ...shapeAt('locked', 80, 0, 10), locked: true };
  const hidden = { ...shapeAt('hidden', 0, 80, 20), visible: false };
  const shapes = [a, locked, hidden];
  for (const copy of [false, true]) {
    const result = transformSelectedShapes(shapes, ['a', 'locked', 'hidden', 'a'], { kind: 'scale', factor: 2, copy });
    assert.equal(result.changed, 1);
    assert.equal(result.shapes[1], locked);
    assert.equal(result.shapes[2], hidden);
  }
  assert.equal(transformSelectedShapes(shapes, ['locked', 'hidden'], { kind: 'rotate', angleDeg: 90 }).shapes, shapes);
});

test('repeated and batch copies use the smallest available unique name suffix', () => {
  const a = { ...shapeAt('a', 0, 0, 5), name: '支座' };
  const b = { ...shapeAt('b', 80, 0, 5), name: '支座' };
  const operation: PrecisionTransform = { kind: 'move', dx: 10, dy: 0, dz: 0, copy: true };
  const first = transformSelectedShapes([a, b], ['a'], operation);
  assert.equal(first.shapes[2].name, '支座 (副本)');
  const second = transformSelectedShapes(first.shapes, ['a', 'b'], operation);
  assert.deepEqual(second.shapes.slice(3).map((shape) => shape.name), ['支座 (副本) (2)', '支座 (副本) (3)']);
  const withGap = second.shapes.filter((shape) => shape.name !== '支座 (副本) (2)');
  const third = transformSelectedShapes(withGap, ['a'], operation);
  assert.equal(third.shapes.at(-1)!.name, '支座 (副本) (2)');
  assert.equal(a.name, '支座');
  assert.equal(b.name, '支座');
});

test('empty selection and identity transforms do not create changes; identity copy still copies', () => {
  const shapes = [shapeAt('a', 0, 0, 5)];
  const operations: PrecisionTransform[] = [
    { kind: 'move', dx: 0, dy: 0, dz: 0 },
    { kind: 'rotate', angleDeg: 720 },
    { kind: 'scale', factor: 1 },
  ];
  for (const operation of operations) {
    assert.equal(transformSelectedShapes(shapes, [], operation).shapes, shapes);
    const result = transformSelectedShapes(shapes, ['a'], operation);
    assert.equal(result.shapes, shapes);
    assert.equal(result.changed, 0);
    assert.equal(transformSelectedShapes(shapes, ['a'], { ...operation, copy: true }).changed, 1);
  }
});

test('invalid and overflowed transforms are rejected without mutating input', () => {
  const shapes = [shapeAt('a', 0, 0, 5)];
  const snapshot = structuredClone(shapes);
  const invalid: PrecisionTransform[] = [
    { kind: 'move', dx: NaN, dy: 0, dz: 0 },
    { kind: 'move', dx: 0, dy: Infinity, dz: 0 },
    { kind: 'rotate', angleDeg: Infinity },
    { kind: 'rotate', angleDeg: 30, pivot: { x: NaN, y: 0 } },
    { kind: 'scale', factor: 0 },
    { kind: 'scale', factor: -2 },
    { kind: 'scale', factor: Infinity },
    { kind: 'scale', factor: 2, pivot: { x: 0, y: 0, z: NaN } },
    { kind: 'scale', factor: Number.MAX_VALUE },
  ];
  invalid.forEach((operation) => assert.throws(() => transformSelectedShapes(shapes, ['a'], operation)));
  assert.deepEqual(shapes, snapshot);
});

test('alignment uses the first editable selected ID, independently of scene order', () => {
  const a = shapeAt('a', 0, 0, 5);
  const b = shapeAt('b', 100, 50, 10);
  const locked = { ...shapeAt('locked', -100, -100, 0), locked: true };
  const hidden = { ...shapeAt('hidden', 1000, 1000, 0), visible: false };
  const result = alignShapes2D([a, b, locked, hidden], ['missing', 'locked', 'hidden', 'b', 'a', 'b'], 'left');
  assert.equal(result[1], b, 'B is the reference and must not move');
  close(computeBounds2D(result[0].points).minX, computeBounds2D(b.points).minX);
  assert.equal(result[2], locked);
  assert.equal(result[3], hidden);
});

test('linked line copies include new endpoints, preserve shared nodes, and transform around one pivot', () => {
  const shapes = linkedSketch();
  const snapshot = structuredClone(shapes);
  const ids = ['line-ab', 'line-bc'];
  const result = transformSelectedShapes(shapes, ids, { kind: 'rotate', angleDeg: 90, copy: true });
  const copies = result.shapes.slice(shapes.length);
  assert.equal(copies.length, 5);
  assert.equal(result.changed, 5);
  assert.deepEqual(result.selectedIds, copies.map((shape) => shape.id));
  const lines = copies.filter((shape) => shape.type === 'segment');
  const nodes = copies.filter((shape) => shape.type === 'point');
  assert.equal(lines.length, 2); assert.equal(nodes.length, 3);
  assert.equal(lines[0].endpointIds![1], lines[1].endpointIds![0], 'both lines must share the copied B node');
  const originalIds = new Set(shapes.map((shape) => shape.id));
  assert.ok(copies.every((shape) => !originalIds.has(shape.id)));
  assert.equal(new Set(copies.map((shape) => shape.id)).size, 5);
  const pivot = getSelectionPivot(shapes, ids);
  for (const copy of copies) {
    const original = shapes.find((shape) => `${shape.name} (副本)` === copy.name)!;
    copy.points.forEach((point, index) => {
      close(point.x, pivot.x - (original.points[index].y - pivot.y));
      close(point.y, pivot.y + (original.points[index].x - pivot.x));
    });
    if (copy.type === 'segment') copy.endpointIds!.forEach((id, index) => {
      const node = nodes.find((shape) => shape.id === id)!;
      assert.ok(node, 'copied lines must not reference original nodes');
      assert.deepEqual(copy.points[index], node.points[0]);
    });
  }
  assert.deepEqual(shapes, snapshot);
  const again = transformSelectedShapes(result.shapes, ids, { kind: 'move', dx: 1, dy: 2, dz: 3, copy: true });
  assert.ok(again.shapes.slice(result.shapes.length).every((shape) => shape.name.endsWith('(副本) (2)')));
  const nodeOnly = transformSelectedShapes(shapes, ['node-b'], { kind: 'move', dx: 1, dy: 2, dz: 3, copy: true });
  assert.equal(nodeOnly.shapes.length, shapes.length + 1);
  assert.equal(nodeOnly.shapes.at(-1)!.type, 'point');
});

test('linked moves apply once to selected nodes and lines and propagate to unselected neighbors', () => {
  const shapes = linkedSketch();
  const snapshot = structuredClone(shapes);
  const result = transformSelectedShapes(shapes, ['node-b', 'line-ab'], { kind: 'move', dx: .125, dy: .25, dz: 0 });
  assert.deepEqual(result.shapes[0].points, [{ x: .125, y: .25 }]);
  assert.deepEqual(result.shapes[1].points, [{ x: 10.125, y: .25 }]);
  assert.deepEqual(result.shapes[2].points, shapes[2].points);
  assert.deepEqual(result.shapes[3].points, [result.shapes[0].points[0], result.shapes[1].points[0]]);
  assert.deepEqual(result.shapes[4].points, [result.shapes[1].points[0], result.shapes[2].points[0]]);
  assert.deepEqual(shapes, snapshot);
});

test('linked scaling updates endpoints and adjacent lines while locked or cross-Z changes fail atomically', () => {
  const shapes = linkedSketch();
  const sourceSnapshot = structuredClone(shapes);
  const result = transformSelectedShapes(shapes, ['line-ab'], { kind: 'scale', factor: 2 });
  assert.deepEqual(result.shapes[0].points, [{ x: -5, y: 0 }]);
  assert.deepEqual(result.shapes[1].points, [{ x: 15, y: 0 }]);
  assert.deepEqual(result.shapes[4].points, [{ x: 15, y: 0 }, { x: 10, y: 10 }]);
  const locked = shapes.map((shape) => shape.id === 'line-bc' ? { ...shape, locked: true } : shape);
  const snapshot = structuredClone(locked);
  assert.throws(() => transformSelectedShapes(locked, ['line-ab'], { kind: 'move', dx: 1, dy: 0, dz: 0 }));
  assert.deepEqual(locked, snapshot);
  assert.throws(() => transformSelectedShapes(shapes, ['line-ab'], { kind: 'move', dx: 0, dy: 0, dz: 1 }));
  assert.deepEqual(shapes, sourceSnapshot);
});
