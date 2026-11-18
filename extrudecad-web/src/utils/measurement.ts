export interface MeasurementPoint { x: number; y: number }

/** Distance and signed components in the XY plane; angle is counterclockwise from +X. */
export function measureXY(start: MeasurementPoint, end: MeasurementPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  return { dx, dy, distance, angleDeg: distance === 0 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI };
}
