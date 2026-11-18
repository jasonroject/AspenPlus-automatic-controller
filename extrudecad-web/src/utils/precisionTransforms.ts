import { CadShape, Point2D, computeBounds2D } from './cadEngine';
import { cloneSketchSelection, reconcileSketchGraph } from './sketchGraph';

export type PrecisionTransform =
  | { kind: 'move'; dx: number; dy: number; dz: number; copy?: boolean }
  | { kind: 'rotate'; angleDeg: number; pivot?: { x: number; y: number }; copy?: boolean }
  | { kind: 'scale'; factor: number; pivot?: { x: number; y: number; z: number }; copy?: boolean };

function editableSelection(shapes: CadShape[], ids: string[]): CadShape[] {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  return [...new Set(ids)].map((id) => byId.get(id))
    .filter((shape): shape is CadShape => Boolean(shape?.visible && !shape.locked));
}

/** The center of the editable selection's combined XYZ bounding box. */
export function getSelectionPivot(shapes: CadShape[], ids: string[]): { x: number; y: number; z: number } {
  const selected = editableSelection(shapes, ids);
  if (!selected.length) return { x: 0, y: 0, z: 0 };
  const bounds = computeBounds2D(selected.flatMap((shape) => shape.points));
  const minZ = Math.min(...selected.map((shape) => shape.zOffset));
  const maxZ = Math.max(...selected.map((shape) => shape.zOffset + shape.zHeight));
  return {
    x: bounds.minX / 2 + bounds.maxX / 2,
    y: bounds.minY / 2 + bounds.maxY / 2,
    z: minZ / 2 + maxZ / 2,
  };
}

/** Apply one shared transform without rounding coordinates or mutating source objects. */
export function transformSelectedShapes(
  shapes: CadShape[],
  ids: string[],
  operation: PrecisionTransform,
): { shapes: CadShape[]; selectedIds: string[]; changed: number } {
  const selected = editableSelection(shapes, ids);
  const unchanged = { shapes, selectedIds: ids, changed: 0 };
  if (!selected.length) return unchanged;

  const pivot = operation.kind === 'scale' ? operation.pivot ?? getSelectionPivot(shapes, ids)
    : operation.kind === 'rotate' ? { ...(operation.pivot ?? getSelectionPivot(shapes, ids)), z: 0 }
      : { x: 0, y: 0, z: 0 };
  const inputs = operation.kind === 'move'
    ? [operation.dx, operation.dy, operation.dz]
    : operation.kind === 'rotate'
      ? [operation.angleDeg, pivot.x, pivot.y]
      : [operation.factor, pivot.x, pivot.y, pivot.z];
  if (!inputs.every(Number.isFinite)) throw new Error('变换参数必须为有限数值。');
  if (operation.kind === 'scale' && operation.factor <= 0) throw new Error('缩放比例必须大于 0。');

  const angle = operation.kind === 'rotate' ? operation.angleDeg % 360 : 0;
  const identity = operation.kind === 'move'
    ? operation.dx === 0 && operation.dy === 0 && operation.dz === 0
    : operation.kind === 'rotate' ? angle === 0 : operation.factor === 1;
  if (identity && !operation.copy) return unchanged;

  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const transformPoint = (point: Point2D): Point2D => {
    if (identity) return { ...point };
    if (operation.kind === 'move') return { x: point.x + operation.dx, y: point.y + operation.dy };
    if (operation.kind === 'rotate') return {
      x: pivot.x + (point.x - pivot.x) * cos - (point.y - pivot.y) * sin,
      y: pivot.y + (point.x - pivot.x) * sin + (point.y - pivot.y) * cos,
    };
    return {
      x: pivot.x + (point.x - pivot.x) * operation.factor,
      y: pivot.y + (point.y - pivot.y) * operation.factor,
    };
  };

  const usedNames = new Set(shapes.map((shape) => shape.name));
  const transformShape = (shape: CadShape): CadShape => {
    const scale = operation.kind === 'scale' ? operation.factor : 1;
    const centerZ = operation.kind === 'scale' ? pivot.z : 0;
    const next: CadShape = {
      ...shape,
      points: shape.points.map(transformPoint),
      holePoints: shape.holePoints?.map(transformPoint),
      zOffset: operation.kind === 'move' ? shape.zOffset + operation.dz
        : operation.kind === 'scale' ? centerZ + (shape.zOffset - centerZ) * scale : shape.zOffset,
      zHeight: shape.zHeight * scale,
      bevel: shape.bevel * scale,
    };
    const coordinates = [...next.points, ...(next.holePoints ?? [])].flatMap((point) => [point.x, point.y]);
    const reference = next.type === 'point' || next.type === 'segment';
    if (![...coordinates, next.zOffset, next.zHeight, next.bevel, next.zOffset + next.zHeight].every(Number.isFinite)
      || (reference ? next.zHeight !== 0 || next.bevel !== 0 : next.zHeight <= 0)) {
      throw new Error('变换后的尺寸超出有效数值范围，请减小参数。');
    }
    if (operation.copy) {
      const baseName = `${shape.name} (副本)`;
      next.name = baseName;
      let suffix = 2;
      while (usedNames.has(next.name)) next.name = `${baseName} (${suffix++})`;
      usedNames.add(next.name);
      next.locked = false;
      delete next.booleanMeta;
    }
    return next;
  };

  const transformed = operation.copy
    ? cloneSketchSelection(shapes, selected.map((shape) => shape.id), transformShape)
    : selected.map(transformShape);

  if (operation.copy) return {
    shapes: [...shapes, ...transformed],
    selectedIds: transformed.map((shape) => shape.id),
    changed: transformed.length,
  };
  const byId = new Map(transformed.map((shape) => [shape.id, shape]));
  return {
    shapes: reconcileSketchGraph(shapes, shapes.map((shape) => byId.get(shape.id) ?? shape)),
    selectedIds: ids,
    changed: transformed.length,
  };
}
