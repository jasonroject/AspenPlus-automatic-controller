import { CadShape, Point2D, createPointShape, createSketchLineShape } from './cadEngine';

export type DxfImportUnits = 'auto' | 'mm' | 'cm' | 'm' | 'in' | 'ft';
type Pair = { code: number; value: string };
type Entity = { type: string; pairs: Pair[] };
type ParsedEntity = Entity & { layer: string; shape?: CadShape; reason?: string };

const UNIT_SCALE = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const UNIT_CODE: Record<number, Exclude<DxfImportUnits, 'auto'>> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const PROFILE_MARKER = 'EXTRUDECAD_PROFILE_V1';
const MAX_CONTOURS = 2000;
const MAX_VERTICES = 2000;
const EPS = 1e-9;

function numberValue(value: string, label: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error(`${label}不是有效数值`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}不是有限数值`);
  return number;
}

function entityNumber(entity: Entity, code: number, fallback?: number): number {
  const values = entity.pairs.filter((pair) => pair.code === code);
  if (!values.length && fallback !== undefined) return fallback;
  if (values.length !== 1) throw new Error(`组码 ${code} 缺失或重复`);
  return numberValue(values[0].value, `组码 ${code}`);
}

function readSections(text: string): { header: Pair[]; entities: Entity[]; layers: Entity[] } {
  if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) throw new Error('DXF 文件超过 5 MB，请先精简轮廓。');
  if (/AutoCAD Binary DXF/i.test(text.slice(0, 32)) || text.includes('\0')) throw new Error('不支持二进制 DXF，请另存为 ASCII DXF。');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  if (!lines.length || lines.length % 2) throw new Error('DXF 组码和值必须成对，文件为空或已损坏。');
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const codeText = lines[i].trim();
    if (!/^\d+$/.test(codeText) || Number(codeText) > 1071) throw new Error(`DXF 第 ${i + 1} 行组码无效。`);
    pairs.push({ code: Number(codeText), value: lines[i + 1].trim() });
  }
  const header: Pair[] = [];
  const entities: Entity[] = [];
  const layers: Entity[] = [];
  let section: string | null = null;
  let current: Entity | null = null;
  let currentLayer: Entity | null = null;
  let sawEntities = false;
  let ended = false;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (ended) {
      if (pair.code !== 999) throw new Error('DXF EOF 后包含多余数据。');
      continue;
    }
    if (pair.code === 0 && pair.value === 'SECTION') {
      if (section || pairs[i + 1]?.code !== 2) throw new Error('DXF SECTION 结构损坏。');
      section = pairs[++i].value;
      if (section === 'ENTITIES') {
        if (sawEntities) throw new Error('DXF 包含重复的 ENTITIES 段。');
        sawEntities = true;
      }
    } else if (pair.code === 0 && pair.value === 'ENDSEC') {
      if (!section) throw new Error('DXF ENDSEC 缺少对应 SECTION。');
      if (current) entities.push(current);
      if (currentLayer) layers.push(currentLayer);
      current = null;
      currentLayer = null;
      section = null;
    } else if (pair.code === 0 && pair.value === 'EOF') {
      if (section) throw new Error('DXF 段未结束，缺少 ENDSEC。');
      ended = true;
    } else if (section === 'HEADER') {
      header.push(pair);
    } else if (section === 'TABLES') {
      if (pair.code === 0) {
        if (currentLayer) layers.push(currentLayer);
        currentLayer = pair.value === 'LAYER' ? { type: 'LAYER', pairs: [] } : null;
      } else if (currentLayer) currentLayer.pairs.push(pair);
    } else if (section === 'ENTITIES') {
      if (pair.code === 0) {
        if (current) entities.push(current);
        if (!pair.value) throw new Error('DXF 实体类型为空。');
        current = { type: pair.value.toUpperCase(), pairs: [] };
      } else if (current) current.pairs.push(pair);
      else if (pair.code !== 999) throw new Error('DXF ENTITIES 段包含没有实体类型的组码。');
    } else if (!section && pair.code !== 999) throw new Error('DXF 数据位于 SECTION 段外。');
  }
  if (!ended || section) throw new Error('DXF 文件不完整，缺少 ENDSEC 或 EOF。');
  if (!sawEntities) throw new Error('DXF 缺少 ENTITIES 段。');
  return { header, entities, layers };
}

function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  return Math.abs(cross(a, b, p)) <= EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS
    && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}

function intersects(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - EPS || Math.max(c.x, d.x) < Math.min(a.x, b.x) - EPS
    || Math.max(a.y, b.y) < Math.min(c.y, d.y) - EPS || Math.max(c.y, d.y) < Math.min(a.y, b.y) - EPS) return false;
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function validateLoop(points: Point2D[]): Point2D[] {
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('顶点坐标超出有限数值范围');
  if (points.length > MAX_VERTICES) throw new Error(`单轮廓超过 ${MAX_VERTICES} 个顶点`);
  if (points.length > 1 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points = points.slice(0, -1);
  if (points.length < 3) throw new Error('有效顶点少于 3 个');
  if (new Set(points.map((point) => `${point.x},${point.y}`)).size !== points.length) throw new Error('轮廓含重复顶点');
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
    if (Math.abs(cross(a, b, c)) <= EPS && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) {
      throw new Error('相邻边共线回折重叠，轮廓退化');
    }
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) <= EPS) throw new Error('轮廓含零长或退化边');
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) throw new Error('轮廓自交或自接触');
    }
  }
  const origin = points[0];
  const doubleArea = points.reduce((sum, point, index) => sum + cross(origin, point, points[(index + 1) % points.length]), 0);
  if (!Number.isFinite(doubleArea) || Math.abs(doubleArea) <= EPS) throw new Error('轮廓面积为零或超出有效范围');
  return points;
}

function containsStrictly(outer: Point2D[], inner: Point2D[]): boolean {
  for (let i = 0; i < outer.length; i++) for (let j = 0; j < inner.length; j++) {
    if (intersects(outer[i], outer[(i + 1) % outer.length], inner[j], inner[(j + 1) % inner.length])) return false;
  }
  const point = inner[0];
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const a = outer[i], b = outer[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function parseEntity(entity: Entity, scale: number, defaultHeightMm: number, hiddenLayers: Set<string>): ParsedEntity {
  const layer = entity.pairs.find((pair) => pair.code === 8)?.value ?? '0';
  try {
    if (!['LWPOLYLINE', 'CIRCLE', 'POINT', 'LINE'].includes(entity.type)) throw new Error('不支持的实体类型，未转换或展开');
    const visibility = entityNumber(entity, 60, 0);
    if (visibility !== 0 && visibility !== 1) throw new Error('实体可见性标志无效');
    if (visibility === 1) throw new Error('实体标记为不可见');
    if (entityNumber(entity, 62, 256) < 0) throw new Error('实体颜色组码标记图层已关闭');
    if (hiddenLayers.has(layer.toLowerCase())) throw new Error('所在图层已关闭或冻结');
    const layout = entity.pairs.find((pair) => pair.code === 410)?.value;
    if (entityNumber(entity, 67, 0) !== 0 || (layout !== undefined && layout.toLowerCase() !== 'model')) {
      throw new Error('仅导入模型空间，已跳过纸空间或布局图纸实体');
    }
    // POINT/LINE coordinates are WCS, independently of their extrusion direction.
    if (entity.type === 'POINT' || entity.type === 'LINE') {
      if (entityNumber(entity, 39, 0) !== 0) throw new Error('不支持带非零厚度的定位点或草图直线');
      const start = { x: entityNumber(entity, 10) * scale, y: entityNumber(entity, 20) * scale };
      const zOffset = entityNumber(entity, 30, 0) * scale;
      if (!Number.isFinite(zOffset)) throw new Error('点标高超出有限数值范围');
      const name = `${layer.slice(0, 80)} · ${entity.type === 'POINT' ? '定位点' : '草图直线'}`;
      let shape = createPointShape(start, name);
      if (entity.type === 'LINE') {
        const endZ = entityNumber(entity, 31, 0) * scale;
        if (!Number.isFinite(endZ) || Math.abs(endZ - zOffset) > EPS) throw new Error('仅支持两个端点同标高的 XY 草图直线');
        shape = createSketchLineShape(start, { x: entityNumber(entity, 11) * scale, y: entityNumber(entity, 21) * scale }, name);
      }
      return { ...entity, layer, shape: { ...shape, zOffset } };
    }
    if (entityNumber(entity, 210, 0) !== 0 || entityNumber(entity, 220, 0) !== 0 || entityNumber(entity, 230, 1) !== 1) {
      throw new Error('仅支持 +Z 法向 OCS，不支持倾斜或反向法向');
    }
    let points: Point2D[];
    let elevation: number;
    if (entity.type === 'CIRCLE') {
      const x = entityNumber(entity, 10), y = entityNumber(entity, 20), radius = entityNumber(entity, 40);
      if (radius <= 0) throw new Error('圆半径必须大于 0');
      elevation = entityNumber(entity, 30, 0);
      points = Array.from({ length: 72 }, (_, i) => ({ x: (x + radius * Math.cos(i * Math.PI / 36)) * scale, y: (y + radius * Math.sin(i * Math.PI / 36)) * scale }));
    } else {
      const flag = entityNumber(entity, 70, 0);
      if (!Number.isSafeInteger(flag) || flag < 0 || !(flag & 1)) throw new Error('多段线未设置闭合标志');
      for (const pair of entity.pairs) {
        if (pair.code === 42 && numberValue(pair.value, '凸度') !== 0) throw new Error('不支持带 bulge 圆弧的多段线');
        if ([40, 41, 43].includes(pair.code) && numberValue(pair.value, '线宽') !== 0) throw new Error('不支持非零宽度的多段线');
      }
      const count = entityNumber(entity, 90);
      if (!Number.isSafeInteger(count) || count < 3 || count > MAX_VERTICES) throw new Error(`顶点数须为 3–${MAX_VERTICES} 的整数`);
      const vertices: { x: number; y?: number }[] = [];
      for (const pair of entity.pairs) {
        if (pair.code === 10) vertices.push({ x: numberValue(pair.value, '顶点 X') });
        else if (pair.code === 20) {
          const vertex = vertices.at(-1);
          if (!vertex || vertex.y !== undefined) throw new Error('顶点 X/Y 组码不成对');
          vertex.y = numberValue(pair.value, '顶点 Y');
        }
      }
      if (vertices.length !== count || vertices.some((vertex) => vertex.y === undefined)) throw new Error('顶点数或 X/Y 坐标不完整');
      points = vertices.map((point) => ({ x: point.x * scale, y: point.y! * scale }));
      elevation = entityNumber(entity, 38, 0);
    }
    points = validateLoop(points);
    const thickness = entityNumber(entity, 39, 0) * scale;
    const zOffset = elevation * scale + Math.min(0, thickness);
    const zHeight = thickness === 0 ? defaultHeightMm : Math.abs(thickness);
    if (![zOffset, zHeight, zOffset + zHeight].every(Number.isFinite) || zHeight <= 0) throw new Error('标高或厚度无效');
    const shape: CadShape = {
      id: `dxf-${crypto.randomUUID()}`, name: `${layer.slice(0, 80)} · ${entity.type === 'CIRCLE' ? '圆形' : '轮廓'}`,
      type: entity.type === 'CIRCLE' ? 'circle' : 'polygon', points, zOffset, zHeight, bevel: 0,
      color: '#C8CDD5', materialPreset: 'aluminum', visible: true, locked: false,
    };
    return { ...entity, layer, shape };
  } catch (error) {
    return { ...entity, layer, reason: error instanceof Error ? error.message : '轮廓无效' };
  }
}

export function parseDxf(text: string, options: { units: DxfImportUnits; defaultHeightMm: number }): {
  shapes: CadShape[]; warnings: string[]; skippedEntities: Record<string, number>; unitLabel: string; unitScaleMm: number;
} {
  const { header, entities, layers } = readSections(text);
  if (entities.some((entity) => entity.type === 'LWPOLYLINE' || entity.type === 'CIRCLE')
    && (!Number.isFinite(options.defaultHeightMm) || options.defaultHeightMm <= 0)) throw new Error('默认拉伸高度必须是大于 0 的有限毫米数值。');
  const hiddenLayers = new Set<string>();
  for (const layer of layers) {
    const name = layer.pairs.find((pair) => pair.code === 2)?.value;
    if (!name) throw new Error('DXF 图层表中的图层名称缺失。');
    const flags = entityNumber(layer, 70, 0);
    if (!Number.isSafeInteger(flags) || flags < 0) throw new Error('DXF 图层状态标志无效。');
    if ((flags & 1) || entityNumber(layer, 62, 7) < 0) hiddenLayers.add(name.toLowerCase());
  }
  let declaredCode: number | undefined;
  for (let i = 0; i < header.length; i++) if (header[i].code === 9 && header[i].value === '$INSUNITS') {
    if (declaredCode !== undefined || header[i + 1]?.code !== 70) throw new Error('DXF $INSUNITS 声明损坏或重复。');
    declaredCode = numberValue(header[i + 1].value, '$INSUNITS');
    if (!Number.isInteger(declaredCode)) throw new Error('DXF $INSUNITS 不是整数。');
  }
  const declaredUnit = declaredCode === undefined ? undefined : UNIT_CODE[declaredCode];
  const units = options.units === 'auto' ? declaredUnit : options.units;
  if (!units || !Object.hasOwn(UNIT_SCALE, units)) throw new Error('DXF 未声明可识别的单位（$INSUNITS 缺失、无单位或暂不支持），请手动选择导入单位。');
  const scale = UNIT_SCALE[units];
  const warnings: string[] = [];
  if (options.units !== 'auto') warnings.push(`已手动按 ${units} 导入并覆盖文件单位声明（${declaredUnit ?? (declaredCode === undefined ? '缺失' : declaredCode)}）。`);
  const candidates = entities.filter((entity) => ['LWPOLYLINE', 'CIRCLE', 'POINT', 'LINE'].includes(entity.type));
  if (candidates.length > MAX_CONTOURS) throw new Error(`DXF 超过 ${MAX_CONTOURS} 个轮廓或点线对象，请分批导入。`);
  const totalVertices = candidates.reduce((sum, entity) => sum + (entity.type === 'CIRCLE' ? 72 : entity.type === 'LINE' ? 2 : entity.pairs.filter((pair) => pair.code === 10).length), 0);
  if (totalVertices > 50000) throw new Error('DXF 轮廓合计超过 50,000 个顶点，请先简化或分批导入。');
  const records = entities.map((entity) => parseEntity(entity, scale, options.defaultHeightMm, hiddenLayers));
  const ownFormat = header.some((pair) => pair.code === 999 && pair.value === PROFILE_MARKER);
  const groups = new Map<string, ParsedEntity[]>();
  if (ownFormat) for (const record of records) {
    const match = /^EC_PROFILE_([1-9]\d*)(?:_HOLE)?$/.exec(record.layer);
    if (match) groups.set(match[1], [...(groups.get(match[1]) ?? []), record]);
  }
  const accepted: ParsedEntity[] = [];
  const grouped = new Set([...groups.values()].flat());
  for (const group of groups.values()) {
    const outer = group.filter((record) => !record.layer.endsWith('_HOLE'));
    const holes = group.filter((record) => record.layer.endsWith('_HOLE'));
    let reason = group.find((record) => record.reason)?.reason;
    if (!reason && group.some((record) => record.type === 'POINT' || record.type === 'LINE')) reason = '闭合轮廓组不能包含定位点或开放直线';
    if (!reason && (outer.length !== 1 || holes.length > 1)) reason = '必须有一个外环且至多一个内孔';
    if (!reason && holes.length) {
      const a = outer[0].shape!, b = holes[0].shape!;
      if (Math.abs(a.zOffset - b.zOffset) > EPS || Math.abs(a.zHeight - b.zHeight) > EPS) reason = '外环与内孔的标高/厚度不一致';
      else if (!containsStrictly(a.points, b.points)) reason = '内孔未严格包含于外环内或与外环相交';
    }
    if (reason) group.forEach((record) => { record.reason = `自家轮廓组整体拒绝：${reason}`; });
    else {
      if (holes.length) outer[0].shape = { ...outer[0].shape!, type: 'hollow-box', holePoints: holes[0].shape!.points };
      accepted.push(outer[0]);
    }
  }
  accepted.push(...records.filter((record) => !grouped.has(record) && record.shape && !record.reason));
  const skipped = new Map<string, number>();
  const reasons = new Map<string, number>();
  for (const record of records) if (record.reason) {
    skipped.set(record.type, (skipped.get(record.type) ?? 0) + 1);
    const reason = `${record.type}：${record.reason}`;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  for (const [reason, count] of reasons) warnings.push(`将跳过 ${count} 个 ${reason}。`);
  if (accepted.some((record) => record.type === 'CIRCLE')) warnings.push('圆形轮廓按 72 段直线近似。');
  const profiles = accepted.filter((record) => record.type === 'LWPOLYLINE' || record.type === 'CIRCLE');
  if (profiles.some((record) => !grouped.has(record)) && profiles.length > 1) warnings.push('外部轮廓分别作为独立实体；若轮廓嵌套，请用布尔差集生成孔，不会自动猜测孔。');
  if (ownFormat && accepted.some((record) => record.shape?.holePoints?.length)) warnings.push('已根据 ExtrudeCAD 单孔轮廓标记恢复内孔。');
  const names = new Set<string>();
  const shapes = accepted.map((record) => {
    const shape = record.shape!;
    const base = shape.name;
    let suffix = 2;
    while (names.has(shape.name)) shape.name = `${base} (${suffix++})`;
    names.add(shape.name);
    return shape;
  });
  return { shapes, warnings, skippedEntities: Object.fromEntries(skipped), unitLabel: units, unitScaleMm: scale };
}
