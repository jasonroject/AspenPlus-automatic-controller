import test from 'node:test';
import assert from 'node:assert/strict';
import {t,getLanguage,setLanguage} from '../analysis_web/i18n.mjs';
import {docs as english} from '../analysis_web/docs-content.mjs';
import {docs as chinese} from '../analysis_web/docs-content.zh.mjs';

test('language selection changes presentation while unknown scientific identifiers stay exact',()=>{
  setLanguage('zh');
  assert.equal(getLanguage(),'zh');
  assert.equal(t('Purchased energy'),'购入能量');
  assert.equal(t('Step 2 of 3'),'第 2 步，共 3 步');
  assert.equal(t('T325-L8.5-HR'),'T325-L8.5-HR');
  assert.equal(t('1 kg catechol + o-cresol'),'1 kg catechol + o-cresol');
  assert.equal(t('A new chart','一张新图'),'一张新图');
  setLanguage('en');
  assert.equal(t('A new chart'),'A new chart');
  assert.equal(t('Purchased energy'),'Purchased energy');
});

test('English and Chinese docs retain all article and deep-link section identities',()=>{
  assert.deepEqual(chinese.map(d=>d.id),english.map(d=>d.id));
  for(const en of english){
    const zh=chinese.find(d=>d.id===en.id);
    const ids=body=>[...body.matchAll(/<h2 id="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(ids(zh.body),ids(en.body),en.id);
    assert.ok(/[\u3400-\u9fff]/.test(zh.description),en.id);
    for(const [,target]of zh.body.matchAll(/href="#([^"]+)"/g))assert.ok(chinese.some(d=>d.id===target),`${en.id}: ${target}`);
  }
});

test('translated docs preserve executable code and scientific API field names',()=>{
  const snippets=body=>[...body.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(m=>m[1]);
  for(const id of ['contract','units','balances','lca','fuzzy','api','local','models'])assert.deepEqual(snippets(chinese.find(d=>d.id===id).body),snippets(english.find(d=>d.id===id).body),id);
  for(const field of ['nominal_subtotal','complete: false','kind:'])assert.ok(chinese.some(d=>d.body.includes(field)),field);
});
