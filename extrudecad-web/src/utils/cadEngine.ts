import { ExtrudeGeometry, Path, Shape } from 'three';
import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping';

export interface Point2D {
  x: number;
  y: number;
}

export type ShapeType =
  | 'point'
  | 'segment'
  | 'rect'
  | 'triangle'
  | 'circle'
  | 'line'
  | 'polygon'
  | 'polyline'
  | 'l-bracket'
  | 'hollow-box'
  | 't-beam';

export type MaterialPresetId =
  | 'aluminum'
  | 'steel'
  | 'plastic'
  | 'brass'
  | 'acrylic'
  | 'titanium';

export interface MaterialPreset {
  id: MaterialPresetId;
  name: string;
  densityGPerCm3: number;
  roughness: number;
  metalness: number;
  transmission: number;
  defaultColor: string;
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPreset> = {
  aluminum: {
    id: 'aluminum',
    name: '阳极氧化铝 (6061)',
    densityGPerCm3: 2.7,
    roughness: 0.28,
    metalness: 0.85,
    transmission: 0,
    defaultColor: '#c8cdd5',
  },
  steel: {
    id: 'steel',
    name: '精密拉丝钢 (304)',
    densityGPerCm3: 7.93,
    roughness: 0.22,
    metalness: 0.92,
    transmission: 0,
    defaultColor: '#8e96a0',
  },
  brass: {
    id: 'brass',
    name: '机械黄铜 (C360)',
    densityGPerCm3: 8.5,
    roughness: 0.2,
    metalness: 0.9,
    transmission: 0,
    defaultColor: '#a88b57',
  },
  plastic: {
    id: 'plastic',
    name: '工程塑胶 (ABS/POM)',
    densityGPerCm3: 1.15,
    roughness: 0.65,
    metalness: 0.08,
    transmission: 0,
    defaultColor: '#59616d',
  },
  acrylic: {
    id: 'acrylic',
    name: '光学亚克力 (PMMA)',
    densityGPerCm3: 1.18,
    roughness: 0.12,
    metalness: 0.05,
    transmission: 0.82,
    defaultColor: '#a9c4cf',
  },
  titanium: {
    id: 'titanium',
    name: '航空钛合金 (TC4)',
    densityGPerCm3: 4.43,
    roughness: 0.35,
    metalness: 0.88,
    transmission: 0,
    defaultColor: '#949aa5',
  },
};

export interface CadShape {
  id: string;
  name: string;
  type: ShapeType;
  /** 2D vertices in XY plane (in millimeters, centered around 0,0) */
  points: Point2D[];
  /** Optional linked point IDs, in endpoint order; only valid for a segment. */
  endpointIds?: [string, string];
  /** Optional inner cutout hole in XY plane */
  holePoints?: Point2D[];
  /** Extrusion height along Z axis; zero for point/segment references. */
  zHeight: number;
  /** Base elevation along Z axis (mm, >= 0 or negative) */
  zOffset: number;
  /** Edge bevel size in mm */
  bevel: number;
  /** Hex color string */
  color: string;
  /** Material finish preset */
  materialPreset: MaterialPresetId;
  /** Visibility toggle */
  visible: boolean;
  /** Lock editing toggle */
  locked?: boolean;
  /**
   * Boolean operation lineage. When present, this shape is the result of a
   * boolean op and the two operand shapes were kept (hidden) so the operation
   * can be undone/restored later.
   */
  booleanMeta?: {
    op: BooleanOperationType;
    targetId: string;
    toolId: string;
    targetName: string;
    toolName: string;
  };
}

/** A reference point has a location but no area, thickness, or extrusion. */
export function createPointShape(point: Point2D, name = '定位点'): CadShape {
  if (![point.x, point.y].every(Number.isFinite)) throw new Error('点坐标必须为有限数值。');
  return {
    id: `cad-point-${crypto.randomUUID()}`, name, type: 'point', points: [{ ...point }],
    zHeight: 0, zOffset: 0, bevel: 0, color: '#D6DCE5', materialPreset: 'aluminum', visible: true, locked: false,
  };
}

/** A true sketch line joins two XY points without inventing a wall thickness. */
export function createSketchLineShape(start: Point2D, end: Point2D, name = '草图直线'): CadShape {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || !Number.isFinite(Math.hypot(end.x - start.x, end.y - start.y))
    || (start.x === end.x && start.y === end.y)) throw new Error('直线需要两个不同的有限坐标点。');
  return { ...createPointShape(start, name), id: `cad-segment-${crypto.randomUUID()}`, type: 'segment', points: [{ ...start }, { ...end }] };
}

export interface ShapeMetrics {
  areaMm2: number;
  perimeterMm: number;
  volumeMm3: number;
  volumeCm3: number;
  weightGrams: number;
  widthX: number;
  depthY: number;
  heightZ: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centroid: Point2D;
}

export interface SceneMetrics {
  visibleCount: number;
  totalCount: number;
  totalVolumeCm3: number;
  totalWeightGrams: number;
  totalVertices2D: number;
  bounds: {
    widthX: number;
    depthY: number;
    heightZ: number;
  };
}

export type CameraViewId =
  | 'perspective'
  | 'isometric'
  | 'top'
  | 'front'
  | 'right'
  | 'back'
  | 'left'
  | 'bottom';

export interface CameraViewSpec {
  id: CameraViewId;
  label: string;
  shortLabel: string;
  axisDesc: string;
  positionDir: [number, number, number];
  up: [number, number, number];
  orthographic: boolean;
}

export const CAMERA_VIEWS: CameraViewSpec[] = [
  {
    id: 'perspective',
    label: '3D 透视视图',
    shortLabel: '透视 3D',
    axisDesc: 'Perspective',
    positionDir: [1.15, -1.35, 1.05],
    up: [0, 0, 1],
    orthographic: false,
  },
  {
    id: 'isometric',
    label: '等轴测视图 (ISO)',
    shortLabel: '等轴测',
    axisDesc: 'Isometric XYZ',
    positionDir: [1, -1, 0.85],
    up: [0, 0, 1],
    orthographic: true,
  },
  {
    id: 'top',
    label: '俯视图 (Top XY)',
    shortLabel: '俯视 XY',
    axisDesc: '+Z → XY Plane',
    positionDir: [0, 0, 1],
    up: [0, 1, 0],
    orthographic: true,
  },
  {
    id: 'front',
    label: '正视图 (Front XZ)',
    shortLabel: '正视 XZ',
    axisDesc: '-Y → XZ Plane',
    positionDir: [0, -1, 0],
    up: [0, 0, 1],
    orthographic: true,
  },
  {
    id: 'right',
    label: '右视图 (Right YZ)',
    shortLabel: '右视 YZ',
    axisDesc: '+X → YZ Plane',
    positionDir: [1, 0, 0],
    up: [0, 0, 1],
    orthographic: true,
  },
  {
    id: 'left',
    label: '左视图 (Left YZ)',
    shortLabel: '左视 -YZ',
    axisDesc: '-X → YZ Plane',
    positionDir: [-1, 0, 0],
    up: [0, 0, 1],
    orthographic: true,
  },
  {
    id: 'back',
    label: '后视图 (Back XZ)',
    shortLabel: '后视 -XZ',
    axisDesc: '+Y → XZ Plane',
    positionDir: [0, 1, 0],
    up: [0, 0, 1],
    orthographic: true,
  },
  {
    id: 'bottom',
    label: '仰视图 (Bottom XY)',
    shortLabel: '仰视 -XY',
    axisDesc: '-Z → XY Plane',
    positionDir: [0, 0, -1],
    up: [0, -1, 0],
    orthographic: true,
  },
];

/**
 * Geometry snap: 在可见图形中查找离目标点最近的 端点/边中点/圆心。
 * 优先级：端点 > 中点 > 圆心；各层均在 tolMm 内取最近。
 */
export interface GeometrySnapResult {
  point: Point2D;
  kind: 'endpoint' | 'midpoint' | 'center';
  shapeName: string;
}

export function findGeometrySnap(
  ptMm: Point2D,
  shapes: CadShape[],
  tolMm: number,
): GeometrySnapResult | null {
  if (tolMm <= 0) return null;

  const nearest = (
    candidates: { point: Point2D; shapeName: string }[],
  ): { point: Point2D; shapeName: string; dist: number } | null => {
    let best: { point: Point2D; shapeName: string; dist: number } | null = null;
    for (const c of candidates) {
      const d = Math.hypot(c.point.x - ptMm.x, c.point.y - ptMm.y);
      if (d <= tolMm && (best === null || d < best.dist)) {
        best = { ...c, dist: d };
      }
    }
    return best;
  };

  const pointHit = nearest(shapes.filter((s) => s.visible && s.type === 'point' && s.points.length === 1)
    .map((s) => ({ point: s.points[0], shapeName: s.name })));
  if (pointHit) return { point: pointHit.point, kind: 'endpoint', shapeName: pointHit.shapeName };
  const active = shapes.filter((s) => s.visible && s.type !== 'point' && s.points.length >= 2);

  // 1. 端点（含孔顶点）
  const endpointHit = nearest(
    active.flatMap((s) => {
      // A line wall keeps its centerline endpoints at the two end-cap midpoints.
      // Its four outline corners are not the endpoints selected while drawing LINE.
      const pts = s.type === 'line' && s.points.length === 4
        ? [{ x: (s.points[0].x + s.points[3].x) / 2, y: (s.points[0].y + s.points[3].y) / 2 },
          { x: (s.points[1].x + s.points[2].x) / 2, y: (s.points[1].y + s.points[2].y) / 2 }]
        : s.type === 'circle' ? [] : s.holePoints ? [...s.points, ...s.holePoints] : s.points;
      return pts.map((p) => ({ point: p, shapeName: s.name }));
    }),
  );
  if (endpointHit) {
    return { point: endpointHit.point, kind: 'endpoint', shapeName: endpointHit.shapeName };
  }

  // 2. 边中点
  const midpointHit = nearest(
    active.flatMap((s) => s.type === 'circle' ? [] : s.type === 'segment' || (s.type === 'line' && s.points.length === 4)
      ? [{ point: { x: s.points.reduce((sum, p) => sum + p.x, 0) / s.points.length, y: s.points.reduce((sum, p) => sum + p.y, 0) / s.points.length }, shapeName: s.name }]
      : s.points.map((a, i) => {
        const b = s.points[(i + 1) % s.points.length];
        return {
          point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          shapeName: s.name,
        };
      }),
    ),
  );
  if (midpointHit) {
    return { point: midpointHit.point, kind: 'midpoint', shapeName: midpointHit.shapeName };
  }

  // 3. 圆心/中心（bounds 质心）
  const centerHit = nearest(
    active.map((s) => {
      return { point: { x: s.points.reduce((sum, p) => sum + p.x, 0) / s.points.length,
        y: s.points.reduce((sum, p) => sum + p.y, 0) / s.points.length }, shapeName: s.name };
    }),
  );
  if (centerHit) {
    return { point: centerHit.point, kind: 'center', shapeName: centerHit.shapeName };
  }

  return null;
}

/**
 * Snap a scalar coordinate value to the nearest grid increment.
 */
