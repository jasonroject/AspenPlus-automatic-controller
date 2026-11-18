import {mountChrome,escapeHTML as e} from './site.mjs';
mountChrome('Brand lab');
const grid=document.querySelector('#logo-grid');
try{
  const response=await fetch('assets/brand/manifest.json');if(!response.ok)throw new Error('Could not load the logo collection. Please reload.');
  const {logos}=await response.json();
  grid.innerHTML=logos.map(l=>`<button class="logo-card" data-id="${l.id}" aria-pressed="${l.id==='01'}" aria-label="Preview ${l.id} ${e(l.name)}"><img src="${l.path}" alt="${e(l.name)} logo" loading="lazy" width="240" height="240"><span><small>${l.id}</small>${e(l.name)}</span></button>`).join('');
  grid.addEventListener('click',event=>{const button=event.target.closest('button[data-id]');if(!button)return;const logo=logos.find(l=>l.id===button.dataset.id);grid.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    document.querySelector('#preview-mark').src=logo.path;document.querySelector('#preview-mark').alt=logo.name+' logo';document.querySelector('#preview-small').src=logo.path;document.querySelector('#preview-number').textContent=`CONCEPT ${logo.id}${logo.id==='01'?' / SITE IDENTITY':''}`;document.querySelector('#preview-title').textContent=logo.name;document.querySelector('#preview-description').textContent=logo.concept;const download=document.querySelector('#logo-download');download.href=logo.path;download.download=`process-studio-${logo.id}.png`;document.querySelector('#logo-status').textContent=`Selected ${logo.id}, ${logo.name}`;
    if(window.matchMedia('(max-width: 800px)').matches)document.querySelector('.brand-preview').scrollIntoView({behavior:'instant',block:'start'});
  });
}catch(error){grid.textContent=error.message;}
