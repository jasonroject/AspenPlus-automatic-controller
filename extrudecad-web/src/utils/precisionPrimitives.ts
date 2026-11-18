import { CadShape, createPrimitiveShape, createRectanglePoints } from './cadEngine';

export type PrecisionPrimitiveSpec = {
  kind: 'box' | 'cylinder';
  centerX: number;
  centerY: number;
  zOffset: number;
  width: number;
  depth: number;
  diameter: number;
  zHeight: number;
};

/** Create an un-beveled extrusion from explicit dimensions in millimetres. */
export function createPrecisionPrimitive(spec: PrecisionPrimitiveSpec): CadShape {
  if (spec.kind !== 'box' && spec.kind !== 'cylinder') throw new Error('请选择长方体或圆柱体。');
  if (![spec.centerX, spec.centerY, spec.zOffset].every(Number.isFinite)) {
    throw new Error('中心坐标和底面标高必须为有限数值。');
  }
  const dimensions = spec.kind === 'box' ? [spec.width, spec.depth, spec.zHeight] : [spec.diameter, spec.zHeight];
  if (!dimensions.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('尺寸与拉伸高度必须大于零。');
  }
  const shape = createPrimitiveShape(spec.kind);
  // Do not round these new coordinates: rounding very small circles can collapse vertices.
  const points = spec.kind === 'box'
    ? createRectanglePoints(spec.centerX, spec.centerY, spec.width, spec.depth)
    : Array.from({ length: 72 }, (_, index) => {
      const angle = index * Math.PI * 2 / 72;
      return { x: spec.centerX + Math.cos(angle) * spec.diameter / 2, y: spec.centerY + Math.sin(angle) * spec.diameter / 2 };
    });
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) || !Number.isFinite(spec.zOffset + spec.zHeight)) {
    throw new Error('坐标或尺寸超出可表示范围。');
  }
  return {
    ...shape,
    name: spec.kind === 'box' ? `长方体 ${spec.width}×${spec.depth}×${spec.zHeight}` : `圆柱 Ø${spec.diameter}×${spec.zHeight}`,
    points,
    zOffset: spec.zOffset,
    zHeight: spec.zHeight,
    bevel: 0,
    locked: false,
  };
}
