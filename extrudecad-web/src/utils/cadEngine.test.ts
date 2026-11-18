import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapToGrid,
  computePolygonArea,
  computePolygonPerimeter,
  computeShapeMetrics,
  computeSceneMetrics,
  createPrimitiveShape,
  createDefaultStarterScene,
  resizeShape2D,
  translateShape2D,
  exportToSVG,
  exportToDXF,
  exportShapesToOBJ,
  exportShapesToSTL,
  mirrorShape2D,
  rotateShape2D,
  createRectArrayCopies,
  createPolarArrayCopies,
  computeBounds2D,
  CadShape,
} from './cadEngine';

type Vertex = [number, number, number];

function signedTriangleVolume(a: Vertex, b: Vertex, c: Vertex): number {
  return (a[0] * (b[1] * c[2] - b[2] * c[1]) +
    a[1] * (b[2] * c[0] - b[0] * c[2]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
}

test('STL and OBJ preserve through-holes, closed walls, winding, and Z elevation', () => {
  const shape = { ...createPrimitiveShape('hollow-box', 1), bevel: 0, zOffset: 12 };
  const expectedVolume = (56 * 56 - 34 * 34) * 28;
  const stl = exportShapesToSTL([shape]);
  const vertices = [...stl.matchAll(/vertex ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g)]
    .map((match) => match.slice(1).map(Number) as Vertex);
  let volume = 0;
  const edges = new Map<string, number>();
  for (let i = 0; i < vertices.length; i += 3) {
    volume += signedTriangleVolume(vertices[i], vertices[i + 1], vertices[i + 2]);
    for (let j = 0; j < 3; j++) {
      const edge = [vertices[i + j].join(','), vertices[i + (j + 1) % 3].join(',')].sort().join('|');
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  assert.ok(Math.abs(volume - expectedVolume) < 1e-6);
  assert.ok([...edges.values()].every((count) => count === 2), 'Every mesh edge has two adjacent triangles');
  assert.equal(Math.min(...vertices.map((vertex) => vertex[2])), 12);
  assert.equal(Math.max(...vertices.map((vertex) => vertex[2])), 40);

  const obj = exportShapesToOBJ([shape]);
  const objVertices = obj.split('\n').filter((line) => line.startsWith('v '))
    .map((line) => line.slice(2).split(' ').map(Number) as Vertex);
  const faces = obj.split('\n').filter((line) => line.startsWith('f '))
    .map((line) => line.slice(2).split(' ').map((value) => Number(value) - 1));
  const objVolume = faces.reduce((sum, [a, b, c]) => sum + signedTriangleVolume(objVertices[a], objVertices[b], objVertices[c]), 0);
  assert.ok(Math.abs(objVolume - expectedVolume) < 1e-6);
});

test('SVG export fits translated and widely separated objects without clipping', () => {
  const shape = translateShape2D(createPrimitiveShape('box', 1), 1500, -800);
  const svg = exportToSVG([shape]);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
  for (const point of shape.points) {
    assert.ok(point.x >= viewBox[0] && point.x <= viewBox[0] + viewBox[2]);
    assert.ok(-point.y >= viewBox[1] && -point.y <= viewBox[1] + viewBox[3]);
  }
});

test('snapToGrid snaps coordinates accurately when enabled', () => {
  assert.equal(snapToGrid(12.3, 5, true), 10);
  assert.equal(snapToGrid(13.1, 5, true), 15);
  assert.equal(snapToGrid(12.34, 5, false), 12.34);
});

test('computePolygonArea and computePolygonPerimeter calculate exact rectangle values', () => {
  const rect = [
    { x: -20, y: -15 },
    { x: 20, y: -15 },
    { x: 20, y: 15 },
    { x: -20, y: 15 },
  ];
  assert.equal(computePolygonArea(rect), 1200); // 40 * 30
  assert.equal(computePolygonPerimeter(rect), 140); // 2 * (40 + 30)
});

test('computeShapeMetrics accounts for Z-axis height, hole cutouts, and material density', () => {
  const box = createPrimitiveShape('box', 1); // 40x40x30 aluminum
  const metrics = computeShapeMetrics(box);
  assert.equal(metrics.widthX, 40);
  assert.equal(metrics.depthY, 40);
  assert.equal(metrics.heightZ, 30);
  assert.equal(metrics.areaMm2, 1600);
  assert.equal(metrics.volumeMm3, 48000);
  assert.equal(metrics.volumeCm3, 48);
  assert.equal(metrics.weightGrams, 129.6); // 48 cm^3 * 2.7 g/cm^3

  const hollow = createPrimitiveShape('hollow-box', 1); // 56x56 outer, 34x34 hole, z=28
  const hollowMetrics = computeShapeMetrics(hollow);
  assert.equal(hollowMetrics.areaMm2, 56 * 56 - 34 * 34); // 3136 - 1156 = 1980
  assert.equal(hollowMetrics.volumeMm3, 1980 * 28);
});

test('resizeShape2D and translateShape2D update XY coordinates cleanly', () => {
  const box = createPrimitiveShape('box', 1);
  const resized = resizeShape2D(box, 80, 50);
  const m1 = computeShapeMetrics(resized);
  assert.equal(m1.widthX, 80);
  assert.equal(m1.depthY, 50);

  const moved = translateShape2D(resized, 15, -10);
  const m2 = computeShapeMetrics(moved);
  assert.equal(m2.centroid.x, 15);
  assert.equal(m2.centroid.y, -10);
});

test('starter scene and exporters generate valid SVG, DXF, OBJ, and STL outputs', () => {
  const scene = createDefaultStarterScene();
  assert.equal(scene.length, 4);

  const sceneMetrics = computeSceneMetrics(scene);
  assert.equal(sceneMetrics.visibleCount, 4);
  assert.ok(sceneMetrics.totalVolumeCm3 > 50);

  const svg = exportToSVG(scene);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('starter-base-plate'));

  const dxf = exportToDXF(scene);
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.includes('\nLWPOLYLINE\n'));
  assert.ok(dxf.includes('$INSUNITS\n70\n4'));

  const obj = exportShapesToOBJ(scene);
  assert.ok(obj.includes('o starter-base-plate'));
  assert.ok(obj.includes('\nv '));
  assert.ok(obj.includes('\nf '));

  const stl = exportShapesToSTL(scene);
  assert.ok(stl.startsWith('solid ExtrudeCAD_Model'));
  assert.ok(stl.includes('facet normal'));
  assert.ok(stl.endsWith('endsolid ExtrudeCAD_Model'));
});

import {
  createHistoryState,
  pushHistoryState,
  undoHistoryState,
  redoHistoryState,
  canUndo,
  canRedo,
} from './historyManager';

test('historyManager stores stack of shapes arrays and performs undo/redo accurately', () => {
  const initialShapes = createDefaultStarterScene();
  let history = createHistoryState(initialShapes);
  const origFirstZ = initialShapes[0].zHeight;

  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);
  assert.equal(history.present.length, 4);

  // Add a triangle primitive
  const addedTri = [...history.present, createPrimitiveShape('triangle', 5)];
  history = pushHistoryState(history, addedTri);
  assert.equal(canUndo(history), true);
  assert.equal(canRedo(history), false);
  assert.equal(history.present.length, 5);
  assert.equal(history.past.length, 1);

  // Modify Z height of first shape
  const modifiedZ = history.present.map((s, idx) =>
    idx === 0 ? { ...s, zHeight: 88 } : s,
  );
  history = pushHistoryState(history, modifiedZ);
  assert.equal(history.past.length, 2);
  assert.equal(history.present[0].zHeight, 88);

  // Undo once -> reverts Z height back to origFirstZ, keeps 5 shapes
  history = undoHistoryState(history);
  assert.equal(history.present.length, 5);
  assert.equal(history.present[0].zHeight, origFirstZ);
  assert.equal(canUndo(history), true);
  assert.equal(canRedo(history), true);

  // Undo again -> reverts back to initial 4 shapes
  history = undoHistoryState(history);
  assert.equal(history.present.length, 4);
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), true);

  // Redo once -> restores 5 shapes
  history = redoHistoryState(history);
  assert.equal(history.present.length, 5);
  assert.equal(canUndo(history), true);
  assert.equal(canRedo(history), true);

  // Redo again -> restores Z height 88
  history = redoHistoryState(history);
  assert.equal(history.present[0].zHeight, 88);
  assert.equal(canRedo(history), false);
});

