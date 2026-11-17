// Preserve formula-only cells so missing cached values cannot bypass review.
export function readSpreadsheet(bytes,reader,filename){
  const workbook=reader.read(bytes,{type:'array',cellFormula:true,sheetStubs:true,sheetRows:10002});
  const worksheets=[];
  for(const name of workbook.SheetNames){
    const sheet=workbook.Sheets[name];
    if(sheet['!fullref'])throw new Error('Worksheet exceeds the row limit. Split it before importing; no truncated data were applied.');
    if(Object.values(sheet).some(cell=>cell&&typeof cell==='object'&&cell.f))throw new Error('Formula cells are not recalculated. Export a values-only workbook before import.');
    const rows=reader.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,blankrows:false});
    if(rows.length)worksheets.push({name:filename+' / '+name,rows});
  }
  return worksheets;
}
