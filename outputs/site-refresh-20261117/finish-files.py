import json
from pathlib import Path
root = Path(__file__).resolve().parents[2] / 'analysis_web'
p = root / 'docs.html'
text = p.read_text(encoding='utf-8')
text = text.replace('id="docs-menu" aria-expanded', 'id="docs-menu" disabled aria-expanded')
text = text.replace('id="doc-search" type="search"', 'id="doc-search" type="search" disabled')
text = text.replace('<main id="main" class="docs-article" tabindex="-1"></main>', '<main id="main" class="docs-article" tabindex="-1" aria-busy="true"><p role="status">Loading documentation…</p></main>')
p.write_text(text, encoding='utf-8')
p = root / 'assets/brand/manifest.json'
data = json.loads(p.read_text(encoding='utf-8'))
data['logos'][0]['prompt'] = "Create ONE original minimalist black-and-white logo symbol for 'Process Studio', a scientific process engineering software platform for material and energy balances and life-cycle analysis. Concept 01 'Open loop': a single bold continuous rounded-square pipe path with an open gap at upper right, two small circular terminal nodes at the gap, and one short inset horizontal branch suggesting a P, strong deliberate negative space. It must look like a premium developer-tool identity: extremely clean flat geometric shape, black on pure white, centered, no text or letters written as typography, no wordmark, no mockups, no shadows, no gradients, no texture, no watermarks. Use a large simple mark occupying 65% of a square canvas, generous white margins. Optically balanced at favicon size. Must be original, not the OpenAI knot logo or any other brand's logo."
p.write_text(json.dumps(data, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
