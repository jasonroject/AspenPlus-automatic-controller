import type { CadShape, Point2D } from './cadEngine';

const PLANE_TOLERANCE = 1e-8;
type Position = Point2D & { z: number };

function samePoint(a: Point2D, b: Point2D): boolean {
  return a.x === b.x && a.y === b.y;
}

function samePosition(a: Position, b: Position): boolean {
  return samePoint(a, b) && a.z === b.z;
}

function pointPosition(shape: CadShape): Position {
  return { ...shape.points[0], z: shape.zOffset };
}

function validEndpointIds(shape: CadShape): shape is CadShape & { endpointIds: [string, string] } {
  return shape.type === 'segment' && Array.isArray(shape.endpointIds) && shape.endpointIds.length === 2 &&
    shape.endpointIds.every((id) => typeof id === 'string' && id.length > 0) && shape.endpointIds[0] !== shape.endpointIds[1];
}

function indexShapes(shapes: CadShape[]): Map<string, CadShape> {
  const byId = new Map<string, CadShape>();
  for (const shape of shapes) {
    if (!shape.id || byId.has(shape.id)) throw new Error('点线关系包含重复或无效的对象标识。');
    byId.set(shape.id, shape);
    if (shape.endpointIds !== undefined && !validEndpointIds(shape)) {
      throw new Error('直线关联必须引用两个不同的定位点，其他对象不能设置端点关系。');
    }
    if (shape.type !== 'point' && shape.type !== 'segment') continue;
    const count = shape.type === 'point' ? 1 : 2;
    if (shape.points.length !== count || shape.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
      !Number.isFinite(shape.zOffset) || shape.zHeight !== 0 || shape.bevel !== 0 || (shape.holePoints?.length ?? 0) > 0) {
      throw new Error('定位点或草图直线坐标无效，且不得带有拉伸高度或倒角。');
    }
    if (shape.type === 'segment' && (samePoint(shape.points[0], shape.points[1]) ||
      !Number.isFinite(Math.hypot(shape.points[1].x - shape.points[0].x, shape.points[1].y - shape.points[0].y)))) {
      throw new Error('操作会生成零长度或无效的直线，请保持两个端点不同。');
    }
  }
  return byId;
}

function validateLinks(shapes: CadShape[], byId: Map<string, CadShape>, checkCoordinates: boolean): void {
  const pairs = new Set<string>();
  for (const shape of shapes) {
    if (!validEndpointIds(shape)) continue;
    const [startId, endId] = shape.endpointIds;
    const start = byId.get(startId), end = byId.get(endId);
    if (!start || !end || start.type !== 'point' || end.type !== 'point') {
      throw new Error('直线关联了不存在的定位点或非点对象，不能保留悬空的端点关系。');
    }
    const pair = JSON.stringify([startId, endId].sort());
    if (pairs.has(pair)) throw new Error('同一对定位点存在重复的直线关系。');
    pairs.add(pair);
    if (!checkCoordinates) continue;
    if (Math.abs(start.zOffset - end.zOffset) > PLANE_TOLERANCE ||
      Math.abs(shape.zOffset - start.zOffset) > PLANE_TOLERANCE || Math.abs(shape.zOffset - end.zOffset) > PLANE_TOLERANCE) {
      throw new Error('关联点与直线必须位于同一 Z 平面，当前不支持倾斜的空间直线。');
    }
    if (Math.hypot(shape.points[0].x - start.points[0].x, shape.points[0].y - start.points[0].y) > PLANE_TOLERANCE ||
      Math.hypot(shape.points[1].x - end.points[0].x, shape.points[1].y - end.points[0].y) > PLANE_TOLERANCE) {
      throw new Error('直线端点坐标与所关联的定位点不一致。');
    }
  }
}

/** Validate persisted relationships without linking or changing legacy independent lines. */
export function validateSketchGraph(shapes: CadShape[]): void {
  validateLinks(shapes, indexShapes(shapes), true);
}

/** Geometry changed by a drag: adjacent edges follow moved nodes, but their far nodes stay fixed. */
export function sketchDragAffectedIds(shapes: CadShape[], selectedIds: string[], vertexIndex?: number): Set<string> {
  const affected = new Set(selectedIds);
  const movedPoints = new Set<string>();
  for (const shape of shapes) {
    if (!affected.has(shape.id)) continue;
    if (shape.type === 'point') movedPoints.add(shape.id);
    if (validEndpointIds(shape)) {
      for (const id of vertexIndex === undefined ? shape.endpointIds : [shape.endpointIds[vertexIndex]]) {
        if (id) movedPoints.add(id);
      }
    }
  }
  for (const id of movedPoints) affected.add(id);
  for (const shape of shapes) {
    if (validEndpointIds(shape) && shape.endpointIds.some(id => movedPoints.has(id))) affected.add(shape.id);
  }
  return affected;
}

function sameGeometry(a: CadShape, b: CadShape): boolean {
  return a.type === b.type && a.zOffset === b.zOffset && a.zHeight === b.zHeight && a.bevel === b.bevel &&
    a.points.length === b.points.length && a.points.every((p, i) => samePoint(p, b.points[i])) &&
    JSON.stringify(a.endpointIds) === JSON.stringify(b.endpointIds);
}

