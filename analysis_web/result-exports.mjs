// Publication/export views of the same audited values used by resultVisualData.
// No inference, factor substitution, rasterization, or accounting is performed.
import {t,getLanguage} from './i18n.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number.isFinite(value)?(value!==0&&(Math.abs(value)<.0001||Math.abs(value)>=1e8)?value.toExponential(5):value.toLocaleString('en-US',{maximumSignificantDigits:7})):t('Unavailable','不可用');
const short=value=>String(value).length>32?String(value).slice(0,29)+'…':String(value);
const col=(key,en,zh)=>({key,label:t(en,zh)});
const svg=(title,height,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="960" height="${height}" fill="white"/>${body.replace(/<text\b([^>]*)>/g,(_,attrs)=>`<text${attrs} style="font-family:Arial, Microsoft YaHei, sans-serif;font-size:${attrs.match(/font-size="(\d+)"/)?.[1]||14}px;fill:#222">`)}</svg>`;
const status=data=>data.impact?.complete?'complete_declared_inventory':'incomplete_declared_inventory';
function metadata(data,title,notes){
  const p=data.provenance||{};
  return {title,language:getLanguage(),project:p.project||'',case_id:data.caseId,category:data.category||'',boundary:p.boundary||'',functional_unit:p.functionalUnit||'',declared_evidence:p.evidence||'imported_data',case_source:p.caseSource||'',source_model_sha256:p.modelHash||'',...(p.locallyModified?{locally_modified:true,origin_model_sha256:p.originModelHash||'',origin_evidence:p.originEvidence||'',origin_scope:t('Historical source only; native checks do not cover these locally modified inputs.','仅为历史来源；原生检查不覆盖这些经过本地修改的输入。')}:{}),interpretation:notes};
}
const commonColumns=()=>[col('case_id','Case','工况'),col('category','Impact category','影响类别'),col('unit','Unit','单位'),col('status','Record status','记录状态'),col('category_status','Category coverage','类别覆盖'),col('source','Source','来源'),col('evidence','Declared evidence','声明证据'),col('boundary','Declared boundary','声明边界'),col('functional_unit','Functional unit','功能单位'),col('project','Project','项目'),col('source_model_sha256','Declared source model SHA256','声明源模型 SHA256'),col('locally_modified','Locally modified inputs','本地已修改输入'),col('origin_model_sha256','Historical origin model SHA256','历史来源模型 SHA256'),col('origin_evidence','Historical origin evidence','历史来源证据'),col('language','Language','语言')];
const common=(data,source='')=>({case_id:data.caseId,category:data.category||'',category_status:status(data),source,evidence:data.provenance?.evidence||'imported_data',boundary:data.provenance?.boundary||'',functional_unit:data.provenance?.functionalUnit||'',project:data.provenance?.project||'',source_model_sha256:data.provenance?.modelHash||'',locally_modified:data.provenance?.locallyModified===true,origin_model_sha256:data.provenance?.originModelHash||'',origin_evidence:data.provenance?.originEvidence||'',language:getLanguage()});

// Impact factors are nonnegative under the audited schema. Padding remains
// finite for very large values and distinct for subnormal constant supports.
export function supportDomain(cuts){
  const values=cuts.flatMap(cut=>cut.range).filter(Number.isFinite);
  if(!values.length)return [0,1];
  const low=Math.min(...values),high=Math.max(...values);
  const padding=high>low?Math.max((high-low)*.12,Number.MIN_VALUE):high===0?1:Math.max(Math.abs(high)*.02,Number.MIN_VALUE);
  return [Math.max(0,low-padding),Math.min(Number.MAX_VALUE,high+padding)];
}

function supportExport(data){
  const title=t('Impact possibility supports','影响可能性支持区间'),impact=data.impact,unit=impact?.unit&&impact.contextConsistent!==false?`${impact.unit}/kg`:'';
  const notes=t('Triangular-input alpha-cut supports. Possibility levels, not probabilities, confidence intervals or predictive uncertainty.','三角模糊输入的 α 截集支持区间。属于可能性水平，不是概率、置信区间或预测不确定性。');
  const source=[...new Set([...(impact?.contributions.flatMap(row=>[row.source,row.inventorySource])||[]),data.provenance?.caseSource].filter(Boolean))].join(' | ');
  const rows=impact?.complete?impact.cuts.map(cut=>({...common(data,source),alpha:cut.alpha,lower:cut.range[0],upper:cut.range[1],unit,status:'available',method:impact.method,interpretation:notes})):[{...common(data,source),alpha:null,lower:null,upper:null,unit,status:'unavailable_incomplete_category',method:impact?.method||'',interpretation:notes}];
  let markup=null;
  if(impact?.complete&&impact.cuts.length){
    const domain=supportDomain(impact.cuts),scale=Math.max(Math.abs(domain[0]),Math.abs(domain[1]))||1;
    const x=value=>190+(value/scale-domain[0]/scale)/(domain[1]/scale-domain[0]/scale)*680;
    const height=impact.cuts.length*58+128;
    let body=`<text x="28" y="55">${esc(data.caseId)} · ${esc(data.category)} · ${esc(unit)}</text>`;
    impact.cuts.forEach((cut,index)=>{const y=92+index*58;body+=`<g><title>α=${cut.alpha}: ${cut.range[0]} / ${cut.range[1]} ${esc(unit)}</title><text x="28" y="${y+5}">α = ${cut.alpha}</text><line x1="190" x2="870" y1="${y}" y2="${y}" stroke="#ddd" stroke-dasharray="3 4"/><line x1="${x(cut.range[0])}" x2="${x(cut.range[1])}" y1="${y}" y2="${y}" stroke="#222" stroke-width="3"/><path d="M ${x(cut.range[0])} ${y-6} v 12 M ${x(cut.range[1])} ${y-6} v 12" stroke="#222" fill="none"/>${cut.alpha===1?`<circle cx="${x(cut.range[0])}" cy="${y}" r="5" fill="#222"/>`:''}<text x="190" y="${y+24}" font-size="12">${esc(number(cut.range[0]))} – ${esc(number(cut.range[1]))}</text></g>`;});
    const baseline=height-37;body+=`<line x1="190" x2="870" y1="${baseline}" y2="${baseline}" stroke="#aaa"/><text x="190" y="${height-14}">${esc(number(domain[0]))}</text><text x="870" y="${height-14}" text-anchor="end">${esc(number(domain[1]))}</text>`;
    markup=svg(title,height,body);
  }
  return {title,description:notes,metadata:metadata(data,title,notes),svg:markup,columns:[col('alpha','Alpha','α'),col('lower','Lower support','支持下界'),col('upper','Upper support','支持上界'),...commonColumns(),col('method','Method','方法'),col('interpretation','Interpretation','解释')],rows};
}

function contributionExport(data){
  const title=t('Inventory contributions','清单贡献'),impact=data.impact,unit=impact?.unit&&impact.contextConsistent!==false?`${impact.unit}/kg`:'';
  const rows=[...(impact?.contributions||[]).map(row=>({...common(data,[row.inventorySource,row.source].filter(Boolean).join(' | ')),id:row.id,name:row.name,value:row.nominal,unit:row.unit?`${row.unit}/kg`:unit,method:row.method||impact.method,factor_id:row.factor_id,factor_source:row.source,inventory_source:row.inventorySource,status:impact.contextConsistent===false?'characterized_but_category_context_inconsistent':'characterized'})),...(impact?.missing||[]).map(row=>({...common(data,row.source),id:row.id,name:row.name,value:null,unit,method:null,factor_id:row.factorId,factor_source:null,inventory_source:row.source,status:'uncharacterized'}))];
  const shown=(impact?.contributions||[]).slice(0,12),total=impact?.contributions.length||0;
  const notes=impact?.contextConsistent===false?t('This category mixes methods or impact units. No common chart or subtotal is exported. CSV retains individual contributions with their own units and methods.','此类别混用了方法或影响单位，不导出共同图表或小计。CSV 按各项自己的单位和方法保留贡献。'):`${t('Chart shows the largest characterized contributions; CSV retains every characterized and missing row. Missing values are not zero.','图中显示最大的已表征贡献，CSV 保留全部已表征及缺失清单项。缺失值不等于零。')} ${shown.length}/${total}. ${impact?.complete?t('Complete declared inventory.','已覆盖声明的全部清单。'):t('Partial subtotal only; a complete footprint is withheld.','仅显示部分小计，不提供完整足迹。')}`;
  let markup=null;
  if(shown.length&&impact.contextConsistent!==false){
    const max=Math.max(...shown.map(row=>row.nominal),0)||1,height=shown.length*43+125;
    let body=`<text x="28" y="55">${esc(data.caseId)} · ${esc(data.category)} · ${esc(unit)}</text>`;
    shown.forEach((row,index)=>{const y=83+index*43;body+=`<g><title>${esc(row.name)}: ${row.nominal} ${esc(unit)} · ${esc(row.source)}</title><text x="28" y="${y+15}">${esc(short(row.name||row.id))}</text><rect x="295" y="${y}" width="${row.nominal/max*465}" height="20" fill="#444"/><text x="778" y="${y+15}">${esc(number(row.nominal))}</text></g>`;});
    body+=`<text x="28" y="${height-32}">${esc(impact.complete?t('Nominal total','名义总量'):t('Covered-row subtotal only','仅已覆盖清单项小计'))}: ${esc(number(impact.complete?impact.total:impact.subtotal))} ${esc(unit)}</text><text x="28" y="${height-11}" font-size="12">${esc(t('Shown / characterized','已显示 / 已表征'))}: ${shown.length}/${total} · ${esc(t('Uncharacterized','尚未表征'))}: ${impact.missing.length}</text>`;
    markup=svg(title,height,body);
  }
  return {title,description:notes,metadata:metadata(data,title,notes),svg:markup,columns:[col('id','Inventory ID','清单编号'),col('name','Inventory name','清单名称'),col('value','Nominal contribution','名义贡献'),col('method','Method','方法'),col('factor_id','Factor ID','因子编号'),col('factor_source','Factor source','因子来源'),col('inventory_source','Inventory source','清单来源'),...commonColumns()],rows};
}

function equipmentExport(data){
  const title=t('Signed equipment heat and work','设备有符号热量与轴功'),notes=t('Q is heat; W is shaft work. Positive into each block. Missing blocks are unavailable, not zero. Duties are separate from purchased-energy inventory; no recovery credit is inferred.','Q 为热量，W 为轴功；正号表示输入设备。缺失设备值为不可用，不视为零。负荷与购入能源清单独立，不推断热回收抵扣。');
  const rows=[...data.blocks.map(row=>({...common(data,row.source),id:row.id,heat:row.heat,power:row.power,mass_residual:row.mass_residual_kg_h,energy_residual:row.energy_residual_kW,unit:'kW',status:row.within_tolerance?'within_numerical_tolerance':'outside_numerical_tolerance'})),...data.missingBlocks.map(id=>({...common(data,data.missingBlockSources[id]),id,heat:null,power:null,mass_residual:null,energy_residual:null,unit:'kW',status:'incomplete_balance_inputs'}))];
  const shown=data.blocks.slice(0,20);let markup=null;
  if(shown.length){
    const peak=Math.max(...shown.flatMap(row=>[Math.abs(row.heat),Math.abs(row.power)]))||1,height=shown.length*64+140;
    const x=value=>550+value/peak*270;
    let body=`<text x="28" y="55">${esc(data.caseId)} · kW</text><text x="280" y="79">−${esc(number(peak))}</text><text x="550" y="79" text-anchor="middle">0</text><text x="820" y="79" text-anchor="end">+${esc(number(peak))}</text><line x1="550" x2="550" y1="88" y2="${height-42}" stroke="#999"/>`;
    shown.forEach((row,index)=>{const y=96+index*64;body+=`<text x="28" y="${y+20}">${esc(short(row.id))}</text>`;[['Q',row.heat],['W',row.power]].forEach(([kind,value],slot)=>{const yy=y+slot*25;body+=`<g><title>${esc(row.id)} ${kind}: ${value} kW · ${esc(row.source)}</title><text x="242" y="${yy+14}">${kind}</text><rect x="${Math.min(550,x(value))}" y="${yy}" width="${Math.abs(value)/peak*270}" height="16" fill="${kind==='Q'?'#333':'#aaa'}"/><text x="846" y="${yy+14}">${esc(number(value))}</text></g>`;});});
    body+=`<text x="28" y="${height-17}" font-size="12">${esc(t('Shown / normalized blocks','已显示 / 已统一单位设备'))}: ${shown.length}/${data.blocks.length} · ${esc(t('Unavailable blocks','不可用设备'))}: ${data.missingBlocks.length}</text>`;
    markup=svg(title,height,body);
  }
  return {title,description:notes,metadata:metadata(data,title,`${notes} ${t('SVG shows at most 20 blocks; CSV includes all blocks.','SVG 最多显示 20 个设备；CSV 包含全部设备。')}`),svg:markup,columns:[col('id','Block ID','设备编号'),col('heat','Q / kW','Q / kW'),col('power','W / kW','W / kW'),col('mass_residual','Mass residual / kg/h','质量残差 / kg/h'),col('energy_residual','Energy residual / kW','能量残差 / kW'),...commonColumns()],rows};
}

function caseExport(data){
  const title=t('Nominal case metrics','工况名义指标'),notes=t('All cases retained. Metrics use separate units; incomplete values remain unavailable. This export does not rank cases or establish comparability.','保留全部工况，各指标使用独立单位，缺失值保留为不可用。本导出不进行排名，也不认证工况可比性。');
  const rows=data.cases.flatMap(row=>[['energy','kWh/kg'],['impact',data.impact?.unit&&data.impact.contextConsistent!==false?`${data.impact.unit}/kg`:''],['yield','%']].map(([metric,unit])=>({...common(data,row.source),case_id:row.id,metric,value:row[metric],unit,status:row[metric]===null?'unavailable':'available',category_status:row.impactComplete?'complete_declared_inventory':'incomplete_declared_inventory',balance_status:row.balanceWithinTolerance?'within_numerical_tolerance':'needs_review',comparability_confirmed:data.comparable})));
  return {title,description:notes,metadata:metadata(data,title,notes),svg:null,columns:[col('metric','Metric','指标'),col('value','Nominal value','名义值'),...commonColumns(),col('balance_status','Balance status','衡算状态'),col('comparability_confirmed','Comparability confirmed','已确认可比性')],rows};
}

export function buildResultExport(data,kind){
  if(!data)throw new Error('Calculate current results before exporting');
  if(kind==='supports')return supportExport(data);
  if(kind==='contributions')return contributionExport(data);
  if(kind==='equipment')return equipmentExport(data);
  if(kind==='cases')return caseExport(data);
  throw new Error('Unknown result chart export');
}
