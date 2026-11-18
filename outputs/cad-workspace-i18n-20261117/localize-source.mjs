import {parse} from './tooling/node_modules/@babel/parser/lib/index.js';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve('extrudecad-web/src');
for(const file of ['App.tsx',...fs.readdirSync(path.join(root,'components')).filter(f=>f.endsWith('.tsx')).map(f=>'components/'+f)]){
 const filename=path.join(root,file), source=fs.readFileSync(filename,'utf8'), ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});const edits=[];
 const add=(start,end,value)=>edits.push({start,end,value});
 function walk(node,parent){if(!node||typeof node!=='object')return;
  if(node.type==='JSXText'&&/\p{Script=Han}/u.test(node.value)){const value=node.value.replace(/\s+/g,' ');add(node.start,node.end,'{'+(value.startsWith(' ')?'" " + ':'')+'t('+JSON.stringify(value.trim())+')'+(value.endsWith(' ')?' + " "':'')+'}');}
  if(node.type==='JSXAttribute'&&['title','aria-label','placeholder','label','note'].includes(node.name.name)&&node.value?.type==='StringLiteral'&&/\p{Script=Han}/u.test(node.value.value))add(node.value.start,node.value.end,'{t('+JSON.stringify(node.value.value)+')}');
  if(node.type==='JSXExpressionContainer'&&node.expression.type!=='JSXEmptyExpression'){
   const attr=parent?.type==='JSXAttribute'?parent.name.name:null;const child=!attr;
   const expression=node.expression,raw=source.slice(expression.start,expression.end);
   if((child||['title','aria-label','placeholder','label','note'].includes(attr))&&!/\.name\b/.test(raw)&&raw!=='children'){add(expression.start,expression.start,'t(');add(expression.end,expression.end,')');}
  }
  if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&['fillText','measureText'].includes(node.callee.property.name)&&node.arguments[0]){const arg=node.arguments[0],raw=source.slice(arg.start,arg.end);if(!/\.name\b/.test(raw)){add(arg.start,arg.start,'t(');add(arg.end,arg.end,')');}}
  for(const[k,value]of Object.entries(node))if(!['loc','start','end','extra','comments'].includes(k)){if(Array.isArray(value))value.forEach(n=>walk(n,node));else walk(value,node);}
 }walk(ast,null);
 // Children and canvas text are presentation boundaries. Event handlers, values, names and model constructors remain untouched.
 edits.sort((a,b)=>b.start-a.start||b.end-a.end);let result=source;for(const e of edits)result=result.slice(0,e.start)+e.value+result.slice(e.end);
 result="import { t } from '"+(file==='App.tsx'?'./':'../')+"i18n';\n"+result;fs.writeFileSync(filename,result);console.log(file,edits.length);
}
