import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPointShape, createSketchLineShape, createPrimitiveShape, createRegularPolygonPoints,
  computeShapeMetrics, computeShapeDimensions, computeSceneMetrics, computeBoxSelectedShapeIds,
  findGeometrySnap, findClosestShapeEdge, computePointSnapGuides, createExtrudedGeometry,
  exportToSVG, exportToDXF, exportShapesToOBJ, exportShapesToSTL, resizeShapeEdge2D, resizeLineWall2D,
} from './cadEngine';
import { parseProject, serializeProject } from './projectFile';
import { parseDxf } from './dxfImport';
import { transformSelectedShapes } from './precisionTransforms';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const dxf = (entities: (string | number)[][], unit = 4, marker = false) => [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, unit,
  ...(marker ? [999, 'EXTRUDECAD_PROFILE_V1'] : []), 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES',
  ...entities.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n');
const pointEntity = (extra: (string | number)[] = []) => [0, 'POINT', 8, 'nodes', 10, .125, 20, -.25, 30, 3, ...extra];
const lineEntity = (extra: (string | number)[] = []) => [0, 'LINE', 8, 'edges', 10, .125, 20, -.25, 30, 3, 11, 4.125, 21, 2.75, 31, 3, ...extra];

test('point and sketch line constructors preserve independent coordinates without extrusion', () => {
  const start = { x: .123456789, y: -.234567891 }, end = { x: .623456789, y: -.234567891 };
  const point = createPointShape(start, 'A');
  const line = createSketchLineShape(start, end, 'AB');
  assert.equal(point.type, 'point'); assert.deepEqual(point.points, [start]);
  assert.equal(line.type, 'segment'); assert.deepEqual(line.points, [start, end]);
  assert.ok([point, line].every((shape) => shape.zHeight === 0 && shape.bevel === 0 && shape.visible && !shape.locked));
  assert.notEqual(point.id, line.id);
  start.x = 999;
  assert.equal(point.points[0].x, .123456789); assert.equal(line.points[0].x, .123456789);
  assert.throws(() => createPointShape({ x: Infinity, y: 0 }), /有限/);
  assert.throws(() => createSketchLineShape(end, end), /不同/);
});

test('reference points and lines have zero solid metrics and never produce mesh exports', () => {
  const point = { ...createPointShape({ x: 10, y: -3 }), zOffset: 7 };
  const line = { ...createSketchLineShape({ x: 10, y: -3 }, { x: 14, y: 0 }), zOffset: 7 };
  for (const shape of [point, line]) {
    const metrics = computeShapeMetrics(shape);
    assert.equal(metrics.areaMm2, 0); assert.equal(metrics.volumeMm3, 0); assert.equal(metrics.weightGrams, 0);
    assert.equal(metrics.heightZ, 0); assert.equal(metrics.minZ, 7); assert.equal(metrics.maxZ, 7);
    const geometry = createExtrudedGeometry(shape);
    try { assert.equal(geometry.getAttribute('position').count, 0); } finally { geometry.dispose(); }
  }
  const dimensions = computeShapeDimensions(line);
  assert.equal(dimensions.primaryLengthMm, 5); assert.equal(dimensions.edges.length, 1);
  assert.deepEqual(dimensions.lineStart, line.points[0]); assert.deepEqual(dimensions.lineEnd, line.points[1]);
  const scene = computeSceneMetrics([point, line]);
  assert.equal(scene.visibleCount, 2); assert.equal(scene.totalVertices2D, 3);
  assert.deepEqual(scene.bounds, { widthX: 4, depthY: 3, heightZ: 0 });
  const solid = createPrimitiveShape('box');
  assert.equal(exportShapesToOBJ([point, solid, line]), exportShapesToOBJ([solid]));
  assert.equal(exportShapesToSTL([point, solid, line]), exportShapesToSTL([solid]));
  assert.doesNotMatch(exportShapesToOBJ([point, line]), /^v |^f /m);
  assert.doesNotMatch(exportShapesToSTL([point, line]), /facet normal/);
  const svg = exportToSVG([point, line]);
  assert.match(svg, /data-shape-type="point"/); assert.match(svg, /<circle cx="10" cy="3"/);
  assert.match(svg, /data-shape-type="segment"/); assert.match(svg, /<line x1="10" y1="3" x2="14" y2="0"/);
});

test('explicit points take snap priority and line endpoints, midpoint, and hit testing remain distinct', () => {
  const point = { ...createPointShape({ x: .123456789, y: .234567891 }, 'node'), locked: true };
  const line = createSketchLineShape({ x: 0, y: 0 }, { x: 20, y: 0 }, 'edge');
  const hit = findGeometrySnap({ x: 0, y: 0 }, [line, point], 1)!;
  assert.equal(hit.shapeName, 'node'); assert.deepEqual(hit.point, point.points[0]);
  assert.deepEqual(findGeometrySnap({ x: 0, y: 0 }, [line, { ...point, visible: false }], 1)!.point, line.points[0]);
  assert.equal(findGeometrySnap({ x: 10, y: 0 }, [line], 1)!.kind, 'midpoint');
  assert.equal(findClosestShapeEdge({ x: 10, y: .1 }, [point, line], .2)!.shapeId, line.id);
  assert.equal(computePointSnapGuides({ x: point.points[0].x + .001, y: 5 }, null, [point], .01).snappedPt.x, point.points[0].x);
  const circle = { ...createPrimitiveShape('cylinder'), points: createRegularPolygonPoints(.123456789, .234567891, .75, 32) };
  const center = findGeometrySnap({ x: .123456789, y: .234567891 }, [circle], .1)!;
  close(center.point.x, .123456789); close(center.point.y, .234567891);
});

test('point marquee selection uses containment and sketch line crossing uses the actual segment', () => {
  const point = createPointShape({ x: 1, y: 1 });
  const outside = createPointShape({ x: 5, y: 5 });
  const crossing = createSketchLineShape({ x: -5, y: 0 }, { x: 5, y: 0 });
  const shapes = [point, outside, crossing, { ...point, id: 'hidden', visible: false }];
  assert.deepEqual(computeBoxSelectedShapeIds({ x: -1, y: -1 }, { x: 1, y: 1 }, shapes).selectedIds, [point.id]);
  assert.deepEqual(computeBoxSelectedShapeIds({ x: 1, y: 1 }, { x: -1, y: -1 }, shapes).selectedIds, [point.id, crossing.id]);
});

test('project save and recovery retain points, sketch lines, and legacy solid walls together', () => {
  const point = { ...createPointShape({ x: .123456789, y: -.234567891 }, 'A <定位点>'), zOffset: -4.125, locked: true };
  const segment = { ...createSketchLineShape({ x: 1, y: 2 }, { x: 3, y: 4 }), zOffset: 8.25 };
  const shapes = [point, segment, { ...createPrimitiveShape('line'), locked: false }];
  const loaded = parseProject(serializeProject(shapes));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), JSON.parse(JSON.stringify(shapes)));
  assert.equal(parseProject(JSON.stringify(shapes))[2].type, 'line');
  for (const invalid of [{ ...point, points: [] }, { ...point, points: segment.points }, { ...point, zHeight: 1 },
    { ...point, bevel: .1 }, { ...segment, points: [segment.points[0], segment.points[0]] }, { ...segment, holePoints: shapes[2].points }]) {
    assert.throws(() => parseProject(JSON.stringify([invalid])), /数据不完整/);
  }
});

