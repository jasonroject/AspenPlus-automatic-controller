// Portable frozen-posterior means only. The caller separately verifies the
// reviewed public bundle's bytes. This module does not authenticate JSON/native
// execution, fit a model, compute uncertainty, or run energy/LCA calculations.
const FAMILY='constant_times_matern52_plus_fixed_white';
const HULL_TOL_1D=1e-10,HULL_TOL_2D=1e-8;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const sameKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const close=(a,b)=>Math.abs(a-b)<=1e-12+1e-10*Math.abs(b);

export class BrowserSurrogateError extends Error{
  constructor(code,message){super(message);this.name='BrowserSurrogateError';this.code=code;}
}
const require=(condition,code,message)=>{if(!condition)throw new BrowserSurrogateError(code,message);};
const invalid=(condition,message)=>require(condition,'invalid_model',message);

function sum(values){
  let total=0,correction=0;
  for(const value of values){const next=total+value;correction+=Math.abs(total)>=Math.abs(value)?(total-next)+value:(value-next)+total;total=next;}
  return total+correction;
}
function vector(value,size,label){
  invalid(Array.isArray(value)&&value.length===size&&value.every(finite),`${label} must have ${size} finite values`);
  return [...value];
}
function matrix(value,size,width,label){
  invalid(Array.isArray(value)&&value.length===size,`${label} row count differs from training data`);
  return value.map(row=>vector(row,width,label));
}
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function convexHull(points){
  const ordered=points.map(row=>[...row]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const half=rows=>{const output=[];for(const point of rows){while(output.length>=2&&cross(output.at(-2),output.at(-1),point)<=0)output.pop();output.push(point);}return output;};
  const lower=half(ordered),upper=half([...ordered].reverse());return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function responseAllowed(value,spec){
  return finite(value)&&!(spec.value_domain==='positive'&&value<=0)&&!(spec.value_domain==='nonnegative'&&value<0)
    &&!(spec.min!==undefined&&spec.min!==null&&value<spec.min)&&!(spec.max!==undefined&&spec.max!==null&&value>spec.max);
}

export function prepareBrowserSurrogate(bundle){
  invalid(object(bundle)&&bundle.kind==='process_surrogate'&&bundle.bundle_version===1,'Expected a version-1 process surrogate bundle');
  require(bundle.prediction_enabled===true&&bundle.status==='declared_simulator_error_checks_passed'
    &&bundle.evidence_type==='native_simulation'&&object(bundle.validation)&&bundle.validation.passed===true,
  'unqualified_bundle','Browser queries require a bundle declared qualified by its original native-simulation error checks');
  for(const field of ['model_sha256','bundle_sha256','dataset_sha256','profile_sha256','native_model_sha256'])invalid(hash(bundle[field]),`Missing or malformed ${field}`);
  invalid(typeof bundle.profile_id==='string'&&bundle.profile_id.trim().length>0,'Missing profile ID');
  const model=bundle.model;
  invalid(object(model)&&model.family===FAMILY,'Unsupported posterior family');
  invalid(Array.isArray(model.inputs)&&[1,2].includes(model.inputs.length),'Browser evaluator supports only one or two continuous inputs');
  invalid(Array.isArray(model.responses)&&model.responses.length>0&&model.responses.length<=30,'Missing or excessive response declarations');
  const dimensions=model.inputs.length;
  const inputs=model.inputs.map(spec=>{
    invalid(object(spec)&&typeof spec.id==='string'&&spec.id.length>0&&typeof spec.unit==='string'&&finite(spec.min)&&finite(spec.max)&&spec.min<spec.max,'Malformed input declaration or native unit/domain');
    return Object.freeze({id:spec.id,unit:spec.unit,min:spec.min,max:spec.max});
  });
  const responses=model.responses.map(spec=>{
    invalid(object(spec)&&typeof spec.id==='string'&&spec.id.length>0&&typeof spec.unit==='string'&&spec.unit.length>0
      &&['positive','nonnegative','signed'].includes(spec.value_domain)&&['min','max'].includes(spec.direction),'Malformed response declaration');
    for(const field of ['min','max'])invalid(spec[field]===undefined||spec[field]===null||finite(spec[field]),'Response bounds must be finite or absent');
    invalid(spec.min===undefined||spec.min===null||spec.max===undefined||spec.max===null||spec.min<=spec.max,'Reversed response bounds');
    return Object.freeze({id:spec.id,unit:spec.unit,direction:spec.direction,value_domain:spec.value_domain,min:spec.min,max:spec.max});
  });
  const inputIds=inputs.map(spec=>spec.id),responseIds=responses.map(spec=>spec.id);
  invalid(new Set(inputIds).size===dimensions&&new Set(responseIds).size===responses.length,'Duplicate declared identifiers');
  const metadata=bundle.dataset_metadata;
  invalid(object(metadata)&&Array.isArray(metadata.inputs)&&Array.isArray(metadata.responses),'Missing dataset variable declarations');
  invalid(metadata.inputs.length===inputs.length&&metadata.responses.length===responses.length,'Dataset/model declarations differ');
  for(const [i,spec] of inputs.entries())invalid(object(metadata.inputs[i])&&['id','unit','min','max'].every(key=>metadata.inputs[i][key]===spec[key]),'Dataset/model input declarations differ');
  for(const [i,spec] of responses.entries())invalid(object(metadata.responses[i])&&['id','unit','direction','value_domain','min','max'].every(key=>(metadata.responses[i][key]??null)===(spec[key]??null)),'Dataset/model response declarations differ');
  invalid(Array.isArray(model.training_inputs_raw)&&model.training_inputs_raw.length>=2&&model.training_inputs_raw.length<=500,'Training point count must be between 2 and 500');
  const count=model.training_inputs_raw.length;
  const raw=matrix(model.training_inputs_raw,count,dimensions,'Training inputs');
  const train=matrix(model.training_inputs_scaled,count,dimensions,'Scaled training inputs');
  invalid(Array.isArray(model.training_case_ids)&&model.training_case_ids.length===count&&model.training_case_ids.every(value=>typeof value==='string'&&value.length>0)
    &&new Set(model.training_case_ids).size===count,'Missing or duplicate training identities');
  invalid(new Set(raw.map(row=>JSON.stringify(row))).size===count,'Duplicate training coordinates');
  invalid(object(model.input_scaler),'Missing input scaler');
  const mean=vector(model.input_scaler.mean,dimensions,'Input mean'),scale=vector(model.input_scaler.scale,dimensions,'Input scale');
  invalid(scale.every(value=>value>0),'Input scales must be positive');
  for(let d=0;d<dimensions;d++){
    const average=sum(raw.map(row=>row[d]/count));
    const standardDeviation=Math.sqrt(sum(raw.map(row=>((row[d]-average)/Math.sqrt(count))**2)));
    invalid(close(mean[d],average)&&close(scale[d],standardDeviation),'Input scaling differs from the frozen training coordinates');
    for(let i=0;i<count;i++)invalid(raw[i][d]>=inputs[d].min&&raw[i][d]<=inputs[d].max&&close((raw[i][d]-mean[d])/scale[d],train[i][d]),'Training coordinates/scaling or declared bounds are inconsistent');
  }
  const minima=inputs.map((_,d)=>Math.min(...train.map(row=>row[d]))),maxima=inputs.map((_,d)=>Math.max(...train.map(row=>row[d])));
  const hull=dimensions===2?convexHull(train):null;
  invalid(dimensions===1?minima[0]<maxima[0]:hull.length>=3,'Training support does not span the declared input dimensions');
  invalid(object(model.regressors)&&sameKeys(model.regressors,responseIds),'Regressors do not match declared responses');
  const regressors=responses.map(spec=>{
    const row=model.regressors[spec.id];invalid(object(row),'Missing response regressor');
    const length=vector(row.length_scale,dimensions,'Kernel length scale'),dual=vector(row.dual_coefficients,count,'Posterior coefficients');
    invalid(length.every(value=>value>0)&&finite(row.constant_value)&&row.constant_value>0&&finite(row.output_mean)&&finite(row.output_scale)&&row.output_scale>0
      &&finite(row.white_noise_level)&&row.white_noise_level>0&&finite(row.alpha)&&row.alpha>=0,'Invalid kernel or response normalization');
    return {length,dual,constant:row.constant_value,mean:row.output_mean,scale:row.output_scale};
  });
  const scope='Frozen surrogate means inside declared bounds and actual training support. No new Aspen run, energy/LCA recalculation, uncertainty interval or physical validation. Bundle/native claims are not independently authenticated here.';
  const trace=Object.freeze({model_sha256:bundle.model_sha256,bundle_sha256:bundle.bundle_sha256,dataset_sha256:bundle.dataset_sha256,
    profile_id:bundle.profile_id,profile_sha256:bundle.profile_sha256,native_model_sha256:bundle.native_model_sha256,
    source_evidence_type:bundle.evidence_type,independently_authenticated:false,physical_validation:false,
    hull_tolerance_scaled:dimensions===1?HULL_TOL_1D:HULL_TOL_2D,scope});
  const defaults=Object.freeze(Object.fromEntries(inputs.map((spec,i)=>[spec.id,mean[i]])));
  function predict(values,units){
    require(sameKeys(values,inputIds)&&inputIds.every(key=>finite(values[key])),'invalid_input','Supply every declared input as a finite number without unknown fields');
    require(sameKeys(units,inputIds)&&inputs.every(spec=>units[spec.id]===spec.unit),'unit_mismatch','Input units must exactly match native model units; no automatic conversion is performed');
    const point=inputs.map((spec,i)=>{
      require(values[spec.id]>=spec.min&&values[spec.id]<=spec.max,'outside_bounds',`${spec.id} is outside the declared input bounds`);
      const value=(values[spec.id]-mean[i])/scale[i];require(finite(value),'invalid_input','Input normalization is non-finite');return value;
    });
    let supported;
    if(dimensions===1)supported=point[0]>=minima[0]-HULL_TOL_1D&&point[0]<=maxima[0]+HULL_TOL_1D;
    else{
      // Polygon offset in the scaled L-infinity residual tolerance used by the
      // Python hull gate (1e-8). Bounding faces are also required at vertices.
      supported=point.every((value,i)=>value>=minima[i]-HULL_TOL_2D&&value<=maxima[i]+HULL_TOL_2D)
        &&hull.every((a,i)=>{const b=hull[(i+1)%hull.length];return cross(a,b,point)>=-HULL_TOL_2D*(Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1]));});
    }
    require(supported,'outside_hull','Query is outside actual training convex-hull support; extrapolation is not available');
    const outputs=Object.fromEntries(responses.map((spec,index)=>{
      const reg=regressors[index];
      const terms=train.map((row,i)=>{
        const radius=Math.sqrt(sum(row.map((value,d)=>((value-point[d])/reg.length[d])**2))),q=Math.sqrt(5)*radius;
        // WhiteKernel belongs to the fitted covariance, not query/train cross
        // covariance, including identical-coordinate training queries.
        return reg.dual[i]*reg.constant*(1+q+5*radius**2/3)*Math.exp(-q);
      });
      const value=sum(terms)*reg.scale+reg.mean;
      require(responseAllowed(value,spec),'invalid_response',`${spec.id} mean is non-finite or outside its declared response domain; values are not clipped`);
      return [spec.id,value];
    }));
    return {kind:'surrogate_mean_prediction',inputs:Object.fromEntries(inputs.map(spec=>[spec.id,values[spec.id]])),outputs,
      units:Object.fromEntries(responses.map(spec=>[spec.id,spec.unit])),...trace,constraints_passed:true,
      exploratory:false,prediction_enabled:true,native_execution_performed:false,model_refitted:false,uncertainty_estimated:false};
  }
  return Object.freeze({inputs:Object.freeze(inputs),responses:Object.freeze(responses),defaults,trace,predict});
}