/** Resolve one proposed edit atomically. Explicit point moves take priority over line edits. */
export function reconcileSketchGraph(previous: CadShape[], next: CadShape[]): CadShape[] {
  const previousById = indexShapes(previous);
  validateLinks(previous, previousById, true);
  const proposedById = indexShapes(next);
  const deletedPointIds = new Set(previous.filter((shape) => shape.type === 'point' && !proposedById.has(shape.id)).map((shape) => shape.id));
  const retained = next.filter((shape) => !validEndpointIds(shape) || !shape.endpointIds.some((id) => deletedPointIds.has(id)));
  const byId = indexShapes(retained);
  validateLinks(retained, byId, false);

  const explicitPointChanges = new Set<string>();
  for (const shape of retained) {
    if (shape.type !== 'point') continue;
    const old = previousById.get(shape.id);
    if (!old || old.type !== 'point' || !samePosition(pointPosition(old), pointPosition(shape))) explicitPointChanges.add(shape.id);
  }

  const inferredPositions = new Map<string, Position>();
  for (const line of retained) {
    if (!validEndpointIds(line)) continue;
    const old = previousById.get(line.id);
    // Newly created/relinked lines adopt their referenced points; they do not move existing points.
    if (!old || !validEndpointIds(old) || old.endpointIds.some((id, i) => id !== line.endpointIds[i])) continue;
    line.endpointIds.forEach((pointId, i) => {
      if (explicitPointChanges.has(pointId) || (samePoint(line.points[i], old.points[i]) && line.zOffset === old.zOffset)) return;
      const position = { ...line.points[i], z: line.zOffset };
      const other = inferredPositions.get(pointId);
      if (other && !samePosition(other, position)) throw new Error('多条直线对共享端点给出了不同位置，请直接移动该定位点。');
      inferredPositions.set(pointId, position);
    });
  }

  const resolvedPoints = new Map<string, CadShape>();
  for (const shape of retained) {
    if (shape.type !== 'point') continue;
    const inferred = inferredPositions.get(shape.id);
    resolvedPoints.set(shape.id, inferred && !samePosition(pointPosition(shape), inferred)
      ? { ...shape, points: [{ x: inferred.x, y: inferred.y }], zOffset: inferred.z }
      : shape);
  }

  const resolved = retained.map((shape) => {
    if (shape.type === 'point') return resolvedPoints.get(shape.id)!;
    if (!validEndpointIds(shape)) return shape;
    const first = resolvedPoints.get(shape.endpointIds[0])!;
    const second = resolvedPoints.get(shape.endpointIds[1])!;
    if (Math.abs(first.zOffset - second.zOffset) > PLANE_TOLERANCE) {
      throw new Error('关联点与直线必须位于同一 Z 平面，当前不支持倾斜的空间直线。');
    }
    if (samePoint(shape.points[0], first.points[0]) && samePoint(shape.points[1], second.points[0]) && shape.zOffset === first.zOffset) return shape;
    return { ...shape, points: [{ ...first.points[0] }, { ...second.points[0] }], zOffset: first.zOffset };
  });
  const resolvedById = indexShapes(resolved);
  validateLinks(resolved, resolvedById, true);
  for (const old of previous) {
    if (!old.locked || (old.type !== 'point' && old.type !== 'segment')) continue;
    const updated = resolvedById.get(old.id);
    if (!updated || !sameGeometry(old, updated)) {
      throw new Error(`「${old.name}」已锁定，不能移动、删除或通过相连对象改变其几何。`);
    }
  }
  return resolved.length === next.length && resolved.every((shape, i) => shape === next[i]) ? next : resolved;
}

/** Copy selected shapes and any endpoints required by selected linked lines. */
export function cloneSketchSelection(
  shapes: CadShape[],
  selectedIds: string[],
  transform: (shape: CadShape) => CadShape,
): CadShape[] {
  validateSketchGraph(shapes);
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  const ids = [...new Set(selectedIds)].filter((id) => byId.has(id));
  const included = new Set(ids);
  for (const id of [...ids]) {
    const shape = byId.get(id)!;
    if (!validEndpointIds(shape)) continue;
    for (const pointId of shape.endpointIds) {
      if (!included.has(pointId)) { included.add(pointId); ids.push(pointId); }
    }
  }
  const newIds = new Map(ids.map((id) => [id, `shape-copy-${crypto.randomUUID()}`]));
  const copies = ids.map((id) => {
    const original = byId.get(id)!;
    const copy = structuredClone(transform(structuredClone(original)));
    if (copy.type !== original.type) throw new Error('复制变换不能改变对象类型。');
    copy.id = newIds.get(id)!;
    copy.locked = false;
    if (validEndpointIds(original)) copy.endpointIds = original.endpointIds.map((pointId) => newIds.get(pointId)!) as [string, string];
    else delete copy.endpointIds;
    return copy;
  });
  validateSketchGraph(copies);
  return copies;
}
