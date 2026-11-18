import test from 'node:test';
import assert from 'node:assert/strict';
import { CadShape, createPointShape, createSketchLineShape } from './cadEngine';
import { reconcileSketchGraph, sketchDragAffectedIds } from './sketchGraph';
import { parseProject, serializeProject } from './projectFile';
import { createHistoryState, pushHistoryState, undoHistoryState } from './historyManager';
const fixture = () => {
  const a = createPointShape({ x: 0, y: 0 }), b = createPointShape({ x: 30, y: 0 }), c = createPointShape({ x: 30, y: 40 });
  const ab: CadShape = { ...createSketchLineShape(a.points[0], b.points[0]), endpointIds: [a.id, b.id] };
  const bc: CadShape = { ...createSketchLineShape(b.points[0], c.points[0]), endpointIds: [b.id, c.id] };
  return [a,b,c,ab,bc];
};
test('drag exclusions contain moving nodes and adjacent lines without spreading to fixed far nodes', () => {
  const [a,b,c,ab,bc]=fixture(); const scene=[a,b,c,ab,bc];
  assert.deepEqual(sketchDragAffectedIds(scene,[b.id]),new Set([b.id,ab.id,bc.id]));
  assert.deepEqual(sketchDragAffectedIds(scene,[ab.id],1),new Set([ab.id,b.id,bc.id]));
  assert.deepEqual(sketchDragAffectedIds(scene,[ab.id]),new Set([ab.id,a.id,b.id,bc.id]));
  assert.deepEqual(sketchDragAffectedIds(scene,[a.id,b.id,ab.id]),new Set([a.id,b.id,ab.id,bc.id]));
});
test('filtered drag snaps ignore self geometry but retain exact stationary targets', async () => {
  const {findGeometrySnap}=await import('./cadEngine');
  const [a,b,c,ab,bc]=fixture(); const t=createPointShape({x:50.3,y:25.4}); const scene=[a,b,c,ab,bc,t];
  const excluded=sketchDragAffectedIds(scene,[ab.id],1);const candidates=scene.filter(s=>!excluded.has(s.id));
  assert.equal(findGeometrySnap({x:29,y:1},candidates,3),null);
  assert.deepEqual(findGeometrySnap({x:50.6,y:25.7},candidates,3)?.point,t.points[0]);
  assert.deepEqual(findGeometrySnap({x:30,y:39},candidates,3)?.point,c.points[0]);
});
test('deleting a shared point removes incident lines atomically and one undo restores the graph', () => {
  const scene=fixture(); const next=reconcileSketchGraph(scene,scene.filter(s=>s.id!==scene[1].id));
  assert.deepEqual(next.map(s=>s.id),[scene[0].id,scene[2].id]);
  assert.deepEqual(undoHistoryState(pushHistoryState(createHistoryState(scene),next)).present,scene);
  const locked=scene.map((s,i)=>i===3?{...s,locked:true}:s);
  assert.throws(()=>reconcileSketchGraph(locked,locked.filter(s=>s.id!==scene[1].id)),/锁定/);
});
test('linked projects retain references and reject dangling, duplicate and inconsistent endpoints', () => {
  const scene=fixture(); const loaded=parseProject(serializeProject(scene));
  assert.deepEqual(loaded[3].endpointIds,scene[3].endpointIds);
  const moved=reconcileSketchGraph(loaded,loaded.map((s,i)=>i===1?{...s,points:[{x:35,y:5}]}:s));
  assert.deepEqual(moved[3].points[1],{x:35,y:5});assert.deepEqual(moved[4].points[0],{x:35,y:5});
  assert.throws(()=>parseProject(serializeProject(scene.filter((_,i)=>i!==1))),/不存在/);
  assert.throws(()=>parseProject(serializeProject([...scene,{...scene[3],id:'duplicate'}])),/重复/);
  assert.throws(()=>parseProject(serializeProject(scene.map((s,i)=>i===3?{...s,points:[{x:1,y:0},s.points[1]]}:s))),/不一致/);
});