test('DXF exports real POINT and LINE entities and round-trips their XY/Z with closed holed profiles', () => {
  const point = { ...createPointShape({ x: .123456789, y: -.234567891 }), zOffset: -4.125 };
  const segment = { ...createSketchLineShape({ x: 1, y: 2 }, { x: 3, y: 4 }), zOffset: 8.25 };
  const ring = createPrimitiveShape('hollow-box');
  const text = exportToDXF([point, segment, ring]);
  assert.match(text, /0\nPOINT\n100\nAcDbEntity/); assert.match(text, /0\nLINE\n100\nAcDbEntity/);
  assert.match(text, /100\nAcDbPoint/); assert.match(text, /100\nAcDbLine/);
  const result = parseDxf(text, { units: 'auto', defaultHeightMm: 30 });
  assert.equal(result.shapes.length, 3); assert.deepEqual(result.skippedEntities, {});
  for (const original of [point, segment]) {
    const restored = result.shapes.find((shape) => shape.type === original.type)!;
    assert.deepEqual(restored.points, original.points); assert.equal(restored.zOffset, original.zOffset); assert.equal(restored.zHeight, 0);
  }
  assert.ok(result.shapes.some((shape) => shape.holePoints?.length));
  const onlyReferences = parseDxf(exportToDXF([point, segment]), { units: 'auto', defaultHeightMm: 0 });
  assert.equal(onlyReferences.shapes.length, 2); assert.deepEqual(onlyReferences.warnings, []);
});

