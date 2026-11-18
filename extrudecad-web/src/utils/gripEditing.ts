import type { CadShape, Point2D } from './cadEngine';
import { parseDrawingPoint } from './drawingInput';
import { reconcileSketchGraph } from './sketchGraph';

export const GRIP_MODES = ['stretch', 'move', 'rotate', 'scale', 'mirror'] as const;
export type GripMode = typeof GRIP_MODES[number];
export const GRIP_LABELS: Record<GripMode, string> = {
  stretch: '拉伸 Stretch', move: '移动 Move', rotate: '旋转 Rotate', scale: '缩放 Scale', mirror: '镜像 Mirror',
};
export interface GripSession {
  snapshot: CadShape[];
  selectedIds: string[];
  shapeId: string;
  vertexIndex?: number;
  base: Point2D;
  mode: GripMode;
}

export function gripReferenceLength(grip: GripSession): number {
  return Math.max(0, ...grip.snapshot.filter(s => grip.selectedIds.includes(s.id))
    .flatMap(s => s.points.map(p => Math.hypot(p.x - grip.base.x, p.y - grip.base.y))));
}

/** A pure preview: the project and its undo history are untouched until confirmation. */
export function previewGrip(grip: GripSession, cursor: Point2D, input = ''): CadShape[] {
  const { snapshot, mode, base, vertexIndex, shapeId } = grip;
  const ids = new Set(mode === 'stretch' ? [shapeId] : grip.selectedIds);
  const selected = snapshot.filter(s => ids.has(s.id));
  if (!selected.length || selected.some(s => !s.visible || !['point', 'segment'].includes(s.type))) {
    throw new Error('夹点变换仅支持可见的定位点和草图直线，请重新选择。');
  }
  const numeric = input.trim();
  let target = cursor, value = 0;
  if (mode === 'stretch' || mode === 'move') {
    if (numeric) target = parseDrawingPoint(numeric, { tool: 'line', start: base, cursor });
  } else {
    if (numeric && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numeric)) throw new Error('请输入数值：角度（°）或缩放倍率。');
    const radius = Math.hypot(cursor.x - base.x, cursor.y - base.y);
    if (mode === 'scale') {
      const reference = gripReferenceLength(grip);
      if (reference < 1e-8) throw new Error('所选对象都在基点上，无法进行有尺寸的缩放。');
      value = numeric ? Number(numeric) : radius / reference;
      if (!Number.isFinite(value) || value <= 0) throw new Error('缩放倍率必须大于 0。');
    } else {
      if (!numeric && radius < 1e-8) throw new Error('请指定离开基点的方向，或输入角度。');
      value = numeric ? (Number(numeric) % 360) * Math.PI / 180 : Math.atan2(cursor.y - base.y, cursor.x - base.x);
    }
  }
  const transform = (point: Point2D): Point2D => {
    if ((mode === 'rotate' && value === 0) || (mode === 'scale' && value === 1)) return point;
    const x = point.x - base.x, y = point.y - base.y;
    if (mode === 'stretch' || mode === 'move') return { x: point.x + (target.x - base.x), y: point.y + (target.y - base.y) };
    if (mode === 'scale') return { x: base.x + x * value, y: base.y + y * value };
    const cos = Math.cos(mode === 'mirror' ? 2 * value : value);
    const sin = Math.sin(mode === 'mirror' ? 2 * value : value);
    return mode === 'mirror'
      ? { x: base.x + cos * x + sin * y, y: base.y + sin * x - cos * y }
      : { x: base.x + cos * x - sin * y, y: base.y + sin * x + cos * y };
  };
  const next = snapshot.map(shape => !ids.has(shape.id) ? shape : { ...shape,
    points: shape.points.map((p, i) => mode === 'stretch' && vertexIndex !== undefined && i !== vertexIndex ? p : transform(p)),
  });
  if (next.some(s => s.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000))) {
    throw new Error('变换坐标超出 ±100000 mm 范围，请减小参数。');
  }
  const resolved = reconcileSketchGraph(snapshot, next);
  if (resolved.some(s => s.type === 'segment' && Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y) < 1e-8 &&
    JSON.stringify(s.points) !== JSON.stringify(snapshot.find(old => old.id === s.id)?.points))) {
    throw new Error('操作会生成零长度或过短的直线，请保持两个端点不同。');
  }
  return resolved;
}

/** Resolve the surviving last LINE each time, so edits, undo, deletion and reload cannot leave a stale endpoint. */
export function lineContinuation(shapes: CadShape[]): { point: Point2D; pointId?: string; zOffset: number } {
  const line = [...shapes].reverse().find(s => s.type === 'segment');
  if (!line) throw new Error('没有可续画的直线，请单击或输入 x,y 指定起点。');
  if (!line.visible) throw new Error('最近直线已隐藏，请显示该直线或指定新起点。');
  const pointId = line.endpointIds?.[1];
  const node = pointId ? shapes.find(s => s.id === pointId) : undefined;
  if (pointId && (!node || !node.visible || node.type !== 'point')) throw new Error('最近直线的终点不可用，请指定新起点。');
  return { point: { ...(node?.points[0] ?? line.points[1]) }, pointId, zOffset: node?.zOffset ?? line.zOffset };
}
