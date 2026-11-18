from pathlib import Path
p=Path(__file__).resolve().parents[2]/'analysis_web/models.mjs'
s=p.read_text(encoding='utf-8')
old="(check?.variables||[]).map(v=>"
assert s.count(old)==1
s=s.replace(old,"(check?.ready?check.variables:[]).map(v=>")
s=s.replace('min="${v.min}" max="${v.max}"','min="${esc(v.min)}" max="${esc(v.max)}"')
p.write_text(s,encoding='utf-8')
