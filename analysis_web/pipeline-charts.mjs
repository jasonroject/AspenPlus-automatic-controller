// Presentation helpers use exported values directly; they do not fit or interpolate a model.
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value, digits=2) => Number.isFinite(value) ? value.toLocaleString('en-US',{maximumFractionDigits:digits}) : '—';
export const conditionKey = (temperature,length) => `${Number(temperature).toFixed(2)}:${Number(length).toFixed(2)}`;
export function responseSlice(rows, observations, selected, axis, metric) {
  const fixed = axis === 'temperature_C' ? 'length_m' : 'temperature_C';
  const onSlice = row => Math.abs(row[fixed]-selected[fixed])<1e-7 && Number.isFinite(row[metric]);
  const predictions = rows.filter(onSlice).sort((a,b)=>a[axis]-b[axis]);
  const bounds = [predictions[0]?.[axis],predictions.at(-1)?.[axis]];
  const native = observations.filter(row=>onSlice(row) && row[axis]>=bounds[0] && row[axis]<=bounds[1]).sort((a,b)=>a[axis]-b[axis]);
  return {axis,fixed,metric,predictions,native,selected};
}
export function climateContributions(row, scenario, accounting) {
  if (!(row.target_kg_h>0)) return [];
  return [
    {id:'feed',value:accounting.fixed_feed_GWP/row.target_kg_h},
    {id:'electricity',value:row[scenario+'_electricity_kWh']*accounting.electricity_beta/row.target_kg_h},
    {id:'direct',value:row.direct_kgCO2eq_h/row.target_kg_h},
    {id:'wastewater',value:row.water_kg_h/1000*accounting.wastewater_gamma/row.target_kg_h}
  ];
}
export function orderedCandidates(rows, order='frequency') {
  return [...rows].sort(order==='nominal' ? (a,b)=>a.nominal_rank-b.nominal_rank : (a,b)=>b.top1_fraction-a.top1_fraction || a.nominal_rank-b.nominal_rank);
}
export function supportedPoint(rows, temperature, length) {
  // Do not round an unsupported query onto a supported cell.
  if(!Number.isFinite(temperature)||!Number.isFinite(length))return null;
  return rows.find(row=>Math.abs(row.temperature_C-temperature)<1e-8 && Math.abs(row.length_m-length)<1e-8) ?? null;
}
const svg = (width,height,title,body,attributes='') => `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(title)}"${attributes}><title>${escapeHTML(title)}</title>${body}</svg>`;
export function pairChart(rows, unit, title) {
  const width=420,height=164,left=45,right=70,plot=width-left-right,max=Math.max(...rows.map(r=>r.value),0)*1.12||1;
  let body=`<text x="${left}" y="15">${escapeHTML(unit)}</text>`;
  for(let i=0;i<4;i++){const value=max*i/3,x=left+plot*i/3;body+=`<line x1="${x}" y1="29" x2="${x}" y2="129" stroke="#ebebe7"/><text x="${x}" y="150" text-anchor="middle">${num(value,1)}</text>`;}
  rows.forEach((row,i)=>{const y=40+i*50;body+=`<text x="0" y="${y+20}">${escapeHTML(row.label)}</text><rect x="${left}" y="${y}" width="${row.value/max*plot}" height="30" rx="5" fill="${i?'#303030':'#b6b6b1'}"/><text class="chart-value" x="${left+row.value/max*plot+9}" y="${y+20}">${num(row.value,3)}</text>`;});
  return svg(width,height,title,body);
}
export function responseChartLayout(slice) {
  const {axis,metric,predictions,native}=slice;
  if(!predictions.length)return null;
  const values=[...predictions,...native].map(row=>row[metric]),lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo)*.1||Math.abs(hi)*.05||1;
  const minY=Math.max(0,lo-pad),maxY=hi+pad,minX=predictions[0][axis],maxX=predictions.at(-1)[axis];
  const w=760,h=305,left=64,top=35,plotW=670,plotH=211;
  const x=value=>left+(value-minX)/(maxX-minX||1)*plotW,y=value=>top+plotH-(value-minY)/(maxY-minY||1)*plotH;
  return {w,h,left,top,plotW,plotH,minX,maxX,minY,maxY,x,y};
}
export function responseChart(slice, {xLabel,yLabel,title,nativeLabel,selectedLabel}) {
  const {axis,metric,predictions,native,selected}=slice;
  if(!predictions.length)return '';
  const {w,h,left,top,plotW,plotH,minX,maxX,minY,maxY,x,y}=responseChartLayout(slice);
  let body=`<text x="${left}" y="16">${escapeHTML(yLabel)}</text>`;
  for(let i=0;i<5;i++){const vy=minY+(maxY-minY)*i/4,yy=y(vy);body+=`<line x1="${left}" y1="${yy}" x2="${left+plotW}" y2="${yy}" stroke="#e9e9e6"/><text x="${left-12}" y="${yy+4}" text-anchor="end">${num(vy,2)}</text>`;}
  for(let i=0;i<5;i++){const vx=minX+(maxX-minX)*i/4,xx=x(vx);body+=`<text x="${xx}" y="${h-37}" text-anchor="middle">${num(vx,2)}</text>`;}
  body+=`<text x="${left+plotW/2}" y="${h-9}" text-anchor="middle">${escapeHTML(xLabel)}</text><polyline fill="none" stroke="#343434" stroke-width="2.1" points="${predictions.map(row=>`${x(row[axis]).toFixed(2)},${y(row[metric]).toFixed(2)}`).join(' ')}"/>`;
  native.forEach(row=>{body+=`<circle cx="${x(row[axis])}" cy="${y(row[metric])}" r="4.5" fill="white" stroke="#333" stroke-width="1.8"><title>${escapeHTML(nativeLabel)} · ${num(row[axis])}: ${num(row[metric],4)} · ${escapeHTML(row.split)}</title></circle>`;});
  body+=`<line x1="${x(selected[axis])}" y1="${top}" x2="${x(selected[axis])}" y2="${top+plotH}" stroke="#999" stroke-dasharray="3 4"/><circle cx="${x(selected[axis])}" cy="${y(selected[metric])}" r="5" fill="#222" stroke="white" stroke-width="1.5"><title>${escapeHTML(selectedLabel)}: ${num(selected[metric],4)}</title></circle>`;
  body+=`<g data-response-inspection visibility="hidden" aria-hidden="true" pointer-events="none"><line data-inspection-line y1="${top}" y2="${top+plotH}" stroke="#222" stroke-width="1" stroke-dasharray="2 3"/><circle data-inspection-point r="6" fill="white" stroke="#222" stroke-width="2.5"/></g>`;
  return svg(w,h,title,body,' data-response-chart');
}
export function contributionChart(rows,title) {
  const total=rows.reduce((s,r)=>s+r.value,0),colors=['#272727','#73736f','#b6b6b0','#e5e5df'];let x=0;
  const body=rows.map((row,i)=>{const w=total>0?row.value/total*760:0;const part=`<rect x="${x}" y="8" width="${w}" height="34" fill="${colors[i]}"><title>${escapeHTML(row.label)}: ${num(row.value,5)}</title></rect>`;x+=w;return part;}).join('');
  return svg(760,50,title,body);
}
export function rankChart(rows,{title,conditionLabel,rankLabel,topLabel,nominalLabel}) {
  const shown=rows.slice(0,8),w=760,h=shown.length*42+67,left=158,right=88,max=Math.max(2,...shown.map(r=>r.rank_p05_p50_p95[2])),plot=w-left-right,x=value=>left+(value-1)/(max-1)*plot;
  let body=`<text x="0" y="14">${escapeHTML(conditionLabel)}</text><text x="${w-4}" y="14" text-anchor="end">${escapeHTML(topLabel)}</text>`;
  const ticks=[...new Set([1,...Array.from({length:4},(_,i)=>Math.round(1+(max-1)*(i+1)/4))])];
  ticks.forEach(value=>{body+=`<line x1="${x(value)}" x2="${x(value)}" y1="26" y2="${h-43}" stroke="#e9e9e5"/><text x="${x(value)}" y="${h-23}" text-anchor="middle">${value}</text>`;});
  shown.forEach((row,i)=>{const yy=43+i*42,[lo,mid,hi]=row.rank_p05_p50_p95;body+=`<text class="chart-value" x="0" y="${yy}">${num(row.temperature_C)} °C / ${num(row.length_m)} m</text><text x="0" y="${yy+14}">${escapeHTML(nominalLabel)} ${row.nominal_rank}</text><line x1="${x(lo)}" x2="${x(hi)}" y1="${yy}" y2="${yy}" stroke="#666" stroke-width="2"/><line x1="${x(lo)}" x2="${x(lo)}" y1="${yy-5}" y2="${yy+5}" stroke="#666"/><line x1="${x(hi)}" x2="${x(hi)}" y1="${yy-5}" y2="${yy+5}" stroke="#666"/><circle cx="${x(mid)}" cy="${yy}" r="4.5" fill="#222"><title>P05 / P50 / P95: ${num(lo)} / ${num(mid)} / ${num(hi)}</title></circle><text class="chart-value" x="${w-4}" y="${yy+4}" text-anchor="end">${num(row.top1_fraction*100,1)}%</text>`;});
  body+=`<text x="${left+plot/2}" y="${h-3}" text-anchor="middle">${escapeHTML(rankLabel)}</text>`;
  return svg(w,h,title,body);
}
export function metricRangeChart(interval,extent,title) {
  const x=v=>12+(v-extent[0])/(extent[1]-extent[0]||1)*216,[lo,mid,hi]=interval;
  return svg(240,33,title,`<line x1="12" x2="228" y1="15" y2="15" stroke="#e6e6e2" stroke-width="3"/><line x1="${x(lo)}" x2="${x(hi)}" y1="15" y2="15" stroke="#444" stroke-width="3"/><circle cx="${x(mid)}" cy="15" r="4.5" fill="#222"/>`);
}
