/** Normalize mouse/trackpad wheel units and bound each zoom step. */
export function wheelZoom(current: number, delta: number, mode: number, height: number, min: number, max: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? height : 1);
  return Math.min(max, Math.max(min, current * Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.0015)));
}

/** Keep the world point beneath the cursor fixed while changing 2D scale. */
export function zoomPanAt(pan: { x: number; y: number }, cursorFromCenter: { x: number; y: number }, ratio: number) {
  return {
    x: cursorFromCenter.x - (cursorFromCenter.x - pan.x) * ratio,
    y: cursorFromCenter.y - (cursorFromCenter.y - pan.y) * ratio,
  };
}
