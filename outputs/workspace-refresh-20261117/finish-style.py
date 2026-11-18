from pathlib import Path
p=Path(__file__).resolve().parents[2]/'analysis_web/universal.css'
with p.open('a',encoding='utf-8') as f:
    f.write('''
.sidebar-label{display:block;margin:16px 12px 18px}.workflow-heading,#workflow-title,#mapping-panel,#row-editor,#results-overview,#energy-section,#impact-section,#comparison-section{scroll-margin-top:95px}
@media(max-width:1000px){.sidebar-help{display:none}.process-workbench .sidebar{top:auto}.sidebar>div:first-child{width:100%}.sidebar nav{padding:0;border:0}.sidebar .sidebar-label{display:none}}
@media(max-width:700px){.start-grid{grid-template-columns:1fr}.workbench-header{height:auto;min-height:70px;padding:14px 20px;gap:12px;flex-wrap:wrap}.workbench-header .wordmark{font-size:15px}.workbench-header .wordmark img{width:30px;height:30px}.workbench-header nav{order:3;width:100%;justify-content:center;padding-top:10px;border-top:1px solid var(--line);margin:0;font-size:11px}.workbench-header>.button{margin-left:auto;min-height:36px;font-size:10px;padding:8px 13px}.overview-heading{flex-wrap:wrap}.next-step,.action-row{align-items:stretch;flex-direction:column;gap:16px}.next-step .button{width:100%}.sidebar{padding:12px 20px}.workflow-heading,#workflow-title,#mapping-panel,#row-editor,#results-overview,#energy-section,#impact-section,#comparison-section{scroll-margin-top:125px}}
''')