import {
  computeShapeDimensions,
  pointToSegmentDistance,
  findClosestShapeEdge,
} from './cadEngine';

test('computeShapeDimensions calculates CAD edge lengths, line lengths, circle diameter, and area', () => {
  const scene = createDefaultStarterScene();
  // 1. Box: 36 x 32 at (-32, 26)
  const boxDim = computeShapeDimensions(scene[0]);
  assert.equal(boxDim.isLineFeature, false);
  assert.equal(boxDim.areaMm2, 36 * 32); // 1152 mm^2
  assert.equal(boxDim.perimeterMm, 2 * (36 + 32)); // 136 mm
  assert.equal(boxDim.edges.length, 4);
  assert.equal(boxDim.edges[0].lengthMm, 36);
  assert.equal(boxDim.edges[1].lengthMm, 32);

  // 2. Triangle: base 38, height 34
  const triDim = computeShapeDimensions(scene[1]);
  assert.equal(triDim.areaMm2, (38 * 34) / 2); // 646 mm^2
  assert.equal(triDim.edges.length, 3);
  assert.equal(triDim.edges[0].lengthMm, 38);

  // 3. Circle: radius 18 -> diameter ~36
  const circleDim = computeShapeDimensions(scene[2]);
  assert.equal(circleDim.radiusMm, 18);
  assert.equal(circleDim.diameterMm, 36);
  assert.ok(circleDim.areaMm2 > 1000 && circleDim.areaMm2 < 1020);

  // 4. Line Wall: from (12, -36) to (50, -14), thickness 8
  // dx = 38, dy = 22 -> hypot(38, 22) = sqrt(1444 + 484) = sqrt(1928) ≈ 43.9 mm
  const lineDim = computeShapeDimensions(scene[3]);
  assert.equal(lineDim.isLineFeature, true);
  assert.ok(Math.abs(lineDim.primaryLengthMm! - Math.hypot(38, 22)) < 1e-12);
  assert.ok(Math.abs(lineDim.thicknessMm! - 8) < 1e-12);
  assert.ok(lineDim.areaMm2 > 350 && lineDim.areaMm2 < 353);

  // Point-to-segment & closest edge hit test on box bottom edge (-50, 10) to (-14, 10)
  assert.equal(pointToSegmentDistance({ x: -32, y: 11.5 }, { x: -50, y: 10 }, { x: -14, y: 10 }), 1.5);
  const hit = findClosestShapeEdge({ x: -32, y: 11 }, scene, 4);
  assert.ok(hit !== null);
  assert.equal(hit.shapeId, 'starter-base-plate');
  assert.equal(hit.edgeIndex, 0);
  assert.equal(hit.edge.lengthMm, 36);
});

