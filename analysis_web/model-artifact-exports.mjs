// Export exactly the complete records plotted by the artifact viewer. No model
// execution, interpolation, uncertainty estimation, or DOM number parsing.
import {artifactSeries} from './model-artifact-data.mjs';
import {buildCSV} from './chart-export.mjs';
import {t,getLanguage} from './i18n.mjs';

const text=value=>typeof value==='string'?value:'';
const column=(key,en,zh)=>({key,label:t(en,zh)});

export function buildModelArtifactExport(artifact,kind,{inputId,responseId}={}){
  if(!artifact||artifact.robustness||!['coverage','parity'].includes(kind))throw new Error('Choose a coverage or held-out comparison chart from a loaded model artifact');
  if(kind==='parity'&&!artifact.bundle)throw new Error('Held-out comparison requires an exported model evaluation');
  const input=artifact.inputs.find(spec=>spec.id===inputId),response=artifact.responses.find(spec=>spec.id===responseId);
  if(!input||!response)throw new Error('Choose declared input and response fields');
  const series=artifactSeries(artifact,inputId,responseId),points=kind==='coverage'?series.observations:series.pairs;
  if(!points.length)throw new Error('No complete eligible records are plotted for this chart');
  const raw=artifact.raw, originals=(kind==='coverage'?artifact.rows:artifact.pairs).filter(row=>row.displayValid);
  const enabled=artifact.bundle&&typeof raw.prediction_enabled==='boolean'?raw.prediction_enabled:null;
  const exploratory=artifact.bundle?(enabled===null?null:!enabled):(typeof raw.exploratory==='boolean'?raw.exploratory:null);
  const title=kind==='coverage'?t('Input and response coverage','输入与响应覆盖'):t('Held-out predictions vs supplied outputs','留出预测与提供的输出对照');
  const description=kind==='coverage'
    ?t('Each point is a complete exported record. Other inputs may vary; this is not a controlled response curve. Filled points are training records; hollow points are other declared groups. Surrogate means are not new native runs or uncertainty intervals.','每个点是一条完整导出记录。其他输入也可能变化，这不是固定其余变量后的响应曲线。实心点是训练记录，空心点是其他声明分组。代理均值不是新的原生运行或不确定性区间。')
    :t('Only complete held-out or verification comparisons are included. Training records are excluded. The dashed line is equality; predicted values are frozen surrogate means, not uncertainty bounds.','仅导出完整的留出或复核对照，排除训练记录。虚线表示相等；预测值是冻结代理模型的均值，不是不确定性上下界。');
  const nativeHash=record=>text(raw.native_model_sha256)||text(record.native_source_model_sha256);
  const common=record=>({record_id:record.id,group:record.split||'prediction',
    source:record.source||record.source_id||'',model_sha256:artifact.modelHash,
    dataset_sha256:text(raw.dataset_sha256),profile_id:artifact.profileId,
    profile_sha256:text(raw.profile_sha256),native_model_sha256:nativeHash(record),
    source_evidence_type:artifact.evidence,declared_prediction_enabled:enabled,
    declared_qualification_status:text(raw.status),exploratory,
    independently_verified:false,
    inputs_json:JSON.stringify(record.inputs??{}),input_units_json:JSON.stringify(Object.fromEntries(artifact.inputs.map(spec=>[spec.id,spec.unit]))),
    functional_unit:artifact.basis?.functional_unit??'',system_boundary:artifact.basis?.boundary??'',
    allocation_method:artifact.basis?.allocation_method??'',language:getLanguage()});
  const rows=points.map((point,index)=>{
    const record=originals[index];
    return kind==='coverage'
      ?{...common(record),record_kind:artifact.bundle?'supplied_observation':'surrogate_mean_prediction',
        input_id:input.id,input_value:point.x,input_unit:input.unit,response_id:response.id,response_value:point.y,response_unit:response.unit}
      :{...common(record),record_kind:'held_out_mean_comparison',response_id:response.id,
        supplied_value:point.x,predicted_mean:point.y,response_unit:response.unit};
  });
  const columns=[column('record_id','Record ID','记录编号'),column('group','Declared group','声明分组'),column('record_kind','Record kind','记录类型'),
    ...(kind==='coverage'?[column('input_id','Input','输入'),column('input_value','Input value','输入值'),column('input_unit','Input unit','输入单位')]:[]),
    column('response_id','Response','响应指标'),
    ...(kind==='coverage'?[column('response_value','Response value','响应值')]:[column('supplied_value','Supplied output','提供的输出'),column('predicted_mean','Predicted mean','预测均值')]),
    column('response_unit','Response unit','响应单位'),column('inputs_json','All supplied inputs (JSON)','全部提供输入（JSON）'),column('input_units_json','Declared input units (JSON)','声明输入单位（JSON）'),
    column('source','Source','来源'),column('model_sha256','Model SHA-256','模型 SHA-256'),column('dataset_sha256','Dataset SHA-256','数据集 SHA-256'),
    column('profile_id','Profile ID','配置编号'),column('profile_sha256','Profile SHA-256','配置 SHA-256'),column('native_model_sha256','Native source model SHA-256','原生源模型 SHA-256'),
    column('source_evidence_type','Declared source evidence','声明的来源证据'),column('declared_prediction_enabled','Declared prediction enabled','声明的常规预测启用状态'),
    column('declared_qualification_status','Declared qualification status','声明的资格状态'),column('exploratory','Exploratory','探索性'),
    column('independently_verified','Independently verified by browser','浏览器独立验证'),column('functional_unit','Declared functional unit','声明的功能单位'),
    column('system_boundary','Declared system boundary','声明的系统边界'),column('allocation_method','Declared allocation','声明的分配方式'),column('language','Language','语言')];
  const metadata={chart:kind,profile_id:artifact.profileId,model_sha256:artifact.modelHash,dataset_sha256:text(raw.dataset_sha256),
    profile_sha256:text(raw.profile_sha256),source_evidence_type:artifact.evidence,
    native_model_sha256:[...new Set(rows.map(row=>row.native_model_sha256).filter(Boolean))].join('; '),model_scope:text(raw.scope),
    declared_prediction_enabled:enabled,declared_qualification_status:text(raw.status),exploratory,
    plotted_records:rows.length,retained_records_not_plotted:(kind==='coverage'?artifact.rows.length:artifact.pairs.length)-rows.length,
    input:kind==='coverage'?input.id:null,input_unit:kind==='coverage'?input.unit:null,response:response.id,response_unit:response.unit,
    functional_unit:artifact.basis?.functional_unit??t('Inspect the matching profile or dataset','请查看匹配的配置或数据集'),
    system_boundary:artifact.basis?.boundary??'',
    source_note:t('Per-record source identities and full numerical precision are retained in the accompanying CSV. Missing records remain in the original artifact. Declared hashes and qualification are not independently authenticated by this browser export.','配套 CSV 保留逐条来源和完整数值精度。缺失记录仍保留在原始文件中。本浏览器导出不独立认证声明的哈希或资格。')};
  const filename=`model-${kind}-${artifact.profileId}-${response.id}-${getLanguage()}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,150);
  return {kind,title,description,columns,rows,csv:buildCSV(columns,rows),filename,
    svgOptions:{title,description,metadata}};
}
