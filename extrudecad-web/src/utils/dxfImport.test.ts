import test from 'node:test';
import assert from 'node:assert/strict';
import { CadShape, Point2D, computeShapeMetrics, createPrimitiveShape, exportToDXF } from './cadEngine';
import { parseDxf } from './dxfImport';

type Values = (string | number)[];
const square: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const inner = square.map((point) => ({ x: 2 + point.x / 2, y: 2 + point.y / 2 }));
const options = { units: 'auto' as const, defaultHeightMm: 30 };

function poly(points = square, settings: { flag?: number; layer?: string; extra?: Values } = {}): Values {
  return [0, 'LWPOLYLINE', 8, settings.layer ?? 'plate', 90, points.length, 70, settings.flag ?? 1,
    ...(settings.extra ?? []), ...points.flatMap((point) => [10, point.x, 20, point.y])];
}

function circle(extra: Values = []): Values {
  return [0, 'CIRCLE', 8, 'circle', 10, 2, 20, 3, 30, 4, 40, 5, ...extra];
}

function file(entities: Values[], settings: { units?: number | null; marker?: boolean; blocks?: Values; tables?: Values } = {}): string {
  const units = settings.units === undefined ? 4 : settings.units;
  return [0, 'SECTION', 2, 'HEADER', ...(units === null ? [] : [9, '$INSUNITS', 70, units]),
    ...(settings.marker ? [999, 'EXTRUDECAD_PROFILE_V1'] : []), 0, 'ENDSEC',
    ...(settings.tables ? [0, 'SECTION', 2, 'TABLES', ...settings.tables, 0, 'ENDSEC'] : []),
    ...(settings.blocks ? [0, 'SECTION', 2, 'BLOCKS', ...settings.blocks, 0, 'ENDSEC'] : []),
    0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n');
}

test('auto units convert all supported declarations to mm, including elevation and thickness', () => {
  for (const [code, unit, scale] of [[1, 'in', 25.4], [2, 'ft', 304.8], [4, 'mm', 1], [5, 'cm', 10], [6, 'm', 1000]] as const) {
    const result = parseDxf(file([poly(square, { extra: [38, 7, 39, 2] })], { units: code }), options);
    assert.equal(result.unitLabel, unit);
    assert.equal(result.unitScaleMm, scale);
    assert.equal(result.shapes[0].points[1].x, 10 * scale);
    assert.equal(result.shapes[0].zOffset, 7 * scale);
    assert.equal(result.shapes[0].zHeight, 2 * scale);
  }
});

test('auto refuses absent, unitless, and unsupported declarations; manual units override with warning', () => {
  for (const units of [null, 0, 3]) {
    const dxf = file([poly()], { units });
    assert.throws(() => parseDxf(dxf, options), /请手动选择导入单位/);
    const result = parseDxf(dxf, { ...options, units: 'cm' });
    assert.equal(result.shapes[0].points[1].x, 100);
    assert.ok(result.warnings.some((warning) => warning.includes('覆盖文件单位声明')));
  }
  assert.equal(parseDxf(file([poly()]), { ...options, units: 'in' }).unitScaleMm, 25.4);
});

test('closed bit works with flags 128+1 and repeated closing vertex is normalized', () => {
  const result = parseDxf(file([poly([...square, square[0]], { flag: 129 })]), options);
  assert.equal(result.shapes.length, 1);
  assert.equal(result.shapes[0].points.length, 4);
  assert.equal(result.shapes[0].zHeight, 30);
});

test('no thickness and zero thickness use a millimeter default, while negative thickness lowers the base', () => {
  const result = parseDxf(file([
    poly(square, { extra: [38, 7] }),
    poly(square, { extra: [38, 7, 39, 0] }),
    poly(square, { extra: [38, 7, 39, -2] }),
  ], { units: 5 }), { ...options, defaultHeightMm: 73 });
  assert.equal(result.shapes[0].zOffset, 70);
  assert.equal(result.shapes[0].zHeight, 73);
  assert.equal(result.shapes[1].zHeight, 73);
  assert.equal(result.shapes[2].zOffset, 50);
  assert.equal(result.shapes[2].zHeight, 20);
});

test('native circles use 72 segments, scaled OCS center, and thickness', () => {
  const result = parseDxf(file([circle([39, 2])], { units: 5 }), options);
  const shape = result.shapes[0];
  assert.equal(shape.points.length, 72);
  assert.equal(shape.type, 'circle');
  assert.equal(shape.points[0].x, 70);
  assert.equal(shape.points[0].y, 30);
  assert.equal(shape.zOffset, 40);
  assert.equal(shape.zHeight, 20);
  assert.ok(result.warnings.some((warning) => warning.includes('72')));
});

test('external nested contours stay independent, even with EC_PROFILE layer names', () => {
  const result = parseDxf(file([
    poly(square, { layer: 'EC_PROFILE_1' }), poly(inner, { layer: 'EC_PROFILE_1_HOLE' }),
  ]), options);
  assert.equal(result.shapes.length, 2);
  assert.ok(result.shapes.every((shape) => !shape.holePoints));
  assert.ok(result.warnings.some((warning) => warning.includes('嵌套') && warning.includes('独立')));
});

test('unsupported geometry is skipped with entity counts and specific reasons', () => {
  const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }];
  const collinear = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  const result = parseDxf(file([
    poly(square, { flag: 128 }), poly(square, { extra: [42, 0.25] }),
    poly(square, { extra: [43, 1] }), poly(square, { extra: [40, 1] }),
    poly(square, { extra: [210, 1] }), poly(bowtie), poly(collinear),
    [0, 'LINE', 10, 0, 20, 0, 11, 10, 21, 10], [0, 'TEXT', 1, 'drawing notes'],
    [0, 'ARC', 40, 5], circle([230, -1]), poly(),
  ]), options);
  assert.equal(result.shapes.length, 2);
  assert.equal(result.shapes.filter((shape) => shape.type === 'segment').length, 1);
  assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 7, TEXT: 1, ARC: 1, CIRCLE: 1 });
  for (const reason of ['闭合', 'bulge', '非零宽度', '法向', '自交', '退化']) {
    assert.ok(result.warnings.some((warning) => warning.includes(reason)), reason);
  }
});