test('DXF point and coplanar line WCS coordinates scale while unsupported thickness, skew Z, and hidden entities are reported', () => {
  const result = parseDxf(dxf([pointEntity([210, 1, 220, 0, 230, 0]), lineEntity()], 5), { units: 'auto', defaultHeightMm: 0 });
  assert.equal(result.shapes.length, 2);
  assert.deepEqual(result.shapes[0].points, [{ x: 1.25, y: -2.5 }]); assert.equal(result.shapes[0].zOffset, 30);
  assert.deepEqual(result.shapes[1].points[1], { x: 41.25, y: 27.5 });
  const skipped = parseDxf(dxf([pointEntity([39, 2]), pointEntity([60, 1]), [0, 'POINT', 10, 1],
    [0, 'LINE', 10, 0, 20, 0, 30, 1, 11, 1, 21, 1, 31, 2], lineEntity([39, 1])]), { units: 'auto', defaultHeightMm: 0 });
  assert.deepEqual(skipped.skippedEntities, { POINT: 3, LINE: 2 }); assert.equal(skipped.shapes.length, 0);
  assert.ok(skipped.warnings.some((warning) => warning.includes('同标高')));
  const badGroup = parseDxf(dxf([[0, 'POINT', 8, 'EC_PROFILE_1', 10, 1, 20, 2]], 4, true), { units: 'auto', defaultHeightMm: 0 });
  assert.equal(badGroup.shapes.length, 0); assert.equal(badGroup.skippedEntities.POINT, 1);
});

test('point and segment precision moves and copies keep zero thickness, and segment length editing keeps its anchor', () => {
  const point = createPointShape({ x: 1, y: 2 });
  const line = createSketchLineShape({ x: 1, y: 2 }, { x: 5, y: 5 });
  const source = structuredClone([point, line]);
  const moved = transformSelectedShapes([point, line], [point.id, line.id], { kind: 'move', dx: .123456789, dy: -.234567891, dz: 7, copy: true });
  assert.equal(moved.changed, 2); assert.equal(moved.shapes.length, 4);
  assert.deepEqual([point, line], source);
  for (const copy of moved.shapes.slice(2)) {
    assert.equal(copy.zHeight, 0); assert.equal(copy.bevel, 0); assert.equal(copy.zOffset, 7);
    close(copy.points[0].x, 1.123456789); close(copy.points[0].y, 1.765432109);
  }
  const resized = resizeShapeEdge2D(line, 0, .123456789);
  assert.equal(resized.type, 'segment'); assert.equal(resized.points.length, 2); assert.equal(resized.zHeight, 0);
  assert.deepEqual(resized.points[0], line.points[0]); close(computeShapeDimensions(resized).primaryLengthMm, .123456789);
  assert.equal(resizeLineWall2D(line, 5, 8), line, 'A wall-only editor must not convert a reference line into a malformed four-point segment');
});
