import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {readSpreadsheet} from '../analysis_web/spreadsheet-import.mjs';
const XLSX=createRequire(import.meta.url)('../analysis_web/vendor/xlsx.full.min.js');

test('formula without cached value is rejected, never silently read as an empty cell',async()=>{
  // Written by openpyxl: <c r="B2"><f>1+1</f><v></v></c>.
  const bytes=await readFile(new URL('./fixtures/formula-without-cache.xlsx',import.meta.url));
  assert.throws(()=>readSpreadsheet(bytes,XLSX,'formula.xlsx'),/values-only workbook/);
});

test('cached formulas are rejected and values-only sheets retain signed numbers and zeros',()=>{
  const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['id','heat','power'],['A',-3,0]]);
  XLSX.utils.book_append_sheet(workbook,sheet,'blocks');
  const bytes=()=>XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
  assert.deepEqual(readSpreadsheet(bytes(),XLSX,'test.xlsx'),[{name:'test.xlsx / blocks',rows:[['id','heat','power'],['A',-3,0]]}]);
  sheet.B2={t:'n',f:'-1-2',v:-3};
  assert.throws(()=>readSpreadsheet(bytes(),XLSX,'test.xlsx'),/values-only workbook/);
});

test('a later invalid worksheet rejects the complete import and overlong sheets are not truncated',()=>{
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['id'],['A']]),'cases');
  const formula=XLSX.utils.aoa_to_sheet([['power'],[1]]);formula.A2={t:'n',f:'1',v:1};
  XLSX.utils.book_append_sheet(workbook,formula,'blocks');
  assert.throws(()=>readSpreadsheet(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),XLSX,'test.xlsx'),/values-only/);
  const long=XLSX.utils.book_new();XLSX.utils.book_append_sheet(long,XLSX.utils.aoa_to_sheet(Array.from({length:10004},(_,i)=>[i])),'long');
  assert.throws(()=>readSpreadsheet(XLSX.write(long,{type:'buffer',bookType:'xlsx'}),XLSX,'long.xlsx'),/row limit/);
});