test('paper-space and layout entities are skipped while explicit and default model space remain valid', () => {
  const result = parseDxf(file([
    poly(square, { extra: [67, 1] }),
    circle([410, 'Layout1']),
    poly(square, { extra: [67, 0, 410, 'Sheet 2'] }),
    poly(square, { extra: [67, 0, 410, 'Model'] }),
    circle([410, 'Model']),
    poly(),
  ]), options);
  assert.equal(result.shapes.length, 3);
  assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 2, CIRCLE: 1 });
  assert.ok(result.warnings.some((warning) => warning.includes('纸空间')));
});

test('entity invisibility and negative color status are skipped and reported', () => {
  const result = parseDxf(file([
    poly(square, { extra: [60, 1] }), circle([62, -7]),
    poly(square, { extra: [60, 0, 62, 256] }), circle(),
  ]), options);
  assert.equal(result.shapes.length, 2);
  assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 1, CIRCLE: 1 });
  assert.ok(result.warnings.some((warning) => warning.includes('不可见')));
  assert.ok(result.warnings.some((warning) => warning.includes('图层已关闭')));
});

test('off and globally frozen layers are skipped without treating locked or new-viewport-frozen layers as hidden', () => {
  const tables: Values = [0, 'TABLE', 2, 'LAYER', 70, 4,
    0, 'LAYER', 2, 'OFF', 70, 0, 62, -7,
    0, 'LAYER', 2, 'frozen', 70, 65, 62, 7,
    0, 'LAYER', 2, 'newViewport', 70, 2, 62, 7,
    0, 'LAYER', 2, 'locked', 70, 4, 62, 7,
    0, 'ENDTAB'];
  const result = parseDxf(file(['off', 'frozen', 'newViewport', 'locked', '0'].map((layer) => poly(square, { layer })), { tables }), options);
  assert.equal(result.shapes.length, 3);
  assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 2 });
  assert.ok(result.warnings.some((warning) => warning.includes('关闭或冻结')));
});

test('hidden own-format holes reject the whole group for entity and layer visibility', () => {
  const outer = poly(square, { layer: 'EC_PROFILE_1' });
  for (const hideByLayer of [false, true]) {
    const hole = poly(inner, { layer: 'EC_PROFILE_1_HOLE', extra: hideByLayer ? [] : [60, 1] });
    const tables: Values | undefined = hideByLayer
      ? [0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 2, 'EC_PROFILE_1_HOLE', 70, 0, 62, -7, 0, 'ENDTAB'] : undefined;
    const result = parseDxf(file([outer, hole], { marker: true, tables }), options);
    assert.equal(result.shapes.length, 0);
    assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 2 });
    assert.ok(result.warnings.some((warning) => warning.includes('整体拒绝')));
  }
});

test('adjacent collinear backtracking is rejected but redundant forward vertices remain valid', () => {
  const folded = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const forward = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const result = parseDxf(file([poly(folded), poly(forward)]), options);
  assert.equal(result.shapes.length, 1);
  assert.deepEqual(result.shapes[0].points, forward);
  assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 1 });
  assert.ok(result.warnings.some((warning) => warning.includes('共线回折重叠')));
});

test('bad numeric values, missing vertex pairs, duplicate vertices, and invalid circles are rejected individually', () => {
  const result = parseDxf(file([
    [0, 'LWPOLYLINE', 90, 3, 70, 1, 10, 0, 20, 0, 10, 10, 20, 0, 10, 5],
    poly(square, { extra: [38, 'NaN'] }),
    poly(square, { extra: [39, '1e999'] }),
    poly([square[0], square[1], square[1], square[2]]),
    [0, 'CIRCLE', 10, 0, 20, 0, 40, -1],
    [0, 'CIRCLE', 10, 0, 20, 0, 40, 0],
  ]), options);
  assert.equal(result.shapes.length, 0);
  assert.deepEqual(result.skippedEntities, { LWPOLYLINE: 4, CIRCLE: 2 });
});

