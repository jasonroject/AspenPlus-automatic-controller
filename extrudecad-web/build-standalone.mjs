import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'vite';

await build();
const dist = resolve('dist');
let html = await readFile(join(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
for (const match of scripts) {
  const js = await readFile(resolve(dist, match[1]), 'utf8');
  html = html.replace(match[0], () => '<script type="module">' + js.replace(/<\/script/gi, '<\\/script') + '</script>');
}
const styles = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)];
for (const match of styles) {
  const css = await readFile(resolve(dist, match[1]), 'utf8');
  html = html.replace(match[0], () => '<style>' + css.replace(/<\/style/gi, '<\\/style') + '</style>');
}
const markupOnly = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
if (/<script[^>]*\bsrc=|<link[^>]*(?:stylesheet|modulepreload)/i.test(markupOnly)) throw new Error('Standalone HTML still has external application assets.');
const notices = await readFile(resolve('THIRD_PARTY_NOTICES.txt'), 'utf8');
html = html.replace('</body>', () => '<script type="text/plain" id="third-party-notices">' + notices.replace(/<\/script/gi, '<\\/script') + '</script></body>');
await mkdir('deliverables', { recursive: true });
await writeFile('deliverables/ExtrudeCAD_Studio.html', html, 'utf8');
await writeFile('dist/ExtrudeCAD_Studio.html', html, 'utf8');
console.log('Standalone HTML: ' + resolve('deliverables/ExtrudeCAD_Studio.html'));
