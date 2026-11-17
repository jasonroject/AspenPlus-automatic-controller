// Keep the analysis applications connected to the public site and documentation.
const nav=document.querySelector('.sidebar nav');
if(nav){const links=document.createElement('div');links.className='workspace-site-links';links.innerHTML='<a class="nav-item" href="index.html">← Process Studio home</a><a class="nav-item" href="docs.html">Documentation ↗</a>';nav.prepend(links);}
