import { writeFile } from 'node:fs/promises';
const dir=new URL('./',import.meta.url);
const dxf=(entities,units=4)=>[0,'SECTION',2,'HEADER',...(units===null?[]:[9,'$INSUNITS',70,units]),0,'ENDSEC',0,'SECTION',2,'ENTITIES',...entities.flat(),0,'ENDSEC',0,'EOF'].join('\n');
const rectangle=[0,'LWPOLYLINE',8,'Inch plate',90,4,70,1,38,0.25,39,0.5,10,0,20,0,10,2,20,0,10,2,20,1,10,0,20,1];
const circle=[0,'CIRCLE',8,'Round pin',10,3,20,0.5,30,0,40,0.25];
await writeFile(new URL('fixture-inch.dxf',dir),dxf([rectangle,circle],1));
await writeFile(new URL('fixture-unitless-partial.dxf',dir),dxf([[0,'LWPOLYLINE',8,'Valid profile',90,4,70,1,10,0,20,0,10,10,20,0,10,10,20,5,10,0,20,5],[0,'ARC',10,0,20,0,40,5,50,0,51,90],[0,'INSERT',2,'Block1']],null));
await writeFile(new URL('fixture-broken.dxf',dir),'0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n40');