import {
  computeMoveSnapGuides,
  computePointSnapGuides,
  createRectanglePoints,
} from './cadEngine';

test('computeMoveSnapGuides and computePointSnapGuides snap to aligned object edges/centers and return guides', () => {
  const scene = createDefaultStarterScene();
  // scene[0] ('starter-base-plate') is centered at (-32, 26), width 36 (minX=-50, maxX=-14), depth 32 (minY=10, maxY=42)
  // scene[2] ('starter-cylinder') is centered at (-32, -26), radius 18 (minX=-50, maxX=-14)
  // Suppose we drag scene[0] slightly off-center to (-30.8, 25.2):
  const candidatePts = createRectanglePoints(-30.8, 25.2, 36, 32);
  const moveSnap = computeMoveSnapGuides(candidatePts, 'starter-base-plate', scene, 2.5, true);

  // Should snap X back by -1.2mm to align with starter-cylinder at X=-32 (or minX=-50)
  assert.ok(Math.abs(moveSnap.snappedDelta.x + 1.2) < 1e-12);
  assert.ok(moveSnap.guides.some((g) => g.axis === 'x'));

  // Test vertex resize point snapping against other shapes and same-shape vertices
  // Dragging vertex 0 of starter-base-plate near X = -14.8 (close to vertex 1's X = -14) and Y = 9.4 (close to starter-triangle minY = 9)
  const ptSnap = computePointSnapGuides(
    { x: -14.8, y: 9.4 },
    'starter-base-plate',
    scene,
    2.5,
    true,
    0,
  );
  assert.equal(ptSnap.snappedPt.x, -14);
  assert.equal(ptSnap.snappedPt.y, 9);
  assert.equal(ptSnap.guides.length, 2);
});

import {
  computeBoxSelectedShapeIds,
  translateMultipleShapes2D,
} from './cadEngine';