export function snapToGrid(value: number, gridStep: number, enabled = true): number {
  if (!enabled || gridStep <= 0) {
    return value;
  }
  return Math.round(value / gridStep) * gridStep;
}

/**
 * Compute signed area of a 2D polygon on XY plane.
 */
export function computeSignedPolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    sum += curr.x * next.y - next.x * curr.y;
  }
  return sum / 2;
}

/**
 * Compute unsigned area of a 2D polygon on XY plane (in mm^2).
 */
export function computePolygonArea(points: Point2D[]): number {
  return Math.abs(computeSignedPolygonArea(points));
}

/** Validate the closed face drawn by the polygon tool before extrusion. */
export function validateClosedPolygonPoints(points: Point2D[]): string | null {
  if (points.length < 3) return '至少指定 3 个不同顶点才能形成闭合面。';
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return '顶点坐标必须为有限数值。';
  if (new Set(points.map((p) => `${p.x},${p.y}`)).size !== points.length) return '轮廓含重复顶点，请撤回后重新指定。';
  const cross = (a: Point2D, b: Point2D, c: Point2D) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a: Point2D, b: Point2D, p: Point2D) => cross(a, b, p) === 0
    && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], next = points[(i + 2) % points.length];
    if (cross(a, b, next) === 0 && (b.x - a.x) * (next.x - b.x) + (b.y - a.y) * (next.y - b.y) < 0) return '相邻边回折重叠，请撤回后重新指定。';
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      if (((abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0))
        || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return '轮廓自交或自接触，请撤回后重新指定。';
    }
  }
  const area = points.reduce((sum, p, i) => sum + cross(points[0], p, points[(i + 1) % points.length]), 0);
  return !Number.isFinite(area) || area === 0 ? '轮廓面积为零，请指定不共线的顶点。' : null;
}

/**
 * Ensure polygon vertices wind counter-clockwise (CCW) or clockwise (CW).
 */
export function ensurePolygonWinding(points: Point2D[], ccw = true): Point2D[] {
  if (points.length < 3) return [...points];
  const signed = computeSignedPolygonArea(points);
  const isCcw = signed > 0;
  if (isCcw === ccw) return [...points];
  return [...points].reverse();
}

/**
 * Compute perimeter of a closed 2D polygon on XY plane (in mm).
 */
export function computePolygonPerimeter(points: Point2D[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    total += Math.hypot(next.x - curr.x, next.y - curr.y);
  }
  return total;
}

/**
 * Compute geometric centroid and bounding box of 2D points.
 */
export function computeBounds2D(points: Point2D[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  widthX: number;
  depthY: number;
  centroid: Point2D;
} {
  if (points.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      widthX: 0,
      depthY: 0,
      centroid: { x: 0, y: 0 },
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    sumX += p.x;
    sumY += p.y;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    widthX: Math.max(0, maxX - minX),
    depthY: Math.max(0, maxY - minY),
    centroid: {
      x: Math.round((sumX / points.length) * 100) / 100,
      y: Math.round((sumY / points.length) * 100) / 100,
    },
  };
}

/**
 * Calculate comprehensive 2D & 3D engineering metrics for a CadShape.
 */
export function computeShapeMetrics(shape: CadShape): ShapeMetrics {
  if (shape.type === 'point' || shape.type === 'segment') {
    const bounds = computeBounds2D(shape.points);
    const length = shape.type === 'segment' && shape.points.length === 2
      ? Math.hypot(shape.points[1].x - shape.points[0].x, shape.points[1].y - shape.points[0].y) : 0;
    return { areaMm2: 0, perimeterMm: length, volumeMm3: 0, volumeCm3: 0, weightGrams: 0,
      widthX: bounds.widthX, depthY: bounds.depthY, heightZ: 0,
      minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY,
      minZ: shape.zOffset, maxZ: shape.zOffset,
      centroid: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } };
  }
  const outerArea = computePolygonArea(shape.points);
  const holeArea =
    shape.holePoints && shape.holePoints.length >= 3
      ? computePolygonArea(shape.holePoints)
      : 0;
  const netAreaMm2 = Math.max(0, outerArea - holeArea);
  const outerPerimeter = computePolygonPerimeter(shape.points);
  const holePerimeter =
    shape.holePoints && shape.holePoints.length >= 3
      ? computePolygonPerimeter(shape.holePoints)
      : 0;
  const perimeterMm = outerPerimeter + holePerimeter;

  const heightZ = Math.max(0.1, shape.zHeight);
  const volumeMm3 = netAreaMm2 * heightZ;
  const volumeCm3 = volumeMm3 / 1000;

  const preset = MATERIAL_PRESETS[shape.materialPreset] ?? MATERIAL_PRESETS.aluminum;
  const weightGrams = volumeCm3 * preset.densityGPerCm3;

  const bounds2d = computeBounds2D(shape.points);
  const minZ = shape.zOffset;
  const maxZ = shape.zOffset + heightZ;

  return {
    areaMm2: Math.round(netAreaMm2 * 100) / 100,
    perimeterMm: Math.round(perimeterMm * 100) / 100,
    volumeMm3: Math.round(volumeMm3 * 10) / 10,
    volumeCm3: Math.round(volumeCm3 * 100) / 100,
    weightGrams: Math.round(weightGrams * 100) / 100,
    widthX: Math.round(bounds2d.widthX * 100) / 100,
    depthY: Math.round(bounds2d.depthY * 100) / 100,
    heightZ: Math.round(heightZ * 100) / 100,
    minX: bounds2d.minX,
    maxX: bounds2d.maxX,
    minY: bounds2d.minY,
    maxY: bounds2d.maxY,
    minZ,
    maxZ,
    centroid: bounds2d.centroid,
  };
}

export interface CadEdgeDimension {
  edgeIndex: number;
  start: Point2D;
  end: Point2D;
  midpoint: Point2D;
  lengthMm: number;
  angleDeg: number;
  /** Outward-pointing unit normal vector in XY plane */
  outwardNormal: Point2D;
}

export interface CadShapeDimensionSummary {
  shapeId: string;
  shapeName: string;
  shapeType: ShapeType;
  isLineFeature: boolean;
  /** For 'line' shapes: centerline length; for other shapes: perimeter */
  primaryLengthMm: number;
  lineStart?: Point2D;
  lineEnd?: Point2D;
  thicknessMm?: number;
  radiusMm?: number;
  diameterMm?: number;
  areaMm2: number;
  perimeterMm: number;
  widthX: number;
  depthY: number;
  centroid: Point2D;
  edges: CadEdgeDimension[];
}

/**
 * Compute shortest distance from point P to segment AB in 2D XY plane.
 */
export function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Compute CAD-style 2D dimension annotations (edge lengths, outward normals, centerline length for lines,
 * diameter/radius for circles, and exact area/perimeter) for a shape.
 */
export function computeShapeDimensions(shape: CadShape): CadShapeDimensionSummary {
  const metrics = computeShapeMetrics(shape);
  const pts = shape.points;
  const signedArea = computeSignedPolygonArea(pts);
  // For CCW polygon (signedArea >= 0), outward normal of edge (dx, dy) is (dy, -dx) / len
  const windingSign = signedArea >= 0 ? 1 : -1;

  const edges: CadEdgeDimension[] = [];
  if (pts.length >= 2) {
    for (let i = 0; i < (shape.type === 'segment' ? 1 : pts.length); i++) {
      const start = pts[i];
      const end = pts[(i + 1) % pts.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy);
      const nx = len > 1e-6 ? (dy / len) * windingSign : 0;
      const ny = len > 1e-6 ? (-dx / len) * windingSign : -1;
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      edges.push({
        edgeIndex: i,
        start,
        end,
        midpoint: {
          x: shape.type === 'segment' ? (start.x + end.x) / 2 : Math.round(((start.x + end.x) / 2) * 100) / 100,
          y: shape.type === 'segment' ? (start.y + end.y) / 2 : Math.round(((start.y + end.y) / 2) * 100) / 100,
        },
        lengthMm: shape.type === 'segment' ? len : Math.round(len * 10) / 10,
        angleDeg: Math.round(angleDeg * 10) / 10,
        outwardNormal: { x: nx, y: ny },
      });
    }
  }

  if (shape.type === 'segment' && pts.length === 2) {
    return { shapeId: shape.id, shapeName: shape.name, shapeType: shape.type, isLineFeature: true,
      primaryLengthMm: metrics.perimeterMm, lineStart: pts[0], lineEnd: pts[1], thicknessMm: 0,
      areaMm2: 0, perimeterMm: metrics.perimeterMm, widthX: metrics.widthX, depthY: metrics.depthY,
      centroid: metrics.centroid, edges };
  }

  // Special handling for 'line' wall (4-vertex extruded segment)
  if (shape.type === 'line' && pts.length === 4 && edges.length === 4) {
    // Vertex order comes from createLineWallPoints, even when length < thickness.
    const lineStart = { x: (pts[0].x + pts[3].x) / 2, y: (pts[0].y + pts[3].y) / 2 };
    const lineEnd = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
    const primaryLengthMm = Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y);
    const thicknessMm = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y);

    return {
      shapeId: shape.id,
      shapeName: shape.name,
      shapeType: shape.type,
      isLineFeature: true,
      primaryLengthMm,
      lineStart,
      lineEnd,
      thicknessMm,
      areaMm2: metrics.areaMm2,
      perimeterMm: metrics.perimeterMm,
      widthX: metrics.widthX,
      depthY: metrics.depthY,
      centroid: metrics.centroid,
      edges,
    };
  }

  // Special handling for 'circle'
  if (shape.type === 'circle') {
    const bounds = computeBounds2D(pts);
    const diameterMm = (bounds.widthX + bounds.depthY) / 2;
    const radiusMm = diameterMm / 2;
    return {
      shapeId: shape.id,
      shapeName: shape.name,
      shapeType: shape.type,
      isLineFeature: false,
      primaryLengthMm: metrics.perimeterMm,
      radiusMm,
      diameterMm,
      areaMm2: metrics.areaMm2,
      perimeterMm: metrics.perimeterMm,
      widthX: metrics.widthX,
      depthY: metrics.depthY,
      centroid: metrics.centroid,
      edges,
    };
  }

  return {
    shapeId: shape.id,
    shapeName: shape.name,
    shapeType: shape.type,
    isLineFeature: false,
    primaryLengthMm: metrics.perimeterMm,
    areaMm2: metrics.areaMm2,
    perimeterMm: metrics.perimeterMm,
    widthX: metrics.widthX,
    depthY: metrics.depthY,
    centroid: metrics.centroid,
    edges,
  };
}

/**
 * Find the closest shape edge within maxDistMm of a 2D point on the XY canvas.
 */
export function findClosestShapeEdge(
  ptMm: Point2D,
  shapes: CadShape[],
  maxDistMm = 4,
): { shapeId: string; edgeIndex: number; distanceMm: number; edge: CadEdgeDimension } | null {
  let best: { shapeId: string; edgeIndex: number; distanceMm: number; edge: CadEdgeDimension } | null =
    null;

  for (let sIdx = shapes.length - 1; sIdx >= 0; sIdx--) {
    const shape = shapes[sIdx];
    if (!shape.visible || shape.points.length < 2) continue;
    const dim = computeShapeDimensions(shape);
    for (const edge of dim.edges) {
      const dist = pointToSegmentDistance(ptMm, edge.start, edge.end);
      if (dist <= maxDistMm && (!best || dist < best.distanceMm)) {
        best = {
          shapeId: shape.id,
          edgeIndex: edge.edgeIndex,
          distanceMm: Math.round(dist * 100) / 100,
          edge,
        };
      }
    }
  }

  return best;
}

