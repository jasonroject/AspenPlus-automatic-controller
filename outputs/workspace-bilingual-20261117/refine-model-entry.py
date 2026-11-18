from pathlib import Path
p=Path(__file__).resolve().parents[2]/'analysis_web/models.mjs'
s=p.read_text(encoding='utf-8')
needle='</p></div></header>\n    <nav'
replacement='</p></div><button id="open-existing-results" class="text-button">${t("Already have results? Open files →","已有运行结果？直接导入 →")}</button></header>\n    <nav'
assert s.count(needle)==1;s=s.replace(needle,replacement)
old='<article class="panel"><h2>${t(\'First time connecting a model?\',\'首次接入模型？\')}</h2>'
new='<details class="panel model-discovery"><summary>${t(\'Need a model profile? Start with local discovery.\',\'需要模型配置？先在本地识别模型。\')}</summary>'
assert old in s;s=s.replace(old,new)
needle="本适配器不支持批次/瞬态积累项，也不执行未经核查的表达式。')}</p></article>"
assert needle in s;s=s.replace(needle,needle.replace('</article>','</details>'))
p.write_text(s,encoding='utf-8')
