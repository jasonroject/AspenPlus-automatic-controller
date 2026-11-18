from pathlib import Path
root=Path(__file__).resolve().parents[2]/'analysis_web'
link='<a class="nav-item" href="models.html" data-i18n-en="↳ Local Aspen models" data-i18n-zh="↳ 本地 Aspen 模型">↳ Local Aspen models</a>'
for name in ['universal.html','pipeline.html']:
 p=root/name;s=p.read_text(encoding='utf-8')
 start=s.index('<aside');end=s.index('</aside>',start)
 part=s[start:end]
 if 'href="models.html"' not in part:
  anchor=part.index('</a>')+4;part=part[:anchor]+link+part[anchor:];s=s[:start]+part+s[end:]
 p.write_text(s,encoding='utf-8')
p=root/'universal.html';s=p.read_text(encoding='utf-8');needle='Need the right column names?'
s=s.replace('<div class="template-row"><span>'+needle,'<div class="template-row"><a href="models.html" data-i18n-en="Working with a native Aspen model? →" data-i18n-zh="需要接入原生 Aspen 模型？ →">Working with a native Aspen model? →</a><span>'+needle,1)
p.write_text(s,encoding='utf-8')
p=root/'models.html';s=p.read_text(encoding='utf-8').replace('href="docs.html#import"','href="docs.html#models"');p.write_text(s,encoding='utf-8')