export interface SmartSnapGuide {
  axis: 'x' | 'y';
  /** Coordinate on the snapped axis in mm (X for vertical line, Y for horizontal line) */
  valueMm: number;
  /** Start of the alignment line segment in mm */
  startMm: Point2D;
  /** End of the alignment line segment in mm */
  endMm: Point2D;
  /** Snapped anchor point on the active shape/cursor */
  activeAnchorPt: Point2D;
  /** Reference anchor point on the target shape/origin */
  targetAnchorPt: Point2D;
  activeAnchorLabel: string;
  targetShapeId: string;
  targetShapeName: string;
  targetAnchorLabel: string;
  /** Human-readable CAD alignment badge text */
  label: string;
}

interface AxisReferenceAnchor {
  value: number;
  perpCoord: number;
  perpMin: number;
  perpMax: number;
  anchorLabel: string;
  shapeId: string;
  shapeName: string;
}

function collectSceneReferenceAnchors(
  allShapes: CadShape[],
  excludeShapeId: string | null,
): { xAnchors: AxisReferenceAnchor[]; yAnchors: AxisReferenceAnchor[] } {
  const xAnchors: AxisReferenceAnchor[] = [
    {
      value: 0,
      perpCoord: 0,
      perpMin: -10,
      perpMax: 10,
      anchorLabel: '原点Y轴',
      shapeId: 'origin',
      shapeName: '原点(0,0)',
    },
  ];
  const yAnchors: AxisReferenceAnchor[] = [
    {
      value: 0,
      perpCoord: 0,
      perpMin: -10,
      perpMax: 10,
      anchorLabel: '原点X轴',
      shapeId: 'origin',
      shapeName: '原点(0,0)',
    },
  ];

  for (const s of allShapes) {
    if (!s.visible || s.points.length < 1 || s.id === excludeShapeId) continue;
    if (s.type === 'point' || s.type === 'segment') {
      const references = s.type === 'segment' ? [...s.points, { x: (s.points[0].x + s.points[1].x) / 2, y: (s.points[0].y + s.points[1].y) / 2 }] : s.points;
      for (const point of references) {
        xAnchors.push({ value: point.x, perpCoord: point.y, perpMin: point.y, perpMax: point.y, anchorLabel: '定位点', shapeId: s.id, shapeName: s.name });
        yAnchors.push({ value: point.y, perpCoord: point.x, perpMin: point.x, perpMax: point.x, anchorLabel: '定位点', shapeId: s.id, shapeName: s.name });
      }
      continue;
    }
    const b = computeBounds2D(s.points);
    const cleanName = s.name.replace(/\s*\(.*\)/, '');

    xAnchors.push(
      {
        value: Math.round(b.minX * 100) / 100,
        perpCoord: b.centroid.y,
        perpMin: b.minY,
        perpMax: b.maxY,
        anchorLabel: '左边缘',
        shapeId: s.id,
        shapeName: cleanName,
      },
      {
        value: Math.round(b.centroid.x * 100) / 100,
        perpCoord: b.centroid.y,
        perpMin: b.minY,
        perpMax: b.maxY,
        anchorLabel: '中心X',
        shapeId: s.id,
        shapeName: cleanName,
      },
      {
        value: Math.round(b.maxX * 100) / 100,
        perpCoord: b.centroid.y,
        perpMin: b.minY,
        perpMax: b.maxY,
        anchorLabel: '右边缘',
        shapeId: s.id,
        shapeName: cleanName,
      },
    );

    yAnchors.push(
      {
        value: Math.round(b.minY * 100) / 100,
        perpCoord: b.centroid.x,
        perpMin: b.minX,
        perpMax: b.maxX,
        anchorLabel: '底边缘',
        shapeId: s.id,
        shapeName: cleanName,
      },
      {
        value: Math.round(b.centroid.y * 100) / 100,
        perpCoord: b.centroid.x,
        perpMin: b.minX,
        perpMax: b.maxX,
        anchorLabel: '中心Y',
        shapeId: s.id,
        shapeName: cleanName,
      },
      {
        value: Math.round(b.maxY * 100) / 100,
        perpCoord: b.centroid.x,
        perpMin: b.minX,
        perpMax: b.maxX,
        anchorLabel: '顶边缘',
        shapeId: s.id,
        shapeName: cleanName,
      },
    );
  }

  return { xAnchors, yAnchors };
}

/**
 * Compute dynamic smart snap alignment guides and snapped coordinates when moving a shape relative to other objects.
 */
export function computeMoveSnapGuides(
  candidatePoints: Point2D[],
  activeShapeId: string,
  allShapes: CadShape[],
  toleranceMm = 2.5,
  enabled = true,
): {
  snappedDelta: Point2D;
  snappedPoints: Point2D[];
  guides: SmartSnapGuide[];
} {
  if (!enabled || candidatePoints.length === 0) {
    return {
      snappedDelta: { x: 0, y: 0 },
      snappedPoints: candidatePoints,
      guides: [],
    };
  }

  const activeBounds = computeBounds2D(candidatePoints);
  const { xAnchors, yAnchors } = collectSceneReferenceAnchors(allShapes, activeShapeId);

  const activeXCandidates = [
    { value: activeBounds.minX, label: '左边缘' },
    { value: activeBounds.centroid.x, label: '中心X' },
    { value: activeBounds.maxX, label: '右边缘' },
  ];

  const activeYCandidates = [
    { value: activeBounds.minY, label: '底边缘' },
    { value: activeBounds.centroid.y, label: '中心Y' },
    { value: activeBounds.maxY, label: '顶边缘' },
  ];

  let bestXMatch: {
    diff: number;
    delta: number;
    activeLabel: string;
    ref: AxisReferenceAnchor;
  } | null = null;

  for (const act of activeXCandidates) {
    for (const ref of xAnchors) {
      const diff = Math.abs(act.value - ref.value);
      if (diff <= toleranceMm && (!bestXMatch || diff < bestXMatch.diff)) {
        bestXMatch = {
          diff,
          delta: ref.value - act.value,
          activeLabel: act.label,
          ref,
        };
      }
    }
  }

  let bestYMatch: {
    diff: number;
    delta: number;
    activeLabel: string;
    ref: AxisReferenceAnchor;
  } | null = null;

  for (const act of activeYCandidates) {
    for (const ref of yAnchors) {
      const diff = Math.abs(act.value - ref.value);
      if (diff <= toleranceMm && (!bestYMatch || diff < bestYMatch.diff)) {
        bestYMatch = {
          diff,
          delta: ref.value - act.value,
          activeLabel: act.label,
          ref,
        };
      }
    }
  }

  const snapDx = bestXMatch?.delta ?? 0;
  const snapDy = bestYMatch?.delta ?? 0;

  const snappedPoints = candidatePoints.map((p) => ({
    x: p.x + snapDx,
    y: p.y + snapDy,
  }));

  const finalBounds = computeBounds2D(snappedPoints);
  const guides: SmartSnapGuide[] = [];

  if (bestXMatch) {
    const xVal = bestXMatch.ref.value;
    const minY = Math.min(finalBounds.minY, bestXMatch.ref.perpMin) - 8;
    const maxY = Math.max(finalBounds.maxY, bestXMatch.ref.perpMax) + 8;
    guides.push({
      axis: 'x',
      valueMm: xVal,
      startMm: { x: xVal, y: minY },
      endMm: { x: xVal, y: maxY },
      activeAnchorPt: { x: xVal, y: finalBounds.centroid.y },
      targetAnchorPt: { x: xVal, y: bestXMatch.ref.perpCoord },
      activeAnchorLabel: bestXMatch.activeLabel,
      targetShapeId: bestXMatch.ref.shapeId,
      targetShapeName: bestXMatch.ref.shapeName,
      targetAnchorLabel: bestXMatch.ref.anchorLabel,
      label: `X=${xVal}mm (${bestXMatch.activeLabel} ↔ ${bestXMatch.ref.shapeName}${bestXMatch.ref.anchorLabel})`,
    });
  }

  if (bestYMatch) {
    const yVal = bestYMatch.ref.value;
    const minX = Math.min(finalBounds.minX, bestYMatch.ref.perpMin) - 8;
    const maxX = Math.max(finalBounds.maxX, bestYMatch.ref.perpMax) + 8;
    guides.push({
      axis: 'y',
      valueMm: yVal,
      startMm: { x: minX, y: yVal },
      endMm: { x: maxX, y: yVal },
      activeAnchorPt: { x: finalBounds.centroid.x, y: yVal },
      targetAnchorPt: { x: bestYMatch.ref.perpCoord, y: yVal },
      activeAnchorLabel: bestYMatch.activeLabel,
      targetShapeId: bestYMatch.ref.shapeId,
      targetShapeName: bestYMatch.ref.shapeName,
      targetAnchorLabel: bestYMatch.ref.anchorLabel,
      label: `Y=${yVal}mm (${bestYMatch.activeLabel} ↔ ${bestYMatch.ref.shapeName}${bestYMatch.ref.anchorLabel})`,
    });
  }

  return {
    snappedDelta: { x: snapDx, y: snapDy },
    snappedPoints,
    guides,
  };
}

/**
 * Compute dynamic smart snap alignment guides when dragging a single vertex (resizing) or drawing a shape.
 */
