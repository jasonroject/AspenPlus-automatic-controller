import {mountChrome,escapeHTML} from './site.mjs';
import {exampleCode,runExample} from './demo.mjs';
import {getLanguage} from './i18n.mjs';
// Preserve links shared before the public landing page was introduced.
if(/^#view=(overview|cases|process|lca|screening|sources)(?:&|$)/.test(location.hash))location.replace((getLanguage()==='zh'?'workspace.zh.html':'index.en.html')+location.hash);
mountChrome('Home');
document.querySelector('#hero-code').innerHTML=exampleCode.split('\n').map((line,i)=>`<span class="code-line" style="--n:${i}">${escapeHTML(line)||' '}</span>`).join('');
const toggle=document.querySelector('#motion-toggle');
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
function setPaused(paused){document.body.classList.toggle('paused',paused);toggle.setAttribute('aria-pressed',String(paused));toggle.disabled=reduced.matches;toggle.textContent=reduced.matches?'Reduced motion on':paused?'Resume motion ▷':'Pause motion Ⅱ';}
setPaused(reduced.matches);
toggle.addEventListener('click',()=>setPaused(!document.body.classList.contains('paused')));
reduced.addEventListener('change',()=>setPaused(reduced.matches));
document.querySelector('#run-example').addEventListener('click',event=>runExample(event.currentTarget,document.querySelector('#demo-output')));
