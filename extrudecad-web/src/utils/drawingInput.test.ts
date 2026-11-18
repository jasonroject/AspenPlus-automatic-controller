import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingPoint } from './drawingInput';

test('drawing coordinates distinguish absolute, relative, and polar points', () => {
  const options = { tool: 'line' as const, start: { x: 10, y: 20 }, cursor: { x: 20, y: 20 } };
  assert.deepEqual(parseDrawingPoint('30,40', options), { x: 30, y: 40 });
  assert.deepEqual(parseDrawingPoint('@30,-40', options), { x: 40, y: -20 });
  const polar = parseDrawingPoint('@50<90', options);
  assert.ok(Math.abs(polar.x - 10) < 1e-9);
  assert.equal(polar.y, 70);
  assert.deepEqual(parseDrawingPoint('12.5', options), { x: 22.5, y: 20 });
});

test('rectangle size starts at the first corner and follows mouse quadrant', () => {
  assert.deepEqual(parseDrawingPoint('80×50', { tool: 'rect', start: { x: 10, y: 20 }, cursor: { x: -5, y: -5 } }), { x: -70, y: -30 });
});

test('initial coordinate accepts signed decimal values without rounding', () => {
  assert.deepEqual(parseDrawingPoint('-.125,2.3456', { tool: 'line', start: null, cursor: { x: 0, y: 0 } }), { x: -0.125, y: 2.3456 });
});

test('standalone points use exact absolute coordinates independently', () => {
  const options = { tool: 'point' as const, start: null, cursor: { x: 50, y: -30 } };
  assert.deepEqual(parseDrawingPoint('-12.3456,0.0001', options), { x: -12.3456, y: 0.0001 });
  assert.deepEqual(parseDrawingPoint('40,20', options), { x: 40, y: 20 });
  for (const input of ['@10,20', '@20<90', '10', '10×20']) assert.throws(() => parseDrawingPoint(input, options));
});

test('invalid or directionless values cannot silently produce geometry', () => {
  const options = { tool: 'line' as const, start: { x: 0, y: 0 }, cursor: { x: 0, y: 0 } };
  for (const input of ['0', '-5', '20', '@0<30', '10,foo', 'Infinity,2', '100001,0']) assert.throws(() => parseDrawingPoint(input, options));
  assert.throws(() => parseDrawingPoint('@10,20', { ...options, start: null }));
});