test('computeBoxSelectedShapeIds distinguishes CAD Window (L->R) vs Crossing (R->L) selection', () => {
  const scene = createDefaultStarterScene();
  // starter-base-plate bounds: minX=-50, maxX=-14, minY=10, maxY=42
  // starter-triangle bounds: minX=13, maxX=51, minY=9, maxY=43

  // 1. Window mode (Left-to-Right: start.x < end.x) that fully encloses starter-base-plate
  //    but only partially overlaps starter-triangle (up to x=25)
  const winSel = computeBoxSelectedShapeIds({ x: -60, y: 0 }, { x: 25, y: 50 }, scene);
  assert.equal(winSel.mode, 'window');
  assert.deepEqual(winSel.selectedIds, ['starter-base-plate']);

  // 2. Crossing mode (Right-to-Left: start.x > end.x) with the exact same box bounds
  //    selects BOTH starter-base-plate AND starter-triangle (because it crosses starter-triangle!)
  const crossSel = computeBoxSelectedShapeIds({ x: 25, y: 50 }, { x: -60, y: 0 }, scene);
  assert.equal(crossSel.mode, 'crossing');
  assert.deepEqual(crossSel.selectedIds, ['starter-base-plate', 'starter-triangle']);

  // 3. Batch translate both selected shapes by (+10, -5)
  const movedScene = translateMultipleShapes2D(scene, crossSel.selectedIds, 10, -5);
  assert.equal(computeShapeMetrics(movedScene[0]).centroid.x, -22);
  assert.equal(computeShapeMetrics(movedScene[0]).centroid.y, 21);
});

import {
  computePolygonBoolean2D,
  computeBooleanShapes,
  resizeShapeEdge2D,
  resizeLineWall2D,
  resizeCircleDiameter2D,
} from './cadEngine';

test('computePolygonBoolean2D and computeBooleanShapes accurately compute Union, Intersection, and Subtraction', () => {
  // 1. Two 40x40 squares overlapping in a 20x20 corner:
  // PolyA: centered at (0,0), 40x40 -> [-20, 20] x [-20, 20] (area = 1600)
  // PolyB: centered at (20,20), 40x40 -> [0, 40] x [0, 40] (area = 1600)
  // Overlap region: [0, 20] x [0, 20] (area = 400)
  const polyA = createRectanglePoints(0, 0, 40, 40);
  const polyB = createRectanglePoints(20, 20, 40, 40);

  // Union: 1600 + 1600 - 400 = 2800 mm^2 (8 vertices L/step shape)
  const unionGeom = computePolygonBoolean2D(polyA, polyB, 'union');
  assert.ok(unionGeom !== null);
  assert.equal(Math.round(computePolygonArea(unionGeom.points)), 2800);
  assert.equal(unionGeom.points.length, 8);

  // Intersection: 20x20 = 400 mm^2 (4 vertices square)
  const interGeom = computePolygonBoolean2D(polyA, polyB, 'intersection');
  assert.ok(interGeom !== null);
  assert.equal(Math.round(computePolygonArea(interGeom.points)), 400);
  assert.equal(interGeom.points.length, 4);

  // Subtraction (A - B): 1600 - 400 = 1200 mm^2 (6 vertices L-shape)
  const subGeom = computePolygonBoolean2D(polyA, polyB, 'subtraction');
  assert.ok(subGeom !== null);
  assert.equal(Math.round(computePolygonArea(subGeom.points)), 1200);
  assert.equal(subGeom.points.length, 6);

  // 2. Interior containment subtraction (60x60 outer plate minus 20x20 inner hole)
  const outerPlate = createRectanglePoints(0, 0, 60, 60); // area = 3600
  const innerCut = createRectanglePoints(0, 0, 20, 20); // area = 400
  const holeSub = computePolygonBoolean2D(outerPlate, innerCut, 'subtraction');
  assert.ok(holeSub !== null);
  assert.ok(holeSub.holePoints !== undefined);
  assert.equal(holeSub.holePoints.length, 4);

  // 3. High-level computeBooleanShapes with autoAlignDisjoint on starter scene shapes
  const scene = createDefaultStarterScene();
  const resUnion = computeBooleanShapes(scene[0], scene[1], 'union', {
    autoAlignDisjoint: true,
  });
  assert.equal(resUnion.ok, true);
  assert.equal(resUnion.wasAutoAligned, true);
  assert.ok(resUnion.resultShape !== null);
  assert.ok(computeShapeMetrics(resUnion.resultShape).areaMm2 > 1152);

  const resSub = computeBooleanShapes(scene[0], scene[1], 'subtraction', {
    autoAlignDisjoint: true,
  });
  assert.equal(resSub.ok, true);
  assert.ok(resSub.resultShape !== null);
  assert.ok(resSub.resultShape.points.length >= 5);
  assert.ok(computeShapeMetrics(resSub.resultShape).areaMm2 > 700);
});

