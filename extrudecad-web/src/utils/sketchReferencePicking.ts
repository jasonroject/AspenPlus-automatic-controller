import { Camera, Vector2, Vector3, Vector4 } from 'three';

/** Pick a world-space point/segment with a CSS-pixel tolerance in either camera projection. */
export function findSketchReferenceHit(
  points: readonly Vector3[],
  camera: Camera,
  pointerNdc: Vector2,
  viewport: { width: number; height: number },
  tolerancePx: number,
): Vector3 | null {
  if (!points.length || viewport.width <= 0 || viewport.height <= 0) return null;
  const start = points[0], end = points[1] ?? start;
  const project = (point: Vector3) => new Vector4(point.x, point.y, point.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  const clipStart = project(start), clipEnd = project(end);
  let startT = 0, endT = 1;

  // Clip before dividing by w: a point behind a perspective camera otherwise
  // folds onto the opposite screen side and hides the visible part of a line.
  for (const sign of [1, -1]) {
    const a = clipStart.w + sign * clipStart.z;
    const b = clipEnd.w + sign * clipEnd.z;
    if (a < 0 && b < 0) return null;
    if (a < 0) startT = Math.max(startT, a / (a - b));
    if (b < 0) endT = Math.min(endT, a / (a - b));
  }
  if (startT > endT) return null;
  const clippedStart = clipStart.clone().lerp(clipEnd, startT);
  const clippedEnd = clipStart.clone().lerp(clipEnd, endT);
  if (clippedStart.w <= 0 || clippedEnd.w <= 0) return null;

  const pixelOffset = (point: Vector4) => new Vector2(
    (point.x / point.w - pointerNdc.x) * viewport.width / 2,
    (point.y / point.w - pointerNdc.y) * viewport.height / 2,
  );
  const a = pixelOffset(clippedStart);
  const delta = pixelOffset(clippedEnd).sub(a);
  const screenT = delta.lengthSq() ? Math.max(0, Math.min(1, -a.dot(delta) / delta.lengthSq())) : 0;
  if (a.addScaledVector(delta, screenT).length() > tolerancePx) return null;

  // Screen interpolation is perspective-dependent; recover the actual world
  // hit position so the Raycaster can sort overlapping references by distance.
  const worldT = screenT * clippedStart.w / ((1 - screenT) * clippedEnd.w + screenT * clippedStart.w);
  return start.clone().lerp(end, startT + (endT - startT) * worldT);
}
