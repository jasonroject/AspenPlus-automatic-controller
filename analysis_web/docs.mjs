import {mountChrome,escapeHTML as e,copyText} from './site.mjs';
import {docs} from './docs-content.mjs';
import {runExample} from './demo.mjs';
mountChrome('Docs');
const main=document.querySelector('#main'),nav=document.querySelector('#docs-nav'),search=document.querySelector('#doc-search'),results=document.querySelector('#search-results'),sidebar=document.querySelector('#docs-sidebar'),menu=document.querySelector('#docs-menu');
nav.innerHTML=[...new Set(docs.map(d=>d.group))].map(group=>`<section class="nav-group"><h2>${e(group)}</h2>${docs.filter(d=>d.group===group).map(d=>`<a href="#${d.id}">${e(d.title)}</a>`).join('')}</section>`).join('');
function render(focus=false){const [requested,section]=(location.hash.slice(1)||'overview').split('/');const index=Math.max(0,docs.findIndex(d=>d.id===requested));const doc=docs[index];document.title=`${doc.title} · Process Studio Docs`;
  main.innerHTML=`<span class="eyebrow">DOCUMENTATION / ${e(doc.group)}</span><h1>${e(doc.title)}</h1><p class="lead">${e(doc.description)}</p>${doc.body}<nav class="doc-pager" aria-label="Previous and next articles">${index>0?`<a href="#${docs[index-1].id}"><span>Previous</span>← ${e(docs[index-1].title)}</a>`:'<a href="index.html"><span>Explore</span>← Home</a>'}${docs[index+1]?`<a href="#${docs[index+1].id}"><span>Next</span>${e(docs[index+1].title)} →</a>`:''}</nav>`;
  nav.querySelectorAll('a').forEach(a=>{if(a.hash==='#'+doc.id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const headings=[...main.querySelectorAll('h2[id]')];
  document.querySelector('#docs-toc').innerHTML='<strong>On this page</strong>'+headings.map(h=>`<a href="#${doc.id}/${h.id}">${e(h.textContent)}</a>`).join('');
  sidebar.classList.remove('open');menu.setAttribute('aria-expanded','false');
  const destination=section?headings.find(h=>h.id===section):null;
  if(focus){if(destination)destination.scrollIntoView({behavior:'instant',block:'start'});else{window.scrollTo({top:0,behavior:'instant'});main.focus({preventScroll:true});}}
}
window.addEventListener('hashchange',()=>{search.value='';results.hidden=true;document.querySelector('#search-status').textContent='';render(true);});
render(Boolean(location.hash.includes('/')));
main.removeAttribute('aria-busy');search.disabled=false;menu.disabled=false;
menu.addEventListener('click',()=>{const on=sidebar.classList.toggle('open');menu.setAttribute('aria-expanded',String(on));});
// Build search text from trusted local article HTML; no user input enters HTML.
const searchable=docs.map(d=>{const node=document.createElement('div');node.innerHTML=d.body;return {...d,text:(d.title+' '+d.description+' '+node.textContent).toLowerCase()};});
search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();results.hidden=!query;if(!query){results.replaceChildren();document.querySelector('#search-status').textContent='';return;}const words=query.split(/\s+/),relevance=d=>d.title.toLowerCase()===query?3:d.title.toLowerCase().includes(query)?2:words.every(w=>d.title.toLowerCase().includes(w))?1:0;const matches=searchable.filter(d=>words.every(word=>d.text.includes(word))).sort((a,b)=>relevance(b)-relevance(a));
  document.querySelector('#search-status').textContent=`${matches.length} matching articles`;
  results.innerHTML=matches.length?matches.map(d=>`<a href="#${d.id}">${e(d.title)}<small>${e(d.group)}</small></a>`).join(''):'<p>No articles found. Try “units”, “factors” or “ranking”.</p>';
});
search.addEventListener('keydown',event=>{if(event.key==='Escape'){search.value='';search.dispatchEvent(new Event('input'));}if(event.key==='Enter'){results.querySelector('a')?.click();}});
results.addEventListener('click',event=>{if(event.target.closest('a')){results.hidden=true;search.value='';}});
main.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.classList.contains('copy-button'))copyText(button.closest('.code-block').querySelector('code').textContent,button);if(button.id==='docs-run')runExample(button,document.querySelector('#docs-output'));});