test('resizeShapeEdge2D, resizeLineWall2D, and resizeCircleDiameter2D customize individual edge values accurately', () => {
  const scene = createDefaultStarterScene();
  const rectShape = scene[0]; // 36x32 rectangle

  // 1. Customize a single edge (Edge 0: bottom edge) from 36mm to 54mm -> becomes a custom polygon (trapezoid)
  const customTrap = resizeShapeEdge2D(rectShape, 0, 54);
  const trapDim = computeShapeDimensions(customTrap);
  assert.equal(customTrap.type, 'polygon');
  assert.equal(trapDim.edges[0].lengthMm, 54);
  // Next, customize Edge 1 (right edge) to 40mm at 90 degrees; Edge 0 remains 54mm!
  const customTrap2 = resizeShapeEdge2D(customTrap, 1, 40, { targetAngleDeg: 90 });
  const trapDim2 = computeShapeDimensions(customTrap2);
  assert.equal(trapDim2.edges[0].lengthMm, 54);
  assert.equal(trapDim2.edges[1].lengthMm, 40);
  assert.equal(trapDim2.edges[1].angleDeg, 90);

  // 2. Customize Edge 0 with syncOppositeRectEdge = true -> both Edge 0 and Edge 2 become 60mm
  const syncedRect = resizeShapeEdge2D(rectShape, 0, 60, { syncOppositeRectEdge: true });
  const syncedDim = computeShapeDimensions(syncedRect);
  assert.equal(syncedDim.edges[0].lengthMm, 60);
  assert.equal(syncedDim.edges[2].lengthMm, 60);

  // 3. Customize Line Wall length (Edge 0 -> 58mm) and thickness (Edge 1 -> 10mm)
  const lineShape = scene[3];
  const resizedLine = resizeLineWall2D(lineShape, 58, 10);
  const lineDim = computeShapeDimensions(resizedLine);
  assert.ok(Math.abs(lineDim.primaryLengthMm! - 58) < 1e-12);
  assert.ok(Math.abs(lineDim.thicknessMm! - 10) < 1e-12);

  // 4. Customize Circle diameter to 48mm
  const circleShape = scene[2];
  const resizedCircle = resizeCircleDiameter2D(circleShape, 48);
  const circleDim = computeShapeDimensions(resizedCircle);
  assert.equal(circleDim.diameterMm, 48);
  assert.equal(circleDim.radiusMm, 24);
});

test('mirrorShape2D flips about pivot axis, preserves area and winding', () => {
  // 非对称 L 形点集，质心明显偏离原点
  const lShape: CadShape = {
    id: 'l1',
    name: 'L形',
    type: 'polygon',
    points: [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 18 },
      { x: 18, y: 18 },
      { x: 18, y: 30 },
      { x: 10, y: 30 },
    ],
    zHeight: 20,
    zOffset: 0,
    bevel: 0,
    color: '#38bdf8',
    materialPreset: 'aluminum',
    visible: true,
  };
  const areaBefore = computePolygonArea(lShape.points);

  // 绕 x=0（竖直轴）镜像：所有点 x → -x
  const mirroredX = mirrorShape2D(lShape, 'x', 0);
  assert.equal(computePolygonArea(mirroredX.points), areaBefore);
  const b0 = computeBounds2D(lShape.points);
  const b1 = computeBounds2D(mirroredX.points);
  assert.ok(Math.abs(b1.minX + b0.maxX) < 0.001);
  assert.ok(Math.abs(b1.maxX + b0.minX) < 0.001);
  assert.ok(Math.abs(b1.minY - b0.minY) < 0.001);

  // 绕自身包围盒中心镜像：包围盒位置严格不变，仅顶点走向反转
  const pivotX = (b0.minX + b0.maxX) / 2;
  const mirroredSelf = mirrorShape2D(lShape, 'x', pivotX);
  const b2 = computeBounds2D(mirroredSelf.points);
  assert.ok(Math.abs(b2.minX - b0.minX) < 0.001);
  assert.ok(Math.abs(b2.maxX - b0.maxX) < 0.001);

  // 绕 y=0 镜像：所有点 y → -y
  const mirroredY = mirrorShape2D(lShape, 'y', 0);
  const b3 = computeBounds2D(mirroredY.points);
  assert.ok(Math.abs(b3.minY + b0.maxY) < 0.001);
  assert.equal(computePolygonArea(mirroredY.points), areaBefore);
});

