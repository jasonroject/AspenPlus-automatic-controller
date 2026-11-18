import {readFile,writeFile} from 'node:fs/promises';
const dir=new URL('./',import.meta.url);const project=JSON.parse(await readFile(new URL('original-project.extrudecad.json',dir),'utf8'));
const template=project.shapes[2];const rect=(w,h,cx=0,cy=0)=>[{x:cx-w/2,y:cy-h/2},{x:cx+w/2,y:cy-h/2},{x:cx+w/2,y:cy+h/2},{x:cx-w/2,y:cy+h/2}];
const circle=(r,cx=0)=>Array.from({length:72},(_,i)=>({x:cx+r*Math.cos(i*Math.PI/36),y:r*Math.sin(i*Math.PI/36)}));
const definitions=[['small','A 小方块20',rect(20,20),10,20],['large','B 大方块40',rect(40,40),0,5],['far','C 远方块',rect(20,20,100,100),0,5],['strip','D 切割竖条',rect(10,60),0,30],['plate','E 底板100×40',rect(100,40),3,12],['hole1','F 左孔',circle(5,-20),0,30],['hole2','G 右孔',circle(5,20),0,30],['ring','H 圆环工具',circle(15),100,99,circle(5)]];
project.shapes=definitions.map(([id,name,points,zOffset,zHeight,holePoints])=>({...template,id,name,points,holePoints,zOffset,zHeight,type:holePoints?'hollow-box':'polygon',bevel:0,locked:false,visible:true,booleanMeta:undefined}));
await writeFile(new URL('boolean-fixture.extrudecad.json',dir),JSON.stringify(project,null,2));
