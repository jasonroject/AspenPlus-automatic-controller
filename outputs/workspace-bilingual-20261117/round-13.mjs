const task=await taskSpace(2),page=task.page('p1');
console.log(await page.evaluate(()=>({draft:document.querySelector('#project-json').value.slice(0,20),discardDisabled:document.querySelector('#discard-json').disabled,active:[...document.querySelectorAll('[data-tab]')].find(b=>b.getAttribute('aria-pressed')==='true').dataset.tab,viewport:[innerWidth,innerHeight]})));
console.log(await page.snapshot());
const review=task.page('p2');
console.log('review',await review.evaluate(()=>({running:[...document.querySelectorAll('button')].some(b=>b.innerText==='Stop'),text:document.querySelector('main')?.innerText.slice(-24000)})));
