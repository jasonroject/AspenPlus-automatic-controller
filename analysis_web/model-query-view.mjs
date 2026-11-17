// Small delegated UI for the explicitly trusted public v2 bundle only.
import {prepareBrowserSurrogate} from './browser-surrogate.mjs';
import {t} from './i18n.mjs';
import {downloadText} from './chart-export.mjs';
const sourcePath='data/generic-htl-extension/model.bundle.json';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>value!==0&&(Math.abs(value)<.0001||Math.abs(value)>=1e8)?value.toExponential(6):value.toLocaleString('en-US',{maximumSignificantDigits:8});
const fieldName=id=>({reactor_temperature_K:t('Reactor temperature','反应温度'),tube_length_m:t('Tube length','管长'),purchased_energy_kWh_kg:t('Purchased energy','购入能量'),yield_fraction:t('Target/feed yield (fraction)','目标产物/进料产率（分数）'),'impact:Climate change':t('Climate impact','气候影响')})[id]||id;

export function createModelQueryState(bundle,trust={}){
  if(trust.trustedV2!==true||trust.sourcePath!==sourcePath||typeof trust.sourceSha256!=='string'||!/^[a-f0-9]{64}$/i.test(trust.sourceSha256))return null;
  const model=prepareBrowserSurrogate(bundle);
  return {model,datasetMetadata:structuredClone(bundle.dataset_metadata),source:{path:sourcePath,sha256:trust.sourceSha256},values:Object.fromEntries(model.inputs.map(input=>[input.id,String(Number(model.defaults[input.id].toPrecision(12)))])),result:null,phase:'idle',errorCode:null};
}

function statusText(state){
  if(state.phase==='error'){
    const messages={invalid_input:t('Enter a finite value for each input in its stated native unit.','请按标出的原生单位，为每个输入填写有限数值。'),
      outside_bounds:t('This condition is outside the declared input bounds. Adjust the inputs; no estimate is shown.','此工况超出声明的输入边界。请调整输入；当前不显示估算。'),
      outside_hull:t('This condition is outside the actual training domain. Adjust the inputs; no extrapolation is offered.','此工况超出实际训练域。请调整输入；不提供外推结果。'),
      unit_mismatch:t('Input units do not match this frozen model. No estimate is available.','输入单位与冻结模型不匹配，估算不可用。')};
    return messages[state.errorCode]||t('An estimate is unavailable for these inputs. No previous result is retained.','当前输入无法得到可用估算，之前的结果已清除。');
  }
  if(state.phase==='edited')return t('Inputs changed. Calculate again to update the estimate.','输入已更改，请重新计算估算值。');
  if(state.phase==='saved')return t('Estimate saved with exact values, units and model/source hashes.','已保存估算，包含完整精度数值、单位及模型/来源哈希。');
  if(state.result)return t('Frozen-model mean estimate. This is not a new Aspen simulation.','冻结模型的均值估算；这不是一次新的 Aspen 模拟。');
  return t('Defaults use the training-input mean. Enter a condition, then calculate.','默认值为训练输入均值。填写工况后点击计算。');
}
function resultHTML(state){
  if(!state.result)return '';
  return `<dl class="model-query-metrics">${state.model.responses.map(response=>`<div><dt>${esc(fieldName(response.id))}</dt><dd title="${esc(String(state.result.outputs[response.id]))}">${esc(number(state.result.outputs[response.id]))}<small data-no-i18n>${esc(response.unit)}</small></dd></div>`).join('')}</dl>`;
}
export function modelQueryHTML(state){
  if(!state)return '';
  return `<details data-artifact-query data-model-query class="model-query"><summary>${t('Try a condition','试算一个工况')}</summary><p class="panel-foot">${t('Evaluate the frozen v2 model inside its declared bounds and actual training convex hull. Inputs use native units; temperature is kelvin.','在声明边界与实际训练凸包内计算冻结 v2 模型。输入采用原生单位；温度为开尔文。')}</p><div class="model-query-inputs">${state.model.inputs.map(input=>`<label>${esc(fieldName(input.id))} · <span data-no-i18n>${esc(input.unit||'1')}</span><input type="number" step="any" inputmode="decimal" min="${esc(input.min)}" max="${esc(input.max)}" value="${esc(state.values[input.id])}" data-model-query-input="${esc(input.id)}"><small data-no-i18n>${esc(input.min)} – ${esc(input.max)} ${esc(input.unit||'1')}</small></label>`).join('')}</div><div class="model-button-row"><button type="button" class="button primary" data-model-query-action="calculate">${t('Calculate estimate','计算估算值')}</button><button type="button" class="button secondary" data-model-query-action="save" ${state.result?'':'disabled'}>${t('Save estimate JSON ↓','保存估算 JSON ↓')}</button></div><p class="model-query-status" data-model-query-status role="${state.phase==='error'?'alert':'status'}">${esc(statusText(state))}</p><div data-model-query-results>${resultHTML(state)}</div><p class="panel-foot">${t('Mean estimates only; no uncertainty interval, live Aspen run or physical validation. Energy and climate impact use the declared product basis above.','仅为均值估算，不含不确定性区间、实时 Aspen 运行或物理验证。能量与气候影响沿用上方声明的产品核算基准。')}</p></details>`;
}

