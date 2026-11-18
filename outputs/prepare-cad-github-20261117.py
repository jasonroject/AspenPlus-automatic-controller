from pathlib import Path
import shutil, hashlib, json
root=Path(__file__).resolve().parent.parent
src=root/'extrudecad-web'
dst=root/'outputs/cad-github-20261117'
assert (dst/'.git').is_dir()
files=['README.md','QA.md','THIRD_PARTY_NOTICES.txt','build-standalone.mjs','index.html','metadata.json','package.json','package-lock.json','tsconfig.json','vite.config.ts']
files += [str(p.relative_to(src)) for p in (src/'src').rglob('*') if p.is_file()]
files += [str(p.relative_to(src)) for p in (src/'deliverables').iterdir() if p.suffix in ('.md','.html','.sha256')]
for rel in files:
    target=dst/rel
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(src/rel,target)
    assert hashlib.sha256((src/rel).read_bytes()).digest()==hashlib.sha256(target.read_bytes()).digest()
(dst/'.gitignore').write_text('node_modules/\ndist/\n.qa/\n.openai/\n.env*\n*.log\n',encoding='utf-8')
print(json.dumps({'copiedFiles':len(files),'sourceFilesByteIdentical':True,'artifactSha256':hashlib.sha256((dst/'deliverables/ExtrudeCAD_Studio.html').read_bytes()).hexdigest()}))
