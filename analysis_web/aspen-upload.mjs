// 上传体检文件 -> 浏览器内分析 + 建议。引擎、规则表、zip 读取都是首次选择文件时才懒加载。
const $ = s => document.querySelector(s);
const MAX_FILE = 40 * 1024 * 1024;
let engine = null;

async function loadEngine() {
  if (!engine) {
    const [core, view] = await Promise.all([import('./aspen-advice.mjs'), import('./aspen-advice-view.mjs')]);
    engine = {core, view, rules: await core.loadRules()};
  }
  return engine;
}

async function filesToDocs(files, core) {
  const docs = [];
  for (const f of files) {
    if (f.size > MAX_FILE) throw new core.AdviceInputError(`“${f.name}”超过 40 MB，不像是体检文件。`);
    const lower = f.name.toLowerCase();
    let texts;
    if (lower.endsWith('.zip')) texts = await (await import('./aspen-zip.mjs')).readZipJson(await f.arrayBuffer(), f.name);
    else if (lower.endsWith('.json')) texts = [{name: f.name, text: await f.text()}];
    else throw new core.AdviceInputError(`“${f.name}”不是 .json 或 .zip。请上传 python -m aspen_study probe 输出目录里的 probe-summary.json、graph.json、roles.json，或把它们打成 zip。`);
    for (const {name, text} of texts) {
      try { docs.push({name, data: JSON.parse(text)}); }
      catch { throw new core.AdviceInputError(`“${name}”不是有效的 JSON（文件可能被截断或不是文本）。`); }
    }
  }
  return docs;
}

function show(error) {
  const box = $('#advice-error');
  box.hidden = !error;
  box.textContent = error || '';
}

export async function analyze(docsOrFiles, {isFiles = true} = {}) {
  show('');
  $('#advice-status').textContent = '分析中…';
  try {
    const {core, view, rules} = await loadEngine();
    const docs = isFiles ? await filesToDocs(docsOrFiles, core) : docsOrFiles;
    const result = core.classifyBundle(docs, rules);
    const advice = core.advise(result.summary, result.graph, result.roles, rules);
    $('#advice-out').innerHTML = view.headerHTML(result, advice) + '<h3>模型建议</h3>' + view.adviceHTML(advice) + '<h3>能量表</h3>' + view.energyHTML(core.energyRows(result.summary));
    $('#advice-download').hidden = false;
    $('#advice-download').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(advice, null, 1)], {type: 'application/json'}));
      a.download = 'advice.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#advice-status').textContent = `完成：${advice.counts.total} 条（严重 ${advice.counts.critical}，警告 ${advice.counts.warn}）。文件只在本机浏览器里处理，没有上传。`;
  } catch (e) {
    $('#advice-out').innerHTML = '';
    $('#advice-download').hidden = true;
    $('#advice-status').textContent = '';
    show(e && e.name === 'AdviceInputError' ? e.message : '处理失败：' + (e && e.message ? e.message : e));
  }
}

async function loadExample() {
  const names = ['probe-summary.json', 'graph.json', 'roles.json'];
  const docs = await Promise.all(names.map(async n => ({name: n, data: await (await fetch('data/aspen-probe-example/' + n)).json()})));
  await analyze(docs, {isFiles: false});
}

const input = $('#advice-files'), drop = $('#advice-drop');
input.addEventListener('change', () => input.files.length && analyze([...input.files]));
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.dataset.active = '1'; }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); delete drop.dataset.active; }));
drop.addEventListener('drop', e => e.dataTransfer.files.length && analyze([...e.dataTransfer.files]));
$('#advice-example').addEventListener('click', () => loadExample().catch(e => show('示例加载失败：' + e.message)));