export function computePointSnapGuides(
  candidatePt: Point2D,
  activeShapeId: string | null,
  allShapes: CadShape[],
  toleranceMm = 2.5,
  enabled = true,
  excludeVertexIdx?: number,
): {
  snappedPt: Point2D;
  guides: SmartSnapGuide[];
} {
  if (!enabled) {
    return { snappedPt: candidatePt, guides: [] };
  }

  const { xAnchors, yAnchors } = collectSceneReferenceAnchors(allShapes, activeShapeId);

  // Also include other vertices of the active shape (when resizing a vertex) so edges can snap orthogonal
  if (activeShapeId && excludeVertexIdx !== undefined) {
    const activeShape = allShapes.find((s) => s.id === activeShapeId);
    if (activeShape && activeShape.points.length <= 16) {
      const cleanName = activeShape.name.replace(/\s*\(.*\)/, '');
      activeShape.points.forEach((pt, idx) => {
        if (idx === excludeVertexIdx) return;
        xAnchors.push({
          value: pt.x,
          perpCoord: pt.y,
          perpMin: pt.y,
          perpMax: pt.y,
          anchorLabel: `顶点${idx + 1}`,
          shapeId: activeShape.id,
          shapeName: cleanName,
        });
        yAnchors.push({
          value: pt.y,
          perpCoord: pt.x,
          perpMin: pt.x,
          perpMax: pt.x,
          anchorLabel: `顶点${idx + 1}`,
          shapeId: activeShape.id,
          shapeName: cleanName,
        });
      });
    }
  }

  let bestX: { diff: number; ref: AxisReferenceAnchor } | null = null;
  for (const ref of xAnchors) {
    const diff = Math.abs(candidatePt.x - ref.value);
    if (diff <= toleranceMm && (!bestX || diff < bestX.diff)) {
      bestX = { diff, ref };
    }
  }

  let bestY: { diff: number; ref: AxisReferenceAnchor } | null = null;
  for (const ref of yAnchors) {
    const diff = Math.abs(candidatePt.y - ref.value);
    if (diff <= toleranceMm && (!bestY || diff < bestY.diff)) {
      bestY = { diff, ref };
    }
  }

  const finalX = bestX?.ref.value ?? candidatePt.x;
  const finalY = bestY?.ref.value ?? candidatePt.y;
  const guides: SmartSnapGuide[] = [];

  if (bestX) {
    const minY = Math.min(finalY, bestX.ref.perpMin) - 8;
    const maxY = Math.max(finalY, bestX.ref.perpMax) + 8;
    guides.push({
      axis: 'x',
      valueMm: finalX,
      startMm: { x: finalX, y: minY },
      endMm: { x: finalX, y: maxY },
      activeAnchorPt: { x: finalX, y: finalY },
      targetAnchorPt: { x: finalX, y: bestX.ref.perpCoord },
      activeAnchorLabel: '当前点',
      targetShapeId: bestX.ref.shapeId,
      targetShapeName: bestX.ref.shapeName,
      targetAnchorLabel: bestX.ref.anchorLabel,
      label: `X=${finalX}mm (对齐 ${bestX.ref.shapeName}${bestX.ref.anchorLabel})`,
    });
  }

  if (bestY) {
    const minX = Math.min(finalX, bestY.ref.perpMin) - 8;
    const maxX = Math.max(finalX, bestY.ref.perpMax) + 8;
    guides.push({
      axis: 'y',
      valueMm: finalY,
      startMm: { x: minX, y: finalY },
      endMm: { x: maxX, y: finalY },
      activeAnchorPt: { x: finalX, y: finalY },
      targetAnchorPt: { x: bestY.ref.perpCoord, y: finalY },
      activeAnchorLabel: '当前点',
      targetShapeId: bestY.ref.shapeId,
      targetShapeName: bestY.ref.shapeName,
      targetAnchorLabel: bestY.ref.anchorLabel,
      label: `Y=${finalY}mm (对齐 ${bestY.ref.shapeName}${bestY.ref.anchorLabel})`,
    });
  }

  return {
    snappedPt: { x: finalX, y: finalY },
    guides,
  };
}

export type BoxSelectMode = 'window' | 'crossing';

/**
 * Check if two 2D line segments A1-A2 and B1-B2 intersect.
 */
export function doSegmentsIntersect(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
): boolean {
  const ccw = (p1: Point2D, p2: Point2D, p3: Point2D) =>
    (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return (
    ccw(a1, b1, b2) !== ccw(a2, b1, b2) &&
    ccw(a1, a2, b1) !== ccw(a1, a2, b2)
  );
}

function isPointInsidePolygon2D(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * AutoCAD-style Marquee Box Selection:
 * - Left-to-Right drag (endMm.x >= startMm.x) => 'window' mode (solid box): selects shapes 100% inside the box.
 * - Right-to-Left drag (endMm.x < startMm.x) => 'crossing' mode (dashed box): selects shapes that touch or are inside the box.
 */
export function computeBoxSelectedShapeIds(
  startMm: Point2D,
  endMm: Point2D,
  shapes: CadShape[],
): {
  mode: BoxSelectMode;
  selectedIds: string[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
} {
  const mode: BoxSelectMode = endMm.x >= startMm.x ? 'window' : 'crossing';
  const minX = Math.min(startMm.x, endMm.x);
  const maxX = Math.max(startMm.x, endMm.x);
  const minY = Math.min(startMm.y, endMm.y);
  const maxY = Math.max(startMm.y, endMm.y);

  const boxCorners: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  const isPointInBox = (p: Point2D) =>
    p.x >= minX - 1e-6 &&
    p.x <= maxX + 1e-6 &&
    p.y >= minY - 1e-6 &&
    p.y <= maxY + 1e-6;

  const selectedIds: string[] = [];

  for (const shape of shapes) {
    if (!shape.visible || shape.points.length < 1) continue;
    if (shape.type === 'point') {
      if (shape.points.length === 1 && isPointInBox(shape.points[0])) selectedIds.push(shape.id);
      continue;
    }

    if (mode === 'window') {
      // Every vertex of the shape must be inside the selection window
      if (shape.points.every(isPointInBox)) {
        selectedIds.push(shape.id);
      }
    } else {
      // Crossing mode:
      // 1) Any vertex of the shape is inside the box
      if (shape.points.some(isPointInBox)) {
        selectedIds.push(shape.id);
        continue;
      }
      // 2) Any corner of the box is inside the shape polygon
      if (shape.type !== 'segment' && boxCorners.some((c) => isPointInsidePolygon2D(c, shape.points))) {
        selectedIds.push(shape.id);
        continue;
      }
      // 3) Any edge of the shape intersects any of the 4 edges of the selection box
      let edgeCrossed = false;
      for (let i = 0; i < (shape.type === 'segment' ? 1 : shape.points.length) && !edgeCrossed; i++) {
        const sA = shape.points[i];
        const sB = shape.points[(i + 1) % shape.points.length];
        for (let b = 0; b < 4; b++) {
          const bA = boxCorners[b];
          const bB = boxCorners[(b + 1) % 4];
          if (doSegmentsIntersect(sA, sB, bA, bB)) {
            edgeCrossed = true;
            break;
          }
        }
      }
      if (edgeCrossed) {
        selectedIds.push(shape.id);
      }
    }
  }

  return {
    mode,
    selectedIds,
    bounds: { minX, maxX, minY, maxY },
  };
}

/**
 * Translate multiple shapes by (dx, dy) simultaneously.
 */
export function translateMultipleShapes2D(
  shapes: CadShape[],
  targetIds: string[],
  dx: number,
  dy: number,
): CadShape[] {
  const idSet = new Set(targetIds);
  return shapes.map((s) => (idSet.has(s.id) && !s.locked ? translateShape2D(s, dx, dy) : s));
}

/**
 * Compute aggregate metrics for the entire CAD scene.
 */
export function computeSceneMetrics(shapes: CadShape[]): SceneMetrics {
  const visibleShapes = shapes.filter((s) => s.visible && (s.type === 'point' ? s.points.length === 1 : s.type === 'segment' ? s.points.length === 2 : s.points.length >= 3));
  if (visibleShapes.length === 0) {
    return {
      visibleCount: 0,
      totalCount: shapes.length,
      totalVolumeCm3: 0,
      totalWeightGrams: 0,
      totalVertices2D: 0,
      bounds: { widthX: 0, depthY: 0, heightZ: 0 },
    };
  }

  let totalVolumeCm3 = 0;
  let totalWeightGrams = 0;
  let totalVertices2D = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const s of visibleShapes) {
    const m = computeShapeMetrics(s);
    totalVolumeCm3 += m.volumeCm3;
    totalWeightGrams += m.weightGrams;
    totalVertices2D += s.points.length + (s.holePoints?.length ?? 0);
    if (m.minX < minX) minX = m.minX;
    if (m.maxX > maxX) maxX = m.maxX;
    if (m.minY < minY) minY = m.minY;
    if (m.maxY > maxY) maxY = m.maxY;
    if (m.minZ < minZ) minZ = m.minZ;
    if (m.maxZ > maxZ) maxZ = m.maxZ;
  }

  return {
    visibleCount: visibleShapes.length,
    totalCount: shapes.length,
    totalVolumeCm3: Math.round(totalVolumeCm3 * 100) / 100,
    totalWeightGrams: Math.round(totalWeightGrams * 100) / 100,
    totalVertices2D,
    bounds: {
      widthX: Math.round(Math.max(0, maxX - minX) * 100) / 100,
      depthY: Math.round(Math.max(0, maxY - minY) * 100) / 100,
      heightZ: Math.round(Math.max(0, maxZ - minZ) * 100) / 100,
    },
  };
}

/**
 * Helper to generate regular N-gon or circle points in XY plane.
 */
export function createRegularPolygonPoints(
  centerX: number,
  centerY: number,
  radius: number,
  segments = 24,
  startAngleRad = 0,
): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = startAngleRad + (i / segments) * Math.PI * 2;
    pts.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  }
  return pts;
}

/**
 * Helper to generate rectangle points in XY plane.
 */
export function createRectanglePoints(
  centerX: number,
  centerY: number,
  width: number,
  depth: number,
): Point2D[] {
  const hw = width / 2;
  const hd = depth / 2;
  return [
    { x: centerX - hw, y: centerY - hd },
    { x: centerX + hw, y: centerY - hd },
    { x: centerX + hw, y: centerY + hd },
    { x: centerX - hw, y: centerY + hd },
  ];
}

/**
 * Helper to generate triangle points in XY plane.
 */
export function createTrianglePoints(
  centerX: number,
  centerY: number,
  width: number,
  depth: number,
): Point2D[] {
  const hw = width / 2;
  const hd = depth / 2;
  return [
    { x: centerX - hw, y: centerY - hd },
    { x: centerX + hw, y: centerY - hd },
    { x: centerX, y: centerY + hd },
  ];
}

/**
 * Helper to convert a 2-point CAD straight line segment into a 2D wall polygon with thickness
 * so it can be extruded along the Z axis into a 3D wall/bar.
 */
export function createLineWallPoints(
  p1: Point2D,
  p2: Point2D,
  thickness = 6,
): Point2D[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len === 0 || !Number.isFinite(thickness) || thickness <= 0) return [];
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  return [
    { x: p1.x + nx, y: p1.y + ny },
    { x: p2.x + nx, y: p2.y + ny },
    { x: p2.x - nx, y: p2.y - ny },
    { x: p1.x - nx, y: p1.y - ny },
  ];
}

/**
 * Translate a shape's 2D XY points (and optional hole points) by dx, dy.
 */
export type AlignMode =
  | 'left'
  | 'centerX'
  | 'right'
  | 'bottom'
  | 'centerY'
  | 'top'
  | 'zBottom'
  | 'zTop'
  | 'zStack';

export const ALIGN_MODE_LABELS: Record<AlignMode, string> = {
  left: 'X 左对齐',
  centerX: 'X 居中对齐',
  right: 'X 右对齐',
  bottom: 'Y 底对齐',
  centerY: 'Y 居中对齐',
  top: 'Y 顶对齐',
  zBottom: 'Z 底面共面',
  zTop: 'Z 顶面共面',
  zStack: 'Z 叠放到首个顶面',
};

/**
 * 多实体装配对齐：以 ids[0]（首个选中图形）为基准，
 * 把其余选中图形在 XY 平面对齐，或在 Z 方向共面/叠放。
 * 隐藏与锁定的图形不参与。返回新数组（无改动时原样返回）。
 */
