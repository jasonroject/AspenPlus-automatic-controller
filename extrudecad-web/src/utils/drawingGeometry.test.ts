import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineWallPoints, createRegularPolygonPoints, createTrianglePoints, createExtrudedGeometry, computeBounds2D, computePolygonArea, computeShapeDimensions, findGeometrySnap, resizeCircleDiameter2D, resizeLineWall2D, resizeShapeEdge2D, snapToGrid, validateClosedPolygonPoints, type CadShape } from './cadEngine';

const line = (a = { x: 0, y: 0 }, b = { x: 5, y: 0 }): CadShape => ({ id: 'line', name: '直线', type: 'line', points: createLineWallPoints(a, b, 8), zHeight: 10, zOffset: 0, bevel: 0, color: '#888888', materialPreset: 'steel', visible: true });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('short lines retain their specified length and centerline direction', () => {
  const shape = line({ x: 0.123456789, y: 0.234567891 }, { x: 0.623456789, y: 0.234567891 });
  const dims = computeShapeDimensions(shape);
  near(dims.primaryLengthMm!, .5); near(dims.thicknessMm!, 8);
  near(dims.lineStart!.x, .123456789); near(dims.lineStart!.y, .234567891);
  near(dims.lineEnd!.x, .623456789); near(dims.lineEnd!.y, .234567891);
  const resized = computeShapeDimensions(resizeLineWall2D(shape, .3456789));
  near(resized.primaryLengthMm!, .3456789); near(resized.lineStart!.x, .123456789);
});

test('zero-length lines never create an arbitrary default wall', () => {
  assert.deepEqual(createLineWallPoints({ x: 1, y: 2 }, { x: 1, y: 2 }), []);
  assert.deepEqual(createLineWallPoints({ x: 0, y: 0 }, { x: Infinity, y: 2 }), []);
});

test('line endpoint snapping remains on the centerline across zoom tolerances', () => {
  const shape = line({ x: 0, y: 0 }, { x: 40, y: 0 });
  for (const tolerance of [2.5, 7]) {
    assert.deepEqual(findGeometrySnap({ x: 40, y: 0 }, [shape], tolerance), { point: { x: 40, y: 0 }, kind: 'endpoint', shapeName: '直线' });
  }
  assert.equal(findGeometrySnap({ x: 20, y: 0 }, [shape], 2)!.kind, 'midpoint');
  assert.equal(findGeometrySnap({ x: 40, y: 0 }, [{ ...shape, visible: false }], 7), null);
});

test('tiny circles, triangle coordinates and unsnapped points preserve precision', () => {
  const points = createRegularPolygonPoints(0, 0, .003, 72);
  assert.equal(new Set(points.map(p => `${p.x},${p.y}`)).size, 72);
  const circle: CadShape = { ...line(), type: 'circle', points };
  assert.equal(findGeometrySnap({ x: 0, y: 0 }, [circle], 7)!.kind, 'center');
  assert.deepEqual(createTrianglePoints(.1234567, .2345678, .002, .004)[0], { x: .1234567 - .001, y: .2345678 - .002 });
  assert.equal(snapToGrid(.123456789, 2, false), .123456789);
});

test('a precise small circle retains its requested diameter in dimensions and its unbeveled mesh', () => {
  const original: CadShape = { ...line(), type: 'circle', points: createRegularPolygonPoints(.123456789, -.234567891, .003, 72), zHeight: .3456789 };
  near(computeShapeDimensions(original).diameterMm!, .006);
  const diameter = .02123456789;
  const resized = resizeCircleDiameter2D(original, diameter);
  const dimensions = computeShapeDimensions(resized);
  near(dimensions.diameterMm!, diameter);
  near(dimensions.radiusMm!, diameter / 2);
  const bounds = computeBounds2D(resized.points);
  const geometry = createExtrudedGeometry(resized);
  try {
    geometry.computeBoundingBox();
    const meshBounds = geometry.boundingBox!;
    // Three.js stores mesh vertices as Float32; model coordinates remain doubles.
    assert.ok(Math.abs(meshBounds.max.x - meshBounds.min.x - diameter) < 1e-7);
    assert.ok(Math.abs(meshBounds.max.y - meshBounds.min.y - diameter) < 1e-7);
    assert.ok(Math.abs(meshBounds.min.x - bounds.minX) < 1e-7);
    assert.ok(Math.abs(meshBounds.max.z - resized.zHeight) < 1e-7);
    const positions = geometry.getAttribute('position');
    let volume = 0;
    for (let i = 0; i < positions.count; i += 3) {
      const ax = positions.getX(i), ay = positions.getY(i), az = positions.getZ(i);
      const bx = positions.getX(i + 1), by = positions.getY(i + 1), bz = positions.getZ(i + 1);
      const cx = positions.getX(i + 2), cy = positions.getY(i + 2), cz = positions.getZ(i + 2);
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    const expectedVolume = computePolygonArea(resized.points) * resized.zHeight;
    assert.ok(Math.abs(volume - expectedVolume) / expectedVolume < 1e-5);
  } finally {
    geometry.dispose();
  }
});

test('precise edge editing distinguishes short-line length from thickness and preserves polygon coordinates', () => {
  const start = { x: .123456789, y: .234567891 };
  const original = line(start, { x: start.x + .4, y: start.y + .3 });
  for (const edge of [0, 2]) {
    const dimensions = computeShapeDimensions(resizeShapeEdge2D(original, edge, .123456789));
    near(dimensions.primaryLengthMm, .123456789);
    near(dimensions.thicknessMm!, 8);
    near(dimensions.lineStart!.x, start.x);
    near(dimensions.lineStart!.y, start.y);
    near(dimensions.lineEnd!.x, start.x + .123456789 * .8);
    near(dimensions.lineEnd!.y, start.y + .123456789 * .6);
  }
  for (const edge of [1, 3]) {
    const dimensions = computeShapeDimensions(resizeShapeEdge2D(original, edge, .234567891));
    near(dimensions.primaryLengthMm, .5);
    near(dimensions.thicknessMm!, .234567891);
    near(dimensions.lineStart!.x, start.x);
    near(dimensions.lineEnd!.y, start.y + .3);
  }
  const rectangle: CadShape = { ...original, type: 'rect', points: [start,
    { x: start.x + .5, y: start.y }, { x: start.x + .5, y: start.y + .6 }, { x: start.x, y: start.y + .6 }] };
  const target = .34567890123;
  const resized = resizeShapeEdge2D(rectangle, 0, target, { syncOppositeRectEdge: true });
  assert.deepEqual(resized.points[0], start);
  assert.deepEqual(resized.points.map((point) => point.y), rectangle.points.map((point) => point.y));
  near(resized.points[1].x, start.x + target);
  near(resized.points[2].x, start.x + target);
});

test('polygon drafts reject repeated, collinear, backtracking and intersecting outlines', () => {
  assert.equal(validateClosedPolygonPoints([{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}]), null);
  assert.equal(validateClosedPolygonPoints([{x:0,y:0},{x:4,y:0},{x:2,y:1},{x:4,y:3},{x:0,y:3}]), null);
  for (const points of [
    [{x:0,y:0},{x:4,y:0}],
    [{x:0,y:0},{x:4,y:0},{x:0,y:0}],
    [{x:0,y:0},{x:4,y:0},{x:2,y:0},{x:2,y:3}],
    [{x:0,y:0},{x:4,y:3},{x:0,y:3},{x:4,y:0}],
    [{x:0,y:0},{x:2,y:0},{x:4,y:0}],
  ]) assert.ok(validateClosedPolygonPoints(points));
});
