from pathlib import Path
p=Path('outputs/cad-workspace-i18n-20261117');s=(p/'round-11.mjs').read_text(encoding='utf8')
s=s.replace('const baseline=await save',"if(await p.evaluate(()=>document.querySelector('.workbench-shell').classList.contains('inspector-collapsed')))await p.click('[aria-label=\"展开属性面板\"]');const panelWidth=await p.evaluate(()=>document.querySelector('.inspector').getBoundingClientRect().width);const baseline=await save")
s=s.replace('assert.ok((await rect()).w>normal.w+250)','assert.ok(Math.abs((await rect()).w-normal.w-panelWidth)<1)').replace('画布释放和恢复260px','画布按实际面板宽度释放和恢复')
(p/'round-13.mjs').write_text(s,encoding='utf8')