export function alignShapes2D(
  shapes: CadShape[],
  ids: string[],
  mode: AlignMode,
): CadShape[] {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const movable = [...new Set(ids)].map((id) => byId.get(id)).filter(
    (shape): shape is CadShape => Boolean(shape?.visible && !shape.locked),
  );
  if (movable.length < 2) return shapes;

  const ref = movable[0];
  const refBounds = computeBounds2D(ref.points);
  const refSet = new Set(movable.map((s) => s.id));

  return shapes.map((s) => {
    if (!refSet.has(s.id) || s.id === ref.id) return s;
    const b = computeBounds2D(s.points);
    switch (mode) {
      case 'left':
        return translateShape2D(s, refBounds.minX - b.minX, 0);
      case 'centerX':
        return translateShape2D(s, refBounds.centroid.x - b.centroid.x, 0);
      case 'right':
        return translateShape2D(s, refBounds.maxX - b.maxX, 0);
      case 'bottom':
        return translateShape2D(s, 0, refBounds.minY - b.minY);
      case 'centerY':
        return translateShape2D(s, 0, refBounds.centroid.y - b.centroid.y);
      case 'top':
        return translateShape2D(s, 0, refBounds.maxY - b.maxY);
      case 'zBottom':
        return { ...s, zOffset: ref.zOffset };
      case 'zTop':
        return {
          ...s,
          zOffset:
            Math.round((ref.zOffset + ref.zHeight - s.zHeight) * 100) / 100,
        };
      case 'zStack':
        return {
          ...s,
          zOffset: Math.round((ref.zOffset + ref.zHeight) * 100) / 100,
        };
      default:
        return s;
    }
  });
}

/**
 * 镜像 2D 点集：axis='x' 绕竖直轴线 x=pivot 左右翻转；axis='y' 绕水平轴线 y=pivot 上下翻转。
 * 镜像会反转多边形环绕方向，这里恢复原始方向，保证面积/布尔等下游计算一致。
 */
export function mirrorPoints2D(
  points: Point2D[],
  axis: 'x' | 'y',
  pivotMm: number,
): Point2D[] {
  const mirrored = points.map((p) =>
    axis === 'x'
      ? { x: Math.round((2 * pivotMm - p.x) * 100) / 100, y: p.y }
      : { x: p.x, y: Math.round((2 * pivotMm - p.y) * 100) / 100 },
  );
  return ensurePolygonWinding(mirrored, computeSignedPolygonArea(points) >= 0);
}

/** 镜像整个图形（含内孔） */
export function mirrorShape2D(
  shape: CadShape,
  axis: 'x' | 'y',
  pivotMm: number,
): CadShape {
  return {
    ...shape,
    points: mirrorPoints2D(shape.points, axis, pivotMm),
    holePoints: shape.holePoints
      ? mirrorPoints2D(shape.holePoints, axis, pivotMm)
      : undefined,
  };
}

/** 绕任意中心旋转 2D 图形（角度制，逆时针为正） */
export function rotateShape2D(
  shape: CadShape,
  center: Point2D,
  angleDeg: number,
): CadShape {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (p: Point2D): Point2D => ({
    x:
      Math.round(
        (center.x + (p.x - center.x) * cos - (p.y - center.y) * sin) * 100,
      ) / 100,
    y:
      Math.round(
        (center.y + (p.x - center.x) * sin + (p.y - center.y) * cos) * 100,
      ) / 100,
  });
  return {
    ...shape,
    points: shape.points.map(rot),
    holePoints: shape.holePoints?.map(rot),
  };
}

export interface RectArrayOptions {
  /** 行数（Y 方向），1-20 */
  rows: number;
  /** 列数（X 方向），1-20 */
  cols: number;
  /** 副本间 X 边缘间距 mm */
  gapX: number;
  /** 副本间 Y 边缘间距 mm */
  gapY: number;
}

export interface PolarArrayOptions {
  /** 总数量（含原始图形），2-60 */
  count: number;
  /** 分布总角度（度）；360 时按数量等分整圆（首尾不重叠） */
  totalAngleDeg: number;
  /** 旋转中心 */
  center: Point2D;
}

/**
 * 矩形阵列：基于所选图形组合包围盒 + 边缘间距生成平移副本。
 * 不包含原始位置（原始图形保留在场景中），上限 200 个副本。
 */
export function createRectArrayCopies(
  shapes: CadShape[],
  opts: RectArrayOptions,
): CadShape[] {
  const rows = Math.min(20, Math.max(1, Math.round(opts.rows)));
  const cols = Math.min(20, Math.max(1, Math.round(opts.cols)));
  if (shapes.length === 0 || (rows === 1 && cols === 1)) return [];
  const allPts = shapes.flatMap((s) => s.points);
  if (allPts.length === 0) return [];
  const gb = computeBounds2D(allPts);
  const pitchX = gb.widthX + Math.max(0, opts.gapX);
  const pitchY = gb.depthY + Math.max(0, opts.gapY);
  const copies: CadShape[] = [];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      for (const t of shapes) {
        if (copies.length >= 200) return copies;
        const moved = translateShape2D(t, c * pitchX, r * pitchY);
        copies.push({
          ...moved,
          id: `shape-array-${Date.now()}-${n++}`,
          name: `${t.name.replace(/\s*\(.*\)/, '')} 阵列${r * cols + c + 1}`,
          booleanMeta: undefined,
          locked: false,
        });
      }
    }
  }
  return copies;
}

/**
 * 环形阵列：绕中心旋转生成副本（不包含原始位置）。
 * 总角度为 360 时按数量等分整圆；否则首尾副本落在起止角度上。
 */
export function createPolarArrayCopies(
  shapes: CadShape[],
  opts: PolarArrayOptions,
): CadShape[] {
  const count = Math.min(60, Math.max(2, Math.round(opts.count)));
  if (shapes.length === 0) return [];
  const fullCircle = Math.abs(Math.abs(opts.totalAngleDeg) - 360) < 0.001;
  const step = opts.totalAngleDeg / (fullCircle ? count : count - 1);
  const copies: CadShape[] = [];
  let n = 0;
  for (let k = 1; k < count; k++) {
    const angle = step * k;
    for (const t of shapes) {
      if (copies.length >= 200) return copies;
      const rotated = rotateShape2D(t, opts.center, angle);
      copies.push({
        ...rotated,
        id: `shape-polar-${Date.now()}-${n++}`,
        name: `${t.name.replace(/\s*\(.*\)/, '')} 环阵${k + 1}`,
        booleanMeta: undefined,
        locked: false,
      });
    }
  }
  return copies;
}

export function translateShape2D(shape: CadShape, dx: number, dy: number): CadShape {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return shape;
  const translate = (p: Point2D): Point2D => ({
    x: dx === 0 ? p.x : p.x + dx,
    y: dy === 0 ? p.y : p.y + dy,
  });
  const points = shape.points.map(translate);
  const holePoints = shape.holePoints?.map(translate);
  if ([...points, ...(holePoints ?? [])].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return shape;
  return { ...shape, points, holePoints };
}

/**
 * Scale a shape's 2D XY dimensions to new widthX and depthY while keeping its centroid.
 */
export function resizeShape2D(
  shape: CadShape,
  newWidthX: number,
  newDepthY: number,
): CadShape {
  if (![newWidthX, newDepthY].every((value) => Number.isFinite(value) && value > 0)) return shape;
  const bounds = computeBounds2D(shape.points);
  if (![bounds.widthX, bounds.depthY].every((value) => Number.isFinite(value) && value > 0)) return shape;
  const scaleX = newWidthX / bounds.widthX;
  const scaleY = newDepthY / bounds.depthY;
  if (![scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0) || (scaleX === 1 && scaleY === 1)) return shape;
  const cx = bounds.centroid.x;
  const cy = bounds.centroid.y;
  const resize = (p: Point2D): Point2D => ({
    x: scaleX === 1 ? p.x : cx + (p.x - cx) * scaleX,
    y: scaleY === 1 ? p.y : cy + (p.y - cy) * scaleY,
  });
  const points = shape.points.map(resize);
  const holePoints = shape.holePoints?.map(resize);
  if ([...points, ...(holePoints ?? [])].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return shape;
  return { ...shape, points, holePoints };
}

export type PrimitivePresetType =
  | 'box'
  | 'triangle'
  | 'cylinder'
  | 'line'
  | 'hex-prism'
  | 'l-bracket'
  | 'hollow-box'
  | 't-beam';

/**
 * Create a single parametric CAD shape from a primitive preset.
 */
export function createPrimitiveShape(
  preset: PrimitivePresetType,
  indexOffset = 1,
): CadShape {
  const id = `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const offsets: [number, number][] = [
    [0, 0],
    [0, 28],
    [0, -28],
    [-30, 0],
    [30, 0],
  ];
  const [shiftX, shiftY] = offsets[(indexOffset - 1) % offsets.length];
  const shift = shiftX;

  switch (preset) {
    case 'box':
      return {
        id,
        name: `方块 #${indexOffset}`,
        type: 'rect',
        points: createRectanglePoints(shiftX, shiftY, 40, 40),
        zHeight: 30,
        zOffset: 0,
        bevel: 0.8,
        color: MATERIAL_PRESETS.aluminum.defaultColor,
        materialPreset: 'aluminum',
        visible: true,
      };
    case 'triangle':
      return {
        id,
        name: `三角柱 #${indexOffset}`,
        type: 'triangle',
        points: createTrianglePoints(shiftX, shiftY, 44, 38),
        zHeight: 30,
        zOffset: 0,
        bevel: 0.8,
        color: MATERIAL_PRESETS.aluminum.defaultColor,
        materialPreset: 'aluminum',
        visible: true,
      };
    case 'cylinder':
      return {
        id,
        name: `圆柱 #${indexOffset}`,
        type: 'circle',
        points: createRegularPolygonPoints(shiftX, shiftY, 20, 32),
        zHeight: 35,
        zOffset: 0,
        bevel: 0.8,
        color: MATERIAL_PRESETS.aluminum.defaultColor,
        materialPreset: 'aluminum',
        visible: true,
      };
    case 'line':
      return {
        id,
        name: `直线墙体 #${indexOffset}`,
        type: 'line',
        points: createLineWallPoints(
          { x: -25 + shiftX, y: shiftY },
          { x: 25 + shiftX, y: shiftY },
          8,
        ),
        zHeight: 30,
        zOffset: 0,
        bevel: 0.4,
        color: MATERIAL_PRESETS.steel.defaultColor,
        materialPreset: 'steel',
        visible: true,
      };
    case 'hex-prism':
      return {
        id,
        name: `六角柱螺母 #${indexOffset}`,
        type: 'polygon',
        points: createRegularPolygonPoints(shift, shift, 24, 6, Math.PI / 6),
        holePoints: createRegularPolygonPoints(shift, shift, 10, 24),
        zHeight: 20,
        zOffset: 0,
        bevel: 1.5,
        color: MATERIAL_PRESETS.steel.defaultColor,
        materialPreset: 'steel',
        visible: true,
      };
    case 'l-bracket':
      return {
        id,
        name: `L型角铁支架 #${indexOffset}`,
        type: 'l-bracket',
        points: [
          { x: -30 + shift, y: -30 + shift },
          { x: 30 + shift, y: -30 + shift },
          { x: 30 + shift, y: -12 + shift },
          { x: -12 + shift, y: -12 + shift },
          { x: -12 + shift, y: 30 + shift },
          { x: -30 + shift, y: 30 + shift },
        ],
        zHeight: 35,
        zOffset: 0,
        bevel: 0.8,
        color: MATERIAL_PRESETS.steel.defaultColor,
        materialPreset: 'steel',
        visible: true,
      };
    case 'hollow-box':
      return {
        id,
        name: `中空方管腔体 #${indexOffset}`,
        type: 'hollow-box',
        points: createRectanglePoints(shift, shift, 56, 56),
        holePoints: createRectanglePoints(shift, shift, 34, 34),
        zHeight: 28,
        zOffset: 0,
        bevel: 1.0,
        color: MATERIAL_PRESETS.aluminum.defaultColor,
        materialPreset: 'aluminum',
        visible: true,
      };
    case 't-beam':
      return {
        id,
        name: `T型承重梁 #${indexOffset}`,
        type: 't-beam',
        points: [
          { x: -30 + shift, y: 12 + shift },
          { x: 30 + shift, y: 12 + shift },
          { x: 30 + shift, y: 28 + shift },
          { x: -30 + shift, y: 28 + shift },
          { x: -30 + shift, y: 12 + shift },
          { x: -10 + shift, y: 12 + shift },
          { x: -10 + shift, y: -28 + shift },
          { x: 10 + shift, y: -28 + shift },
          { x: 10 + shift, y: 12 + shift },
        ].slice(0, 8),
        zHeight: 40,
        zOffset: 0,
        bevel: 0.8,
        color: MATERIAL_PRESETS.steel.defaultColor,
        materialPreset: 'steel',
        visible: true,
      };
  }
}

