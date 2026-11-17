// Inspect existing exported points only. This controller does not calculate predictions
// or write to the prediction form, selected condition, or source arrays.
import {responseChartLayout} from './pipeline-charts.mjs';

const mounts = new WeakMap();
let nextId = 0;

export function inspectionPoints(slice) {
  const {axis,metric,fixed,predictions,native}=slice;
  return predictions.map(row=>({
    x:row[axis],value:row[metric],
    native:native.filter(observed=>observed[axis]===row[axis] && observed[fixed]===row[fixed])
      .map(observed=>({value:observed[metric],split:observed.split??'',source:observed.source??'',record:observed.source_record??''}))
  }));
}

export function nearestInspectionIndex(points,coordinate) {
  if(!points.length || !Number.isFinite(coordinate))return -1;
  let nearest=0;
  for(let i=1;i<points.length;i++)if(Math.abs(points[i].x-coordinate)<Math.abs(points[nearest].x-coordinate))nearest=i;
  return nearest;
}

export function inspectionKey(index,key,count) {
  if(count<1)return -1;
  if(key==='Home')return 0;
  if(key==='End')return count-1;
  if(key==='ArrowLeft'||key==='ArrowDown')return Math.max(0,index-1);
  if(key==='ArrowRight'||key==='ArrowUp')return Math.min(count-1,index+1);
  return null;
}

export function clearResponseInspector(container) {
  mounts.get(container)?.();
}

export function mountResponseInspector(container,slice,labels={}) {
  clearResponseInspector(container);
  const chart=container.querySelector('[data-response-chart]'),layout=responseChartLayout(slice),points=inspectionPoints(slice);
  if(!chart||!layout||!points.length)return ()=>{};
  const {xLabel=slice.axis,yLabel=slice.metric,predictionLabel='GP prediction',nativeLabel='Native simulation',noNativeLabel='No native value at this exact coordinate.',inspectLabel='Inspect exported points',hint='Move across the chart or use the slider. Arrow keys, Home and End inspect existing grid points; prediction inputs stay unchanged.'}=labels;
  const document=container.ownerDocument,element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const panel=element('div','response-inspector'),label=element('label','inspection-label',inspectLabel),slider=element('input','inspection-slider'),help=element('p','inspection-hint',hint),readout=element('dl','inspection-values');
  const id=`response-inspection-${++nextId}`;
  slider.type='range';slider.min='0';slider.max=String(points.length-1);slider.step='1';slider.id=id;
  slider.disabled=points.length===1;label.htmlFor=id;help.id=id+'-help';slider.setAttribute('aria-describedby',help.id);
  readout.setAttribute('data-no-i18n','');
  const coordinateValue=element('dd'),predictionValue=element('dd'),nativeValue=element('dd');
  readout.append(element('dt','',xLabel),coordinateValue,element('dt','',`${predictionLabel} · ${yLabel}`),predictionValue,element('dt','',`${nativeLabel} · ${yLabel}`),nativeValue);
  panel.append(label,slider,help,readout);container.append(panel);
  const marker=chart.querySelector('[data-response-inspection]'),line=chart.querySelector('[data-inspection-line]'),dot=chart.querySelector('[data-inspection-point]');
  let index=-1;
  function inspect(next) {
    if(!Number.isInteger(next)||next<0||next>=points.length||next===index)return;
    index=next;const point=points[index],xx=layout.x(point.x);
    slider.value=String(index);coordinateValue.textContent=String(point.x);predictionValue.textContent=String(point.value);
    nativeValue.textContent=point.native.length?point.native.map(row=>`${row.value}${row.split?' · '+row.split:''}${row.source?' · '+row.source:''}${row.record?' / '+row.record:''}`).join('; '):noNativeLabel;
    slider.setAttribute('aria-valuetext',`${xLabel}: ${point.x}; ${predictionLabel} · ${yLabel}: ${point.value}; ${nativeLabel}: ${nativeValue.textContent}`);
    marker.setAttribute('visibility','visible');line.setAttribute('x1',String(xx));line.setAttribute('x2',String(xx));dot.setAttribute('cx',String(xx));dot.setAttribute('cy',String(layout.y(point.value)));
  }
  function pointer(event) {
    // getScreenCTM accounts for responsive SVG sizing and viewBox letterboxing.
    const matrix=chart.getScreenCTM();if(!matrix)return;
    const position=chart.createSVGPoint();position.x=event.clientX;position.y=event.clientY;
    const local=position.matrixTransform(matrix.inverse());
    if(local.x<layout.left||local.x>layout.left+layout.plotW||local.y<layout.top||local.y>layout.top+layout.plotH)return;
    const coordinate=layout.minX+(local.x-layout.left)/layout.plotW*(layout.maxX-layout.minX);
    inspect(nearestInspectionIndex(points,coordinate));
  }
  const onInput=()=>inspect(Number(slider.value));
  const onKey=event=>{const next=inspectionKey(index,event.key,points.length);if(next!==null){event.preventDefault();inspect(next);}};
  chart.classList.add('response-inspectable');
  chart.addEventListener('pointermove',pointer);chart.addEventListener('pointerdown',pointer);
  slider.addEventListener('input',onInput);slider.addEventListener('keydown',onKey);
  inspect(Math.max(0,nearestInspectionIndex(points,slice.selected?.[slice.axis])));
  let active=true;
  const cleanup=()=>{
    if(!active)return;
    active=false;
    chart.removeEventListener('pointermove',pointer);chart.removeEventListener('pointerdown',pointer);
    slider.removeEventListener('input',onInput);slider.removeEventListener('keydown',onKey);
    chart.classList.remove('response-inspectable');marker.setAttribute('visibility','hidden');panel.remove();mounts.delete(container);
  };
  mounts.set(container,cleanup);return cleanup;
}
