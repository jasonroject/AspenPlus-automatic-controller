from pathlib import Path
p=Path('outputs/cad-workspace-i18n-20261117')
s=(p/'round-27.mjs').read_text(encoding='utf-8')
s=s.replace("await p.click('.options-trigger');await p.selectOption('.language-option select','en');await p.click('.workspace-options .icon-button');",'')
(p/'round-29.mjs').write_text(s,encoding='utf-8')