/**
 * Fix clean T-beam profile without duplicate vertex
 */
export function createCleanTBeamPoints(cx = 0, cy = 0): Point2D[] {
  return [
    { x: cx - 30, y: cy + 10 },
    { x: cx - 10, y: cy + 10 },
    { x: cx - 10, y: cy - 30 },
    { x: cx + 10, y: cy - 30 },
    { x: cx + 10, y: cy + 10 },
    { x: cx + 30, y: cy + 10 },
    { x: cx + 30, y: cy + 26 },
    { x: cx - 30, y: cy + 26 },
  ];
}

/**
 * Starter scene: 4 clean, non-overlapping basic shapes (Box, Triangle, Cylinder, Line Wall)
 * arranged neatly on the XY plane so beginners can immediately click, move, or adjust Z height.
 */
export function createDefaultStarterScene(): CadShape[] {
  return [
    {
      id: 'starter-base-plate',
      name: '1. 方块 (矩形拉伸)',
      type: 'rect',
      points: createRectanglePoints(-32, 26, 36, 32),
      zHeight: 28,
      zOffset: 0,
      bevel: 0.8,
      color: '#38bdf8',
      materialPreset: 'aluminum',
      visible: true,
    },
    {
      id: 'starter-triangle',
      name: '2. 三角柱 (三角形拉伸)',
      type: 'triangle',
      points: createTrianglePoints(32, 26, 38, 34),
      zHeight: 34,
      zOffset: 0,
      bevel: 0.8,
      color: '#10b981',
      materialPreset: 'plastic',
      visible: true,
    },
    {
      id: 'starter-cylinder',
      name: '3. 圆柱 (圆形拉伸)',
      type: 'circle',
      points: createRegularPolygonPoints(-32, -26, 18, 32),
      zHeight: 40,
      zOffset: 0,
      bevel: 0.8,
      color: '#f59e0b',
      materialPreset: 'brass',
      visible: true,
    },
    {
      id: 'starter-line-wall',
      name: '4. 直线墙 (线段拉伸)',
      type: 'line',
      points: createLineWallPoints({ x: 12, y: -36 }, { x: 50, y: -14 }, 8),
      zHeight: 24,
      zOffset: 0,
      bevel: 0.5,
      color: '#818cf8',
      materialPreset: 'steel',
      visible: true,
    },
  ];
}

/**
 * Six-body industrial display assembly, in millimeters. The central bore is
 * continuous through the base and collar. Hex caps are separate solid bodies;
 * no unseen fastening holes, threads, or chamfers are implied by this example.
 */
export function createPrecisionDemoScene(): CadShape[] {
  const basePoints: Point2D[] = [];
  const corners = [
    { x: 48, y: -34, start: -Math.PI / 2 },
    { x: 48, y: 34, start: 0 },
    { x: -48, y: 34, start: Math.PI / 2 },
    { x: -48, y: -34, start: Math.PI },
  ];
  for (const corner of corners) {
    for (let sample = 0; sample <= 12; sample++) {
      const angle = corner.start + (sample / 12) * Math.PI / 2;
      basePoints.push({
        x: corner.x + 8 * Math.cos(angle),
        y: corner.y + 8 * Math.sin(angle),
      });
    }
  }

  const base: CadShape = {
    id: 'precision-base',
    name: '圆角底板',
    type: 'polygon',
    points: basePoints,
    holePoints: createRegularPolygonPoints(0, 0, 14, 72),
    zHeight: 8,
    zOffset: 0,
    bevel: 0,
    color: '#c4cdd6',
    materialPreset: 'aluminum',
    visible: true,
  };
  const collar: CadShape = {
    id: 'precision-collar',
    name: '导向套筒',
    type: 'circle',
    points: createRegularPolygonPoints(0, 0, 24, 72),
    holePoints: createRegularPolygonPoints(0, 0, 14, 72),
    zHeight: 32,
    zOffset: 8,
    bevel: 0,
    color: '#d5dde4',
    materialPreset: 'aluminum',
    visible: true,
  };
  const capCenters: [number, number][] = [[-42, -28], [42, -28], [42, 28], [-42, 28]];
  const caps: CadShape[] = capCenters.map(([x, y], index) => ({
    id: `precision-bolt-${index + 1}`,
    name: `六角帽 0${index + 1}`,
    type: 'polygon',
    points: createRegularPolygonPoints(x, y, 6, 6, Math.PI / 6),
    zHeight: 5,
    zOffset: 8,
    bevel: 0,
    color: '#46515f',
    materialPreset: 'steel',
    visible: true,
  }));
  return [base, collar, ...caps];
}

/**
 * Generate a standalone 2D CAD Blueprint SVG string for all visible shapes.
 */