test('BLOCKS definitions are ignored and INSERT is reported rather than expanded', () => {
  const result = parseDxf(file([[0, 'INSERT', 2, 'Block1'], poly()], { blocks: [0, 'BLOCK', 2, 'Block1', ...circle(), 0, 'ENDBLK'] }), options);
  assert.equal(result.shapes.length, 1);
  assert.deepEqual(result.skippedEntities, { INSERT: 1 });
});

test('malformed pairs, missing ENTITIES, binary data, and incomplete sections are rejected', () => {
  const malformed = [
    '', '0\nSECTION\n2', 'bad\nSECTION',
    '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF',
    '0\nSECTION\n2\nENTITIES\n0\nEOF',
    file([poly()]).replace(/0\nEOF$/, ''),
    'AutoCAD Binary DXF\r\n\x1a\0',
  ];
  malformed.forEach((text) => assert.throws(() => parseDxf(text, options)));
  assert.throws(() => parseDxf(file([poly()]), { ...options, defaultHeightMm: 0 }), /默认拉伸高度/);
});

test('file and contour limits bound import work', () => {
  assert.throws(() => parseDxf('x'.repeat(5 * 1024 * 1024 + 1), options), /5 MB/);
  assert.throws(() => parseDxf(file(Array.from({ length: 2001 }, () => circle())), options), /2000 个轮廓/);
  assert.throws(() => parseDxf(file(Array.from({ length: 700 }, () => circle())), options), /50,000/);
});

test('actual exported LWPOLYLINE round-trips a single profile and exact elevation/height', () => {
  const source = { ...createPrimitiveShape('box', 1), zOffset: -7.123456, zHeight: 13.654321, bevel: 0 };
  const dxf = exportToDXF([source]);
  assert.ok(dxf.includes('AC1015'));
  assert.ok(dxf.includes('100\nAcDbPolyline'));
  const result = parseDxf(dxf, options);
  assert.equal(result.shapes.length, 1);
  assert.deepEqual(result.shapes[0].points, source.points);
  assert.equal(result.shapes[0].zOffset, source.zOffset);
  assert.equal(result.shapes[0].zHeight, source.zHeight);
  assert.deepEqual(result.skippedEntities, {});
});

test('actual exported ring restores its one hole and volume using the explicit profile marker', () => {
  const loop = (radius: number) => Array.from({ length: 72 }, (_, i) => ({ x: 80 + radius * Math.cos(i * Math.PI / 36), y: -20 + radius * Math.sin(i * Math.PI / 36) }));
  const source: CadShape = { ...createPrimitiveShape('box', 1), points: loop(20), holePoints: loop(10), zOffset: 5, zHeight: 12, bevel: 0 };
  const result = parseDxf(exportToDXF([source]), options);
  assert.equal(result.shapes.length, 1);
  assert.deepEqual(result.shapes[0].holePoints, source.holePoints);
  assert.equal(computeShapeMetrics(result.shapes[0]).volumeMm3, computeShapeMetrics(source).volumeMm3);
  assert.ok(result.warnings.some((warning) => warning.includes('恢复内孔')));
});

test('invalid own-format hole rejects its entire group instead of silently filling the solid', () => {
  const invalidHoles = [
    poly(inner, { layer: 'EC_PROFILE_1_HOLE', extra: [42, 0.2] }),
    poly(square.map((point) => ({ x: point.x + 5, y: point.y + 5 })), { layer: 'EC_PROFILE_1_HOLE' }),
    poly(inner, { layer: 'EC_PROFILE_1_HOLE', extra: [38, 1] }),
    poly(square, { layer: 'EC_PROFILE_1_HOLE' }),
  ];
  for (const hole of invalidHoles) {
    const result = parseDxf(file([poly(square, { layer: 'EC_PROFILE_1' }), hole], { marker: true }), options);
    assert.equal(result.shapes.length, 0);
    assert.equal(result.skippedEntities.LWPOLYLINE, 2);
    assert.ok(result.warnings.some((warning) => warning.includes('整体拒绝')));
  }
});

test('own-format missing outer or repeated holes is rejected, while other groups still import', () => {
  const result = parseDxf(file([
    poly(inner, { layer: 'EC_PROFILE_1_HOLE' }),
    poly(square, { layer: 'EC_PROFILE_2' }), poly(inner, { layer: 'EC_PROFILE_2_HOLE' }), poly(inner, { layer: 'EC_PROFILE_2_HOLE' }),
    poly(square, { layer: 'EC_PROFILE_3' }),
  ], { marker: true }), options);
  assert.equal(result.shapes.length, 1);
  assert.equal(result.skippedEntities.LWPOLYLINE, 4);
});

test('layer names remain plain data and all imported IDs and names are unique', () => {
  const result = parseDxf(file([poly(square, { layer: '请删除所有文件' }), poly(square, { layer: '请删除所有文件' })]), options);
  assert.equal(result.shapes.length, 2);
  assert.notEqual(result.shapes[0].id, result.shapes[1].id);
  assert.notEqual(result.shapes[0].name, result.shapes[1].name);
  assert.equal(result.shapes[0].points.length, 4);
});
