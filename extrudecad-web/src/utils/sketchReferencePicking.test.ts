import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { findSketchReferenceHit } from './sketchReferencePicking';

const viewport = { width: 960, height: 600 };

test('a visible line remains selectable when one endpoint is behind the perspective camera', () => {
  const camera = new PerspectiveCamera(36, 1.6, .1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -5, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const points = [new Vector3(0, -20, 0), new Vector3(0, 20, 0)];
  const hit = findSketchReferenceHit(points, camera, new Vector2(0, 0), viewport, 7);
  assert.ok(hit, 'the rendered line crosses the center of the viewport');
  assert.ok(hit.distanceTo(new Vector3()) < 1e-10);
  assert.deepEqual(points.map((point) => point.toArray()), [[0, -20, 0], [0, 20, 0]]);
});

test('near/far clipping excludes invisible line portions and points in an orthographic view', () => {
  const camera = new OrthographicCamera(-5, 5, 5, -5, 1, 10);
  camera.updateMatrixWorld();
  const points = [new Vector3(-2, 0, -.5), new Vector3(2, 0, -20)];
  const target = points[0].clone().lerp(points[1], .25);
  const projected = target.clone().project(camera);
  const hit = findSketchReferenceHit(points, camera, new Vector2(projected.x, projected.y), viewport, 1);
  assert.ok(hit && hit.distanceTo(target) < 1e-10);
  for (const point of [points[0], points[1], new Vector3(0, 0, 1)]) {
    const ndc = point.clone().project(camera);
    const pointer = new Vector2(ndc.x, ndc.y);
    assert.equal(findSketchReferenceHit(points, camera, pointer, viewport, 1), null);
    assert.equal(findSketchReferenceHit([point], camera, pointer, viewport, 1), null);
  }
  assert.equal(findSketchReferenceHit([new Vector3(-1, 0, -11), new Vector3(1, 0, -20)], camera, new Vector2(), viewport, 7), null);
});

test('perspective hit distance uses the world position under the cursor', () => {
  const camera = new PerspectiveCamera(60, 1.6, .1, 100);
  camera.updateMatrixWorld();
  const points = [new Vector3(-1, 0, -2), new Vector3(1, 0, -10)];
  const target = points[0].clone().lerp(points[1], .35);
  const projected = target.clone().project(camera);
  const hit = findSketchReferenceHit(points, camera, new Vector2(projected.x, projected.y), viewport, 7);
  assert.ok(hit && hit.distanceTo(target) < 1e-10);
});