function update(panel,state){
  const status=panel.querySelector('[data-model-query-status]');
  status.textContent=statusText(state);status.setAttribute('role',state.phase==='error'?'alert':'status');
  panel.querySelector('[data-model-query-results]').innerHTML=resultHTML(state);
  panel.querySelector('[data-model-query-action="save"]').disabled=!state.result;
}
function currentInputs(state){
  const values={};
  for(const input of state.model.inputs){
    const text=state.values[input.id];
    if(typeof text!=='string'||!text.trim()||!Number.isFinite(Number(text))){const error=new Error('Finite native-unit inputs are required');error.code='invalid_input';throw error;}
    values[input.id]=Number(text);
  }
  return values;
}
export function modelQueryExport(state){
  if(!state?.result)throw new Error('Calculate a current estimate before saving');
  const values=currentInputs(state),result=state.result;
  if(state.model.inputs.some(input=>values[input.id]!==result.inputs[input.id]))throw new Error('Inputs changed; calculate a current estimate before saving');
  return {result_version:1,kind:'surrogate_prediction',evidence_type:'browser_surrogate_prediction',exploratory:false,dataset_metadata:structuredClone(state.datasetMetadata),
    model_sha256:result.model_sha256,bundle_sha256:result.bundle_sha256,dataset_sha256:result.dataset_sha256,
    profile_id:result.profile_id,profile_sha256:result.profile_sha256,native_model_sha256:result.native_model_sha256,
    source_file:{...state.source,byte_sha256_verified:true},native_execution_performed:false,physical_validation:false,
    inputs:state.model.inputs,responses:state.model.responses,scope:result.scope,
    records:[{id:'browser-query-1',kind:'prediction',inputs:{...result.inputs},input_units:Object.fromEntries(state.model.inputs.map(input=>[input.id,input.unit])),outputs:{...result.outputs},units:{...result.units},constraints_passed:true,errors:[],source:'Browser mean evaluation of '+sourcePath}]};
}

// Called by the parent's existing input/change/click delegates. Returns true
// only for a control in this panel. It never installs listeners or changes axes.
export function handleModelQueryEvent(event,state,{download=downloadText}={}){
  if(!state)return false;
  const target=event.target,panel=target?.closest?.('[data-model-query]');
  if(!panel)return false;if(panel.isConnected===false)return true;
  const inputId=target.dataset?.modelQueryInput;
  if(['input','change'].includes(event.type)&&state.model.inputs.some(input=>input.id===inputId)){
    state.values[inputId]=target.value;state.result=null;state.phase='edited';state.errorCode=null;update(panel,state);return true;
  }
  const button=target.closest?.('[data-model-query-action]');
  if(event.type!=='click'||!button||button.disabled)return false;
  const action=button.dataset.modelQueryAction;if(!['calculate','save'].includes(action))return false;
  event.preventDefault?.();
  try{
    if(action==='calculate'){
      state.result=null;state.errorCode=null;
      const values=currentInputs(state),units=Object.fromEntries(state.model.inputs.map(input=>[input.id,input.unit]));
      const result=state.model.predict(values,units);
      if(state.model.responses.some(response=>!Number.isFinite(result.outputs[response.id]))){const error=new Error('Incomplete or nonfinite outputs');error.code='invalid_response';throw error;}
      state.result=result;state.phase='result';
    }else{
      const value=modelQueryExport(state);download('htl-v2-condition-estimate.json',JSON.stringify(value,null,2)+'\n','application/json;charset=utf-8');state.phase='saved';
    }
  }catch(error){state.result=null;state.phase='error';state.errorCode=error?.code||'unavailable';}
  update(panel,state);return true;
}