export function exportToSVG(shapes: CadShape[]): string {
  const visible = shapes.filter((s) => s.visible && (s.type === 'point' ? s.points.length === 1 : s.type === 'segment' ? s.points.length === 2 : s.points.length >= 3));
  const bounds = computeBounds2D(visible.flatMap((shape) => shape.points));
  const viewBoxSize = Math.max(240, bounds.widthX * 1.25, bounds.depthY * 1.25);
  const x0 = (bounds.minX + bounds.maxX) / 2 - viewBoxSize / 2;
  const y0 = -(bounds.minY + bounds.maxY) / 2 - viewBoxSize / 2;
  const x1 = x0 + viewBoxSize;
  const y1 = y0 + viewBoxSize;
  const gridStep = Math.max(10, Math.ceil(viewBoxSize / 240) * 10);
  const escapeXml = (text: string) => text.replace(/[<>&"']/g, (character) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);

  const gridLines: string[] = [];
  for (let g = Math.ceil(x0 / gridStep) * gridStep; g <= x1; g += gridStep) {
    gridLines.push(`<line x1="${g}" y1="${y0}" x2="${g}" y2="${y1}" stroke="#334155" stroke-width="0.3" />`);
  }
  for (let g = Math.ceil(y0 / gridStep) * gridStep; g <= y1; g += gridStep) {
    gridLines.push(`<line x1="${x0}" y1="${g}" x2="${x1}" y2="${g}" stroke="#334155" stroke-width="0.3" />`);
  }

  const shapeElements = visible.map((shape) => {
    if (shape.type === 'point' || shape.type === 'segment') {
      const [a, b] = shape.points;
      const marker = shape.type === 'point'
        ? `<circle cx="${a.x}" cy="${-a.y}" r="${viewBoxSize / 400}" fill="${escapeXml(shape.color)}" />`
        : `<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" stroke="${escapeXml(shape.color)}" stroke-width="1.2" />`;
      return `<g id="${escapeXml(shape.id)}" data-shape-type="${shape.type}"><title>${escapeXml(shape.name)} · Z=${shape.zOffset} mm</title>${marker}</g>`;
    }
    const outerPath =
      shape.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`)
        .join(' ') + ' Z';
    const holePath =
      shape.holePoints && shape.holePoints.length >= 3
        ? ' ' +
          shape.holePoints
            .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`)
            .join(' ') +
          ' Z'
        : '';

    const metrics = computeShapeMetrics(shape);
    const labelX = metrics.centroid.x;
    const labelY = -metrics.centroid.y;

    return `
    <g id="${escapeXml(shape.id)}">
      <path d="${outerPath}${holePath}" fill="${escapeXml(shape.color)}" fill-opacity="0.22" fill-rule="evenodd" stroke="${escapeXml(shape.color)}" stroke-width="1.2" />
      <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" fill="#f8fafc" font-family="monospace" font-size="4.2" text-anchor="middle" dominant-baseline="middle">
        ${escapeXml(shape.name)} (Z:${shape.zHeight}mm)
      </text>
    </g>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${viewBoxSize} ${viewBoxSize}" width="1200" height="1200">
  <rect x="${x0}" y="${y0}" width="${viewBoxSize}" height="${viewBoxSize}" fill="#0b0f17" />
  <g id="cad-grid">
    ${gridLines.join('\n    ')}
    <line x1="${x0}" y1="0" x2="${x1}" y2="0" stroke="#ef4444" stroke-width="0.8" stroke-opacity="0.7" />
    <line x1="0" y1="${y0}" x2="0" y2="${y1}" stroke="#22c55e" stroke-width="0.8" stroke-opacity="0.7" />
  </g>
  <g id="cad-shapes">
    ${shapeElements.join('\n')}
  </g>
</svg>`;
}

/**
 * Export closed XY profiles as millimeter LWPOLYLINE entities with Z elevation/thickness.
 * The profile marker associates one inner loop with its outer loop on re-import.
 */
export function exportToDXF(shapes: CadShape[]): string {
  const visible = shapes.filter((s) => s.visible && (s.type === 'point' ? s.points.length === 1 : s.type === 'segment' ? s.points.length === 2 : s.points.length >= 3));
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1015',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '999',
    'EXTRUDECAD_PROFILE_V1',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  const appendLoop = (pts: Point2D[], layerName: string, zOffset: number, zHeight: number) => {
    lines.push('0', 'LWPOLYLINE', '100', 'AcDbEntity', '8', layerName,
      '100', 'AcDbPolyline', '90', String(pts.length), '70', '1',
      '38', String(zOffset), '39', String(zHeight));
    for (const point of pts) lines.push('10', String(point.x), '20', String(point.y));
  };

  for (const [index, s] of visible.entries()) {
    if (s.type === 'point' || s.type === 'segment') {
      const [a, b] = s.points;
      lines.push('0', s.type === 'point' ? 'POINT' : 'LINE', '100', 'AcDbEntity', '8', `EC_SKETCH_${index + 1}`,
        '100', s.type === 'point' ? 'AcDbPoint' : 'AcDbLine', '10', String(a.x), '20', String(a.y), '30', String(s.zOffset));
      if (s.type === 'segment') lines.push('11', String(b.x), '21', String(b.y), '31', String(s.zOffset));
      continue;
    }
    const layer = `EC_PROFILE_${index + 1}`;
    appendLoop(s.points, layer, s.zOffset, s.zHeight);
    if (s.holePoints && s.holePoints.length >= 3) {
      appendLoop(s.holePoints, `${layer}_HOLE`, s.zOffset, s.zHeight);
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

/**
 * Ear-clipping triangulation for a simple 2D polygon (used by pure OBJ/STL exporters).
 */
export function triangulatePolygon2D(points: Point2D[]): [number, number, number][] {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  const ccwPts = ensurePolygonWinding(points, true);
  // Map back to original indices if reversed
  const isReversed =
    ccwPts[0].x !== points[0].x ||
    ccwPts[0].y !== points[0].y ||
    (ccwPts[1].x !== points[1].x && ccwPts.length > 1);

  const avail: number[] = [];
  for (let i = 0; i < n; i++) {
    avail.push(isReversed ? n - 1 - i : i);
  }

  const triangles: [number, number, number][] = [];
  let guard = n * 3;

  const cross2D = (a: Point2D, b: Point2D, c: Point2D) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const pointInTri = (p: Point2D, a: Point2D, b: Point2D, c: Point2D) => {
    const c1 = cross2D(a, b, p);
    const c2 = cross2D(b, c, p);
    const c3 = cross2D(c, a, p);
    return c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6;
  };

  let idx = 0;
  while (avail.length > 3 && guard-- > 0) {
    const len = avail.length;
    const i0 = avail[(idx + len - 1) % len];
    const i1 = avail[idx % len];
    const i2 = avail[(idx + 1) % len];

    const a = points[i0];
    const b = points[i1];
    const c = points[i2];

    if (cross2D(a, b, c) > 1e-6) {
      let hasPointInside = false;
      for (const otherIdx of avail) {
        if (otherIdx === i0 || otherIdx === i1 || otherIdx === i2) continue;
        if (pointInTri(points[otherIdx], a, b, c)) {
          hasPointInside = true;
          break;
        }
      }
      if (!hasPointInside) {
        triangles.push([i0, i1, i2]);
        avail.splice(idx % len, 1);
        idx = 0;
        continue;
      }
    }
    idx++;
  }

  if (avail.length === 3) {
    triangles.push([avail[0], avail[1], avail[2]]);
  }
  return triangles;
}

/** Shared local-space mesh for the viewport and model exports; Z offset is applied by the caller. */
export function createExtrudedGeometry(shape: CadShape, bevelSegments = 3): ExtrudeGeometry {
  if (shape.type === 'point' || shape.type === 'segment') return new ExtrudeGeometry([]);
  const outline = new Shape();
  ensurePolygonWinding(shape.points, true).forEach((point, index) => {
    if (index === 0) outline.moveTo(point.x, point.y);
    else outline.lineTo(point.x, point.y);
  });
  outline.closePath();
  if (shape.holePoints && shape.holePoints.length >= 3) {
    const hole = new Path();
    ensurePolygonWinding(shape.holePoints, false).forEach((point, index) => {
      if (index === 0) hole.moveTo(point.x, point.y);
      else hole.lineTo(point.x, point.y);
    });
    hole.closePath();
    outline.holes.push(hole);
  }
  const depth = Math.max(0.001, shape.zHeight);
  const bevel = Math.min(Math.max(0, shape.bevel), depth * 0.25, 3);
  const hasBevel = bevel > 0.05;
  const geometry = new ExtrudeGeometry(outline, {
    steps: 1,
    depth: hasBevel ? depth - bevel * 2 : depth,
    bevelEnabled: hasBevel,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelOffset: 0,
    bevelSegments,
  });
  if (hasBevel) geometry.translate(0, 0, bevel);
  return geometry;
}

/** Export the same hole-aware, beveled mesh used in the viewport. Coordinates are millimeters. */
export function exportShapesToOBJ(shapes: CadShape[]): string {
  const visible = shapes.filter((s) => s.visible && s.type !== 'point' && s.type !== 'segment' && s.points.length >= 3);
  const out = ['# ExtrudeCAD Studio 3D OBJ Export', '# Units: millimeters', `# Generated Shapes: ${visible.length}`];
  let vertexOffset = 1;
  for (const shape of visible) {
    const geometry = createExtrudedGeometry(shape);
    try {
      const positions = geometry.getAttribute('position');
      out.push(`o ${shape.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
      for (let i = 0; i < positions.count; i++) {
        out.push(`v ${positions.getX(i).toFixed(6)} ${positions.getY(i).toFixed(6)} ${(positions.getZ(i) + shape.zOffset).toFixed(6)}`);
      }
      for (let i = 0; i < positions.count; i += 3) {
        out.push(`f ${vertexOffset + i} ${vertexOffset + i + 1} ${vertexOffset + i + 2}`);
      }
      vertexOffset += positions.count;
    } finally {
      geometry.dispose();
    }
  }
  return out.join('\n');
}

/**
 * Export visible CAD shapes to ASCII .STL format string for 3D printing & CAD exchange.
 */
export function exportShapesToSTL(shapes: CadShape[]): string {
  const visible = shapes.filter((s) => s.visible && s.type !== 'point' && s.type !== 'segment' && s.points.length >= 3);
  const out: string[] = ['solid ExtrudeCAD_Model'];

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ) => {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    out.push(
      `  facet normal ${nx.toFixed(4)} ${ny.toFixed(4)} ${nz.toFixed(4)}`,
      '    outer loop',
      `      vertex ${ax.toFixed(4)} ${ay.toFixed(4)} ${az.toFixed(4)}`,
      `      vertex ${bx.toFixed(4)} ${by.toFixed(4)} ${bz.toFixed(4)}`,
      `      vertex ${cx.toFixed(4)} ${cy.toFixed(4)} ${cz.toFixed(4)}`,
      '    endloop',
      '  endfacet',
    );
  };

  for (const shape of visible) {
    const geometry = createExtrudedGeometry(shape);
    try {
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i += 3) {
        pushTri(
          positions.getX(i), positions.getY(i), positions.getZ(i) + shape.zOffset,
          positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1) + shape.zOffset,
          positions.getX(i + 2), positions.getY(i + 2), positions.getZ(i + 2) + shape.zOffset,
        );
      }
    } finally {
      geometry.dispose();
    }
  }

  out.push('endsolid ExtrudeCAD_Model');
  return out.join('\n');
}

export type BooleanOperationType = 'union' | 'intersection' | 'subtraction';

export interface BooleanOperationResult {
  ok: boolean;
  operation: BooleanOperationType;
  resultShape: CadShape | null;
  wasAutoAligned: boolean;
  message: string;
}

/**
 * Check whether two 2D polygons overlap (either edges intersect or one contains a vertex of the other).
 */
export function arePolygonsOverlapping2D(polyA: Point2D[], polyB: Point2D[]): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;
  for (let i = 0; i < polyA.length; i++) {
    const a0 = polyA[i];
    const a1 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b0 = polyB[j];
      const b1 = polyB[(j + 1) % polyB.length];
      if (doSegmentsIntersect(a0, a1, b0, b1)) return true;
    }
  }
  if (
    polyA.some((p) => isPointInsidePolygon2D(p, polyB)) ||
    polyB.some((p) => isPointInsidePolygon2D(p, polyA))
  ) {
    return true;
  }
  return false;
}

interface PolygonBooleanGeometry {
  points: Point2D[];
  holePoints?: Point2D[];
}

type PolygonBooleanResult =
  | { status: 'success'; geometry: PolygonBooleanGeometry }
  | { status: 'empty' | 'multiple-parts' | 'multiple-holes' | 'touching-rings' | 'invalid' };

function booleanRingsTouch(outer: Point2D[], hole: Point2D[]): boolean {
  const coordinateScale = [...outer, ...hole].reduce((scale, p) => Math.max(scale, Math.abs(p.x), Math.abs(p.y)), 1);
  // Only allow for floating-point arithmetic error, not a fixed geometric gap.
  const tolerance = 8 * Number.EPSILON * coordinateScale;
  const onSegment = (p: Point2D, a: Point2D, b: Point2D): boolean => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= tolerance;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const along = dx * ux + dy * uy;
    return along >= -tolerance && along <= length + tolerance && Math.abs(dx * uy - dy * ux) <= tolerance;
  };
  return outer.some((a, i) => hole.some((b, j) => {
    const nextA = outer[(i + 1) % outer.length];
    const nextB = hole[(j + 1) % hole.length];
    return doSegmentsIntersect(a, nextA, b, nextB) || onSegment(b, a, nextA) || onSegment(a, b, nextB);
  }));
}

function computePolygonBooleanResult(
  rawPolyA: Point2D[],
  rawPolyB: Point2D[],
  op: BooleanOperationType,
  existingHoleA?: Point2D[],
  existingHoleB?: Point2D[],
): PolygonBooleanResult {
  // Saved projects may represent an absent hole as an empty array.
  const holeA = existingHoleA?.length === 0 ? undefined : existingHoleA;
  const holeB = existingHoleB?.length === 0 ? undefined : existingHoleB;
  const rings = [rawPolyA, rawPolyB, holeA, holeB]
    .filter((ring): ring is Point2D[] => ring !== undefined);
  if (rings.some((ring) => ring.length < 3 || ring.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) {
    return { status: 'invalid' };
  }

  const toPolygon = (outer: Point2D[], hole?: Point2D[]): Polygon =>
    (hole ? [outer, hole] : [outer]).map((ring) => ring.map((p) => [p.x, p.y]));
  const polygonA = toPolygon(rawPolyA, holeA);
  const polygonB = toPolygon(rawPolyB, holeB);

  try {
    const polygons = op === 'union'
      ? polygonClipping.union(polygonA, polygonB)
      : op === 'intersection'
        ? polygonClipping.intersection(polygonA, polygonB)
        : polygonClipping.difference(polygonA, polygonB);

    if (polygons.length === 0) return { status: 'empty' };
    // CadShape represents one connected outer contour with at most one hole.
    // Reject an unsupported result as a whole instead of discarding geometry.
    if (polygons.length > 1) return { status: 'multiple-parts' };
    if (polygons[0].length > 2) return { status: 'multiple-holes' };

    // polygon-clipping returns closed rings with the required outer/inner winding.
    // Remove only the closing duplicate: do not round or perturb CAD coordinates.
    const toPoints = (ring: Ring): Point2D[] => ring.slice(0, -1).map(([x, y]) => ({ x, y }));
    const points = toPoints(polygons[0][0]);
    const holePoints = polygons[0][1] ? toPoints(polygons[0][1]) : undefined;
    if ([points, ...(holePoints ? [holePoints] : [])].some((ring) =>
      ring.length < 3 || ring.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) {
      return { status: 'invalid' };
    }
    // The clipping library permits rings to touch at a point. Such a pinch
    // cannot be represented as a closed extrusion by our outer-plus-hole mesh.
    if (holePoints && booleanRingsTouch(points, holePoints)) return { status: 'touching-rings' };
    return { status: 'success', geometry: { points, holePoints } };
  } catch {
    return { status: 'invalid' };
  }
}

/**
 * Clip the XY material regions of A and B, including both optional holes.
 * Returns null for empty, invalid, or unsupported multi-part/multi-hole results.
 */
export function computePolygonBoolean2D(
  rawPolyA: Point2D[],
  rawPolyB: Point2D[],
  op: BooleanOperationType,
  existingHoleA?: Point2D[],
  existingHoleB?: Point2D[],
): PolygonBooleanGeometry | null {
  const result = computePolygonBooleanResult(rawPolyA, rawPolyB, op, existingHoleA, existingHoleB);
  return result.status === 'success' ? result.geometry : null;
}

/**
 * Boolean operation on XY cross-sections, extruded using A's height and elevation.
 * Automatic alignment is available only when explicitly requested by the caller.
 */
export function computeBooleanShapes(
  shapeA: CadShape,
  shapeB: CadShape,
  op: BooleanOperationType,
  options?: { autoAlignDisjoint?: boolean },
): BooleanOperationResult {
  const autoAlign = options?.autoAlignDisjoint ?? false;

  let workingB = shapeB;
  let wasAutoAligned = false;

  if (autoAlign && !arePolygonsOverlapping2D(shapeA.points, shapeB.points)) {
    const boundsA = computeBounds2D(shapeA.points);
    const boundsB = computeBounds2D(shapeB.points);

    let targetCx = boundsA.centroid.x;
    let targetCy = boundsA.centroid.y;

    const fitsInsideForHole =
      boundsB.widthX < boundsA.widthX * 0.78 &&
      boundsB.depthY < boundsA.depthY * 0.78;

    if (op === 'subtraction' && fitsInsideForHole) {
      // Center B inside A to punch a clean through-hole
      targetCx = boundsA.centroid.x;
      targetCy = boundsA.centroid.y;
    } else {
      // Offset B so it partially overlaps A's top-right quadrant for clear Union/Intersection/Notch
      targetCx = boundsA.centroid.x + Math.max(10, Math.round(boundsA.widthX * 0.36));
      targetCy = boundsA.centroid.y + Math.max(8, Math.round(boundsA.depthY * 0.32));
    }

    const dx = targetCx - boundsB.centroid.x;
    const dy = targetCy - boundsB.centroid.y;
    workingB = translateShape2D(shapeB, dx, dy);
    wasAutoAligned = true;
  }

  const geometryResult = computePolygonBooleanResult(
    shapeA.points,
    workingB.points,
    op,
    shapeA.holePoints,
    workingB.holePoints,
  );

  if (geometryResult.status !== 'success') {
    const opLabel =
      op === 'union' ? '并集 (A ∪ B)' : op === 'intersection' ? '交集 (A ∩ B)' : '差集 (A - B)';
    const reasons = {
      empty: '结果为空，没有可保留的二维截面。',
      'multiple-parts': '结果包含多个独立轮廓；当前模型仅支持单个外轮廓，未应用此运算。',
      'multiple-holes': '结果包含多个孔；当前模型仅支持一个孔，未应用此运算。',
      'touching-rings': '孔与外轮廓接触或相交，无法挤出闭合实体；请调整轮廓后重试。',
      invalid: '轮廓无效或无法可靠计算，请检查顶点坐标与轮廓。',
    };
    return {
      ok: false,
      operation: op,
      resultShape: null,
      wasAutoAligned: false,
      message: `无法完成${opLabel}：${reasons[geometryResult.status]}`,
    };
  }
  const boolGeom = geometryResult.geometry;

  const cleanNameA = shapeA.name.replace(/\s*\(.*\)/, '');
  const cleanNameB = shapeB.name.replace(/\s*\(.*\)/, '');

  const opTitleMap: Record<BooleanOperationType, string> = {
    union: `并集 (${cleanNameA} ∪ ${cleanNameB})`,
    intersection: `交集 (${cleanNameA} ∩ ${cleanNameB})`,
    subtraction: `差集 (${cleanNameA} - ${cleanNameB})`,
  };

  const resultShape: CadShape = {
    id: `cad-bool-${op}-${Date.now()}`,
    name: opTitleMap[op],
    type: boolGeom.holePoints ? 'hollow-box' : 'polygon',
    points: boolGeom.points,
    holePoints: boolGeom.holePoints,
    zHeight: shapeA.zHeight,
    zOffset: shapeA.zOffset,
    bevel: shapeA.bevel,
    color: op === 'intersection' ? '#f59e0b' : shapeA.color,
    materialPreset: shapeA.materialPreset,
    visible: true,
    // 记录布尔来源，使原始操作数可隐藏保留、随时还原
    booleanMeta: {
      op,
      targetId: shapeA.id,
      toolId: shapeB.id,
      targetName: cleanNameA,
      toolName: cleanNameB,
    },
  };

  const metrics = computeShapeMetrics(resultShape);
  const alignNote = wasAutoAligned ? '（已自动贴合重叠两图形）' : '';

  return {
    ok: true,
    operation: op,
    resultShape,
    wasAutoAligned,
    message: `已完成${opTitleMap[op]}${alignNote} · 面积 S=${metrics.areaMm2.toFixed(0)}mm² · 顶点数=${resultShape.points.length}`,
  };
}

/**
 * Resize a 'line' wall shape's centerline length (and optionally thickness or angle)
 * while anchoring its start point.
 */
export function resizeLineWall2D(
  shape: CadShape,
  targetLengthMm: number,
  targetThicknessMm?: number,
  targetAngleDeg?: number,
): CadShape {
  if (shape.type === 'point' || shape.type === 'segment') return shape;
  if (!Number.isFinite(targetLengthMm) || targetLengthMm <= 0) return shape;
  const safeLen = targetLengthMm;
  const dim = computeShapeDimensions(shape);
  const start = dim.lineStart ?? shape.points[0] ?? { x: 0, y: 0 };
  const end = dim.lineEnd ?? shape.points[1] ?? { x: safeLen, y: 0 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const curLen = Math.hypot(dx, dy);

  let ux = 1;
  let uy = 0;
  if (targetAngleDeg !== undefined && Number.isFinite(targetAngleDeg)) {
    const rad = (targetAngleDeg * Math.PI) / 180;
    ux = Math.cos(rad);
    uy = Math.sin(rad);
  } else if (curLen > 1e-6) {
    ux = dx / curLen;
    uy = dy / curLen;
  }

  const newEnd: Point2D = {
    x: start.x + ux * safeLen,
    y: start.y + uy * safeLen,
  };
  const thickness = targetThicknessMm ?? dim.thicknessMm ?? 6;
  if (!Number.isFinite(thickness) || thickness <= 0 || !Number.isFinite(newEnd.x) || !Number.isFinite(newEnd.y)) return shape;

  return {
    ...shape,
    points: createLineWallPoints(start, newEnd, thickness),
  };
}

/**
 * Resize a circle shape to a specific target diameter in mm around its centroid.
 */
export function resizeCircleDiameter2D(
  shape: CadShape,
  targetDiameterMm: number,
): CadShape {
  if (!Number.isFinite(targetDiameterMm) || targetDiameterMm <= 0) return shape;
  return resizeShape2D(shape, targetDiameterMm, targetDiameterMm);
}

/**
 * Customize a specific edge's length (and optional angle) on a 2D shape.
 * - Anchors vertex `i = edgeIndex` and moves vertex `j = (i + 1) % N` to achieve exact `targetLengthMm`.
 * - If `options.syncOppositeRectEdge` is true on a 4-vertex shape, shifts vertex `(j + 1) % 4` by the same delta
 *   so opposite edges remain parallel and equal.
 * - For 'line' wall shapes, updates either the centerline length or wall thickness depending on which edge was edited.
 * - For 'circle' shapes, updates the circle diameter.
 */
export function resizeShapeEdge2D(
  shape: CadShape,
  edgeIndex: number,
  targetLengthMm: number,
  options?: {
    targetAngleDeg?: number;
    syncOppositeRectEdge?: boolean;
  },
): CadShape {
  if (!Number.isFinite(targetLengthMm) || targetLengthMm <= 0) return shape;
  const safeLen = targetLengthMm;

  if (shape.type === 'circle') {
    return resizeCircleDiameter2D(shape, safeLen);
  }

  if (shape.type === 'point') return shape;
  if (shape.type === 'segment' && shape.points.length === 2) {
    const [start, end] = shape.points;
    const angle = options?.targetAngleDeg === undefined
      ? Math.atan2(end.y - start.y, end.x - start.x) : options.targetAngleDeg * Math.PI / 180;
    const next = { x: start.x + Math.cos(angle) * safeLen, y: start.y + Math.sin(angle) * safeLen };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return shape;
    return { ...shape, points: [{ ...start }, next] };
  }

  if (shape.type === 'line' && shape.points.length === 4) {
    const dim = computeShapeDimensions(shape);
    if (edgeIndex === 0 || edgeIndex === 2) {
      return resizeLineWall2D(
        shape,
        safeLen,
        dim.thicknessMm,
        options?.targetAngleDeg,
      );
    } else {
      return resizeLineWall2D(
        shape,
        dim.primaryLengthMm,
        safeLen,
        options?.targetAngleDeg,
      );
    }
  }

  const n = shape.points.length;
  if (n < 2) return shape;

  const idx = ((edgeIndex % n) + n) % n;
  const nextIdx = (idx + 1) % n;
  const pts = shape.points.map((p) => ({ ...p }));
  const startPt = pts[idx];
  const endPt = pts[nextIdx];

  const dx = endPt.x - startPt.x;
  const dy = endPt.y - startPt.y;
  const currentLen = Math.hypot(dx, dy);

  let ux = 1;
  let uy = 0;
  if (
    options?.targetAngleDeg !== undefined &&
    Number.isFinite(options.targetAngleDeg)
  ) {
    const rad = (options.targetAngleDeg * Math.PI) / 180;
    ux = Math.cos(rad);
    uy = Math.sin(rad);
  } else if (currentLen > 1e-6) {
    ux = dx / currentLen;
    uy = dy / currentLen;
  }

  const newEndPt: Point2D = {
    x: startPt.x + ux * safeLen,
    y: startPt.y + uy * safeLen,
  };

  const deltaX = newEndPt.x - endPt.x;
  const deltaY = newEndPt.y - endPt.y;

  pts[nextIdx] = newEndPt;

  if (options?.syncOppositeRectEdge && n === 4) {
    const oppositeNextIdx = (nextIdx + 1) % 4;
    pts[oppositeNextIdx] = {
      x: pts[oppositeNextIdx].x + deltaX,
      y: pts[oppositeNextIdx].y + deltaY,
    };
    return {
      ...shape,
      points: pts,
    };
  }

  // If a rectangle has a single edge customized without syncing opposite edges,
  // promote its type to 'polygon' so individual edge lengths are rendered and preserved.
  const nextType: ShapeType =
    shape.type === 'rect' && (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01)
      ? 'polygon'
      : shape.type;

  return {
    ...shape,
    type: nextType,
    points: pts,
  };
}


