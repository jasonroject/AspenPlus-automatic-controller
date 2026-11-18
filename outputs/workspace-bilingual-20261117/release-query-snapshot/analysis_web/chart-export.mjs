// Small, local exports. Callers supply the plotted raw records, never DOM numbers.
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function buildCSV(columns, rows) {
  const fields = columns.map(column => typeof column === 'string' ? {key:column,label:column} : column);
  const cell = value => {
    if (value === null || value === undefined) return '""';
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('CSV numbers must be finite; use null with an explicit missing-data status.');
    let text = String(value);
    // Preserve numeric negatives. Protect text cells when opened in spreadsheets.
    if (typeof value === 'string' && /^(?:\s*[=+@-]|[\x00-\x1f])/.test(value)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return '\uFEFF' + [fields.map(field => cell(field.label ?? field.key)).join(','), ...rows.map(row => fields.map(field => cell(row[field.key])).join(','))].join('\r\n') + '\r\n';
}

const exportStyle = `text{font-family:Inter,"Microsoft YaHei","PingFang SC",Arial,sans-serif;font-size:11px;fill:#555}.chart-value{fill:#222;font-size:12px;font-weight:600}.rv-grid{stroke:#dcdcd8;stroke-width:1}.rv-guide{stroke:#ececea;stroke-width:1;stroke-dasharray:3 4}.rv-interval{stroke:#444;stroke-width:4;stroke-linecap:round}.rv-cap{stroke:#444;stroke-width:2}.rv-support circle{fill:#202020}.rv-bounds{font-size:10px;fill:#777}.export-title{font-size:18px;font-weight:600;fill:#222}.export-note{font-size:11px;fill:#555}`;
export function wrapSVGText(value, width) {
  const result = [];
  for (const paragraph of String(value ?? '').split(/\r?\n/)) {
    let line = '', count = 0;
    const flush = () => {if (line.trimEnd()) result.push(line.trimEnd());line='';count=0;};
    const size = text => [...text].reduce((sum,character)=>sum+(character.codePointAt(0)>255?2:1),0);
    // Keep English words together; Chinese characters can wrap individually.
    for (const token of paragraph.match(/[\u2e80-\u9fff]|[^\s\u2e80-\u9fff]+|\s+/gu) || []) {
      if (/^\s+$/.test(token)) {if(line&&!line.endsWith(' ')){line+=' ';count++;}continue;}
      const length = size(token);
      if (length <= width) {
        if (count+length>width) flush();
        line+=token;count+=length;
      } else {
        // An unbroken source hash or URL must still fit within the figure.
        if(line) flush();
        for(const character of token){const n=size(character);if(count+n>width)flush();line+=character;count+=n;}
      }
    }
    flush();
  }
  return result;
}

export function standaloneSVG(svgMarkup, {title='Chart', description='', metadata=[]} = {}) {
  // Only markup emitted by our own SVG renderers is accepted, never an uploaded SVG.
  const source = String(svgMarkup).trim();
  const match = source.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i);
  const view = match?.[1].match(/\bviewBox=["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!match || !view || view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) throw new TypeError('A finite, nonempty SVG viewBox is required.');
  if (/<\s*(?:script|foreignObject|image|use|iframe|object)\b|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(/i.test(source)) throw new TypeError('Only self-contained chart geometry is exportable.');
  const meta = Array.isArray(metadata) ? metadata.map(String) : Object.entries(metadata).map(([key,value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  const width = Math.max(640,view[2]+48), titleLines = wrapSVGText(title,Math.floor((width-48)/10));
  const header = 24 + titleLines.length*24, notes = [description,...meta].flatMap(value => wrapSVGText(value,Math.floor((width-48)/6)));
  const bottom = header + view[3] + 22, height = bottom + notes.length*17 + 22;
  const attributes = match[1].replace(/\s(?:xmlns(?::\w+)?|width|height|x|y)=["'][^"']*["']/gi,'').replace(/\sdata-[\w-]+(?:=(?:"[^"]*"|'[^']*'))?(?=\s|$)/g,'');
  const geometry = match[2].replace(/<g\b[^>]*data-response-inspection[\s\S]*?<\/g>/gi,'');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><title>${xml(title)}</title><desc>${xml(description)}</desc><metadata>${xml(JSON.stringify(metadata))}</metadata><style>${exportStyle}</style><rect width="${width}" height="${height}" fill="#fff"/>${titleLines.map((line,index)=>`<text class="export-title" x="24" y="${28+index*24}">${xml(line)}</text>`).join('')}<svg${attributes} x="${(width-view[2])/2}" y="${header}" width="${view[2]}" height="${view[3]}">${geometry}</svg>${notes.map((line,index)=>`<text class="export-note" x="24" y="${bottom+index*17}">${xml(line)}</text>`).join('')}</svg>`;
}

export function buildSVG(svgElement, options) {
  if (!svgElement?.matches?.('svg')) throw new TypeError('Select a rendered SVG chart.');
  const clone = svgElement.cloneNode(true), originals = [svgElement,...svgElement.querySelectorAll('*')], copies = [clone,...clone.querySelectorAll('*')];
  const properties = ['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray','stroke-linecap','stroke-linejoin','font-family','font-size','font-weight','text-anchor','dominant-baseline','opacity'];
  originals.forEach((original,index) => {
    const style = original.ownerDocument.defaultView.getComputedStyle(original);
    for (const property of properties) {
      const value = style.getPropertyValue(property);
      if (value) copies[index].style.setProperty(property,value);
    }
  });
  clone.querySelectorAll('[data-response-inspection]').forEach(node => node.remove());
  return standaloneSVG(clone.outerHTML,options);
}

export function downloadText(filename, text, mime='text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type:mime}));
  const link = document.createElement('a');link.href=url;link.download=String(filename).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-');
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const downloadCSV = (filename,columns,rows) => downloadText(filename,buildCSV(columns,rows),'text/csv;charset=utf-8');
export const downloadSVG = (filename,svgElement,options) => downloadText(filename,buildSVG(svgElement,options),'image/svg+xml;charset=utf-8');
