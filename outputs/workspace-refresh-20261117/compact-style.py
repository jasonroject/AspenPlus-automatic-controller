from pathlib import Path
p=Path(__file__).resolve().parents[2]/'analysis_web/universal.css'
with p.open('a',encoding='utf-8') as f:
    f.write('''
.panel-heading p,.example-panel>p{font-size:13px}.sidebar .nav-item{font-size:13px}.help-link,.workbench-header nav{font-size:12px}
@media(max-width:700px){.overview-heading h1{font-size:29px}.overview-heading .eyebrow{margin-bottom:12px}.overview-heading p{margin-bottom:12px}.workspace main{padding-top:25px}.overview-heading{margin-bottom:18px}.workflow-heading{margin:23px 0 20px}.workbench-header nav,.sidebar .nav-item{font-size:11px}.help-link{font-size:11px}}
''')
