from pathlib import Path
root=Path(__file__).resolve().parents[2]/'analysis_web'
for filename,needle,replacement in [
 ('models.html','<link rel="stylesheet" href="models.css">','<link rel="stylesheet" href="models.css"><link rel="stylesheet" href="model-artifacts.css">'),
 ('pipeline.html','<link rel="stylesheet" href="pipeline.css?v=2">','<link rel="stylesheet" href="pipeline.css?v=2"><link rel="stylesheet" href="response-inspector.css">')]:
 p=root/filename;text=p.read_text(encoding='utf-8')
 if needle not in text:
  if filename=='pipeline.html':
   import re
   matches=re.findall(r'<link rel="stylesheet" href="pipeline.css[^\"]*">',text)
   assert len(matches)==1,matches
   needle=matches[0];replacement=needle+'<link rel="stylesheet" href="response-inspector.css">'
  else:raise ValueError(filename)
 p.write_text(text.replace(needle,replacement,1),encoding='utf-8')
