from pathlib import Path
root = Path(__file__).resolve().parents[2] / 'analysis_web'
for name in ['index.en.html', 'workspace.zh.html', 'pipeline.html', 'universal.html']:
    path = root / name
    text = path.read_text(encoding='utf-8')
    text = text.replace('</head>', '<link rel="stylesheet" href="workspace-refresh.css"></head>')
    text = text.replace('</body>', '<script type="module" src="workspace-links.mjs"></script></body>')
    path.write_text(text, encoding='utf-8')
