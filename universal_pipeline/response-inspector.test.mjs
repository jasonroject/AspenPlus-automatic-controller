import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {responseSlice,responseChart,responseChartLayout} from '../analysis_web/pipeline-charts.mjs';
import {inspectionPoints,nearestInspectionIndex,inspectionKey,mountResponseInspector,clearResponseInspector} from '../analysis_web/response-inspector.mjs';
import {createStudyLoader,fsJsonFetcher} from '../analysis_web/study-loader.mjs';
const study=createStudyLoader({fetchJson:fsJsonFetcher(new URL('../analysis_web/data/study/',import.meta.url))});

test('nearest-x inspection returns exported values and separately identifies exact native evidence',async()=>{
  const analysis=await study.htlAnalysis();
  const observations=await study.observations();
  const selected=analysis.grid.rows.find(row=>row.temperature_C===325&&row.length_m===8.5);
  const before=JSON.stringify({selected,observations});
  const slice=responseSlice(analysis.grid.rows,observations.rows,selected,'temperature_C','HR_electricity_kWh'),points=inspectionPoints(slice);
  const point=points[nearestInspectionIndex(points,325.21)];
  assert.equal(point.x,325);assert.equal(point.value,selected.HR_electricity_kWh);
  assert.equal(point.native[0].value,12.2727297050724);assert.notEqual(point.native[0].value,point.value);
  assert.equal(points[nearestInspectionIndex(points,325.3)].x,325.5);
  assert.equal(points[nearestInspectionIndex(points,325.3)].native.length,0);
  assert.equal(JSON.stringify({selected,observations}),before);
});

test('inspection never rounds native coordinates onto a grid point or accepts nonfinite pointer coordinates',()=>{
  const slice={axis:'x',fixed:'z',metric:'y',predictions:[{x:1,z:2,y:3},{x:4,z:2,y:5}],native:[{x:1.0000001,z:2,y:9},{x:1,z:2.000001,y:8}],selected:{x:1}};
  const points=inspectionPoints(slice);assert.deepEqual(points.map(point=>point.native),[[],[]]);
  assert.equal(nearestInspectionIndex(points,2.5),0); // Stable lower-coordinate choice on a tie.
  assert.equal(nearestInspectionIndex(points,-10),0);assert.equal(nearestInspectionIndex(points,10),1);
  assert.equal(nearestInspectionIndex(points,NaN),-1);assert.equal(nearestInspectionIndex([],1),-1);
  assert.equal(inspectionKey(1,'Home',3),0);assert.equal(inspectionKey(1,'End',3),2);
  assert.equal(inspectionKey(0,'ArrowLeft',3),0);assert.equal(inspectionKey(2,'ArrowRight',3),2);
  assert.equal(inspectionKey(1,'ArrowRight',3),2);assert.equal(inspectionKey(1,'Tab',3),null);
});

// Minimal event-capable DOM double: checks controller behavior independently of a
// browser, without replacing the real chart math or asserting screenshot pixels.
class Node extends EventTarget {
  constructor(tag,ownerDocument){super();this.tag=tag;this.ownerDocument=ownerDocument;this.children=[];this.attrs=new Map();this.classes=new Set();this.classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value)};this.textContent='';}
  setAttribute(key,value){this.attrs.set(key,value);}getAttribute(key){return this.attrs.get(key)??null;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}
  querySelector(selector){const attribute=selector.slice(1,-1);for(const child of this.children){if(child.attrs.has(attribute))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
  getScreenCTM(){return {inverse:()=>({})};}
  createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};}
}
function dom(){
  const document={createElement:tag=>new Node(tag,document)},container=document.createElement('div'),chart=document.createElement('svg'),marker=document.createElement('g'),line=document.createElement('line'),point=document.createElement('circle');
  chart.setAttribute('data-response-chart','');marker.setAttribute('data-response-inspection','');line.setAttribute('data-inspection-line','');point.setAttribute('data-inspection-point','');
  marker.append(line,point);chart.append(marker);container.append(chart);return {container,chart,marker,line,point};
}
function fire(node,type,properties){const event=new Event(type,{cancelable:true});Object.assign(event,properties);node.dispatchEvent(event);return event;}

test('slider, keyboard and touch inspect without modifying the selected prediction; remount cleans listeners',()=>{
  const selected=Object.freeze({x:2,z:4,y:20}),slice={axis:'x',fixed:'z',metric:'y',selected,predictions:[{x:1,z:4,y:10},selected,{x:3,z:4,y:30}],native:[{x:2,z:4,y:19,source:'<source>',split:'holdout'}]};
  const before=JSON.stringify(slice),{container,chart,marker,point}=dom();
  const labels={xLabel:'Temperature / °C',yLabel:'Energy / kWh',nativeLabel:'原生仿真',predictionLabel:'GP 预测',noNativeLabel:'无原生数据'};
  const cleanup=mountResponseInspector(container,slice,labels),panel=container.children[1],slider=panel.children[1],values=panel.children[3];
  assert.equal(slider.value,'1');assert.match(slider.getAttribute('aria-valuetext'),/GP 预测.*Energy \/ kWh: 20/);
  assert.equal(values.children[5].textContent,'19 · holdout · <source>');
  assert.ok(fire(slider,'keydown',{key:'End'}).defaultPrevented);assert.equal(slider.value,'2');assert.equal(values.children[5].textContent,'无原生数据');
  fire(slider,'keydown',{key:'Home'});assert.equal(slider.value,'0');
  slider.value='2';fire(slider,'input',{});assert.equal(values.children[3].textContent,'30');
  const layout=responseChartLayout(slice);
  fire(chart,'pointerdown',{clientX:layout.x(2.12),clientY:100,pointerType:'touch'});assert.equal(slider.value,'1');assert.equal(point.getAttribute('cx'),String(layout.x(2)));
  fire(chart,'pointermove',{clientX:layout.x(1.1),clientY:100,pointerType:'mouse'});assert.equal(slider.value,'0');
  fire(chart,'pointermove',{clientX:1,clientY:1});assert.equal(slider.value,'0');
  assert.equal(JSON.stringify(slice),before);assert.equal(marker.getAttribute('visibility'),'visible');
  mountResponseInspector(container,slice,labels);assert.equal(container.children.length,2);
  cleanup();assert.equal(container.children.length,2); // An old cleanup cannot remove the new mount.
  const currentSlider=container.children[1].children[1];fire(slider,'keydown',{key:'End'});assert.equal(currentSlider.value,'1');
  clearResponseInspector(container);assert.equal(container.children.length,1);assert.equal(marker.getAttribute('visibility'),'hidden');
  // Cleanup returned by an earlier mount is harmless after a subsequent cleanup.
  cleanup();assert.equal(container.children.length,1);
});

test('response markup retains its accessible image contract and an independently positioned inspection overlay',()=>{
  const slice={axis:'x',metric:'y',fixed:'z',predictions:[{x:1,y:2,z:1}],native:[],selected:{x:1,y:2,z:1}};
  const chart=responseChart(slice,{xLabel:'x',yLabel:'kWh',title:'Response',nativeLabel:'Native',selectedLabel:'Selected'});
  assert.match(chart,/role="img" aria-label="Response"/);assert.match(chart,/data-response-chart/);assert.match(chart,/data-response-inspection visibility="hidden"/);
  assert.ok(!/NaN|Infinity/.test(chart));
  const {container}=dom();mountResponseInspector(container,slice);assert.equal(container.children[1].children[1].disabled,true);
  clearResponseInspector(container);
});