test('rotateShape2D rotates points about arbitrary center', () => {
  const marker: CadShape = {
    id: 'm1',
    name: '标记块',
    type: 'rect',
    points: [
      { x: 48, y: -2 },
      { x: 52, y: -2 },
      { x: 52, y: 2 },
      { x: 48, y: 2 },
    ],
    zHeight: 5,
    zOffset: 0,
    bevel: 0,
    color: '#f59e0b',
    materialPreset: 'brass',
    visible: true,
  };
  // 质心 (50, 0) 绕原点旋转 90° → (0, 50)
  const rotated = rotateShape2D(marker, { x: 0, y: 0 }, 90);
  const c = computeBounds2D(rotated.points).centroid;
  assert.ok(Math.abs(c.x) < 0.01);
  assert.ok(Math.abs(c.y - 50) < 0.01);
  // 面积不变
  assert.equal(
    computePolygonArea(rotated.points),
    computePolygonArea(marker.points),
  );
});

test('createRectArrayCopies creates rows*cols-1 translated copies with correct pitch', () => {
  const box = createPrimitiveShape('box', 1); // 40x40
  const copies = createRectArrayCopies([box], {
    rows: 2,
    cols: 3,
    gapX: 5,
    gapY: 10,
  });
  assert.equal(copies.length, 5);
  // 所有 id 唯一
  assert.equal(new Set(copies.map((c) => c.id)).size, 5);
  // 间距 = 包围盒 + 边缘间距
  const b0 = computeBounds2D(box.points);
  const pitchX = 40 + 5;
  const pitchY = 40 + 10;
  const foundXStep = copies.some((c) => {
    const bc = computeBounds2D(c.points);
    return (
      Math.abs(bc.minX - (b0.minX + pitchX)) < 0.01 &&
      Math.abs(bc.minY - b0.minY) < 0.01
    );
  });
  const foundYStep = copies.some((c) => {
    const bc = computeBounds2D(c.points);
    return (
      Math.abs(bc.minY - (b0.minY + pitchY)) < 0.01 &&
      Math.abs(bc.minX - b0.minX) < 0.01
    );
  });
  assert.ok(foundXStep);
  assert.ok(foundYStep);
  // 1×1 不产生副本
  assert.equal(
    createRectArrayCopies([box], { rows: 1, cols: 1, gapX: 5, gapY: 5 }).length,
    0,
  );
});

test('createPolarArrayCopies distributes copies evenly around center for 360°', () => {
  const marker: CadShape = {
    id: 'p1',
    name: '极轴块',
    type: 'rect',
    points: [
      { x: 48, y: -2 },
      { x: 52, y: -2 },
      { x: 52, y: 2 },
      { x: 48, y: 2 },
    ],
    zHeight: 5,
    zOffset: 0,
    bevel: 0,
    color: '#818cf8',
    materialPreset: 'steel',
    visible: true,
  };
  // 数量 4、总角 360°：副本落在 90°/180°/270°
  const copies = createPolarArrayCopies([marker], {
    count: 4,
    totalAngleDeg: 360,
    center: { x: 0, y: 0 },
  });
  assert.equal(copies.length, 3);
  const centroids = copies.map((c) => computeBounds2D(c.points).centroid);
  assert.ok(
    centroids.some((c) => Math.abs(c.x) < 0.2 && Math.abs(c.y - 50) < 0.2),
  );
  assert.ok(
    centroids.some((c) => Math.abs(c.x + 50) < 0.2 && Math.abs(c.y) < 0.2),
  );
  assert.ok(
    centroids.some((c) => Math.abs(c.x) < 0.2 && Math.abs(c.y + 50) < 0.2),
  );

  // 非整圆 180°、数量 3：副本落在 90° 与 180°（首尾落在起止角）
  const half = createPolarArrayCopies([marker], {
    count: 3,
    totalAngleDeg: 180,
    center: { x: 0, y: 0 },
  });
  assert.equal(half.length, 2);
  const c180 = computeBounds2D(half[1].points).centroid;
  assert.ok(Math.abs(c180.x + 50) < 0.2 && Math.abs(c180.y) < 0.2);
});

