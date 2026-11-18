const {base,fs,setup,toggle}=await import('./helpers.mjs');const p=(await taskSpace(1)).page('p1');
const common={zOffset:0,zHeight:0,bevel:0,color:'#D6DCE5',materialPreset:'aluminum',visible:true};
const points=[['A',-50,0],['B',0,0],['C',0,50],['T',50.3,25.4],['D',-50,50]].map(([id,x,y])=>({...common,id,name:id,type:'point',points:[{x,y}]}));
const lines=[['AB','A','B'],['BC','B','C'],['CA','C','A']].map(([id,a,b])=>({...common,id,name:id,type:'segment',endpointIds:[a,b],points:[points.find(p=>p.id===a).points[0],points.find(p=>p.id===b).points[0]]}));
await fs.writeFile(base+'fixture.extrudecad.json',JSON.stringify({app:'ExtrudeCAD Studio',fileType:'extrudecad-project',version:1,shapes:[...points,...lines]}));await fs.writeFile(base+'empty.extrudecad.json',JSON.stringify({app:'ExtrudeCAD Studio',fileType:'extrudecad-project',version:1,shapes:[]}));
await setup(p);await toggle(p,'切换智能对齐参考线',false);await toggle(p,'切换网格吸附',true);await toggle(p,'切换对象捕捉',true);
await p.screenshot({path:base+'fixture.png'});console.log(await p.evaluate(()=>({canvas:(()=>{const r=document.querySelector('[data-testid="cad-2d-canvas"]').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})(),names:[...document.querySelectorAll('.object-select')].map(e=>e.title)})));
