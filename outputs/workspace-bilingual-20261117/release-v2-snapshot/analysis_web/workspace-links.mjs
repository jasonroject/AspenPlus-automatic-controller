// Keep the analysis applications connected to the public site and documentation.
import {mountLanguage,getLanguage,translatePage} from './i18n.mjs';
const nav=document.querySelector('.sidebar nav');
if(nav){const links=document.createElement('div');links.className='workspace-site-links';links.innerHTML='<a class="nav-item" href="index.html">← Process Studio home</a><a class="nav-item" href="docs.html">Documentation ↗</a>';nav.prepend(links);}
if (/\/(index\.en|workspace\.zh)\.html$/.test(location.pathname)) {
  const target = getLanguage() === 'zh' ? 'workspace.zh.html' : 'index.en.html';
  if (!location.pathname.endsWith(target)) location.replace(target + location.search + location.hash);
  if (getLanguage() === 'zh' && nav && !nav.querySelector('a[href="pipeline.html"]')) {
    const link = document.createElement('a'); link.className = 'nav-item'; link.href = 'pipeline.html'; link.textContent = '预测与鲁棒性 ↗'; nav.append(link);
  }
}
mountLanguage(document.querySelector('.case-toolbar-actions') || document.querySelector('.pipeline-top'));
translatePage();
