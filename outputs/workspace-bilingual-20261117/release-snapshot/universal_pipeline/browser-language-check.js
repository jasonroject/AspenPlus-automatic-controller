// Run this expression with Ego page.evaluate() on a local analysis page.
// It checks real DOM behavior and restores the prior language on completion.
(async () => {
  if (/\/(index\.en|workspace\.zh)\.html$/.test(location.pathname)) throw new Error('Run language DOM checks in the importer, prediction page or documentation; archive language switches navigate.');
  const {getLanguage,setLanguage,translatePage,t} = await import(new URL('i18n.mjs', location.href));
  const previous = getLanguage();
  const fixture = document.createElement('section');
  fixture.hidden = true;
  fixture.innerHTML = '<p data-test="label">Purchased energy</p><select><option>Purchased energy</option><option value="T325-L8.5-HR">Home</option></select><input value="Home"><textarea>{"case_id":"T325-L8.5-HR","energy":2.231}</textarea><p data-no-i18n>Home</p><code>Purchased energy</code><p data-test="dynamic"></p><p data-test="status" data-i18n-en="Loading test data" data-i18n-zh="正在加载测试数据">Loading test data</p>';
  document.body.append(fixture);
  const passed = [];
  const check = (condition, name) => { if (!condition) throw new Error(name); passed.push(name); };
  try {
    setLanguage('en'); translatePage(fixture);
    const source = {
      input: fixture.querySelector('input').value,
      draft: fixture.querySelector('textarea').value,
      optionValues: [...fixture.querySelectorAll('option')].map(o=>o.value)
    };
    setLanguage('zh'); translatePage(fixture);
    check(fixture.querySelector('[data-test="label"]').textContent === '购入能量','Static labels render in Chinese');
    check(fixture.querySelector('option').textContent === '购入能量','Option labels are translated');
    check(JSON.stringify([...fixture.querySelectorAll('option')].map(o=>o.value))===JSON.stringify(source.optionValues),'Translated options preserve implicit and explicit data values');
    check(fixture.querySelector('input').value===source.input && fixture.querySelector('textarea').value===source.draft,'Input values and pending JSON remain byte-for-byte unchanged');
    check(fixture.querySelector('[data-no-i18n]').textContent==='Home' && fixture.querySelector('code').textContent==='Purchased energy','Scientific source text and code are excluded');
    fixture.querySelector('[data-test="dynamic"]').textContent=t('Dynamic range label','动态范围标签');
    fixture.querySelector('[data-test="status"]').textContent='New computed status: 325 °C';
    translatePage(fixture);
    check(fixture.querySelector('[data-test="status"]').textContent==='New computed status: 325 °C','Initial translation attributes do not overwrite newer computed status');
    setLanguage('en'); translatePage(fixture);
    check(fixture.querySelector('[data-test="label"]').textContent==='Purchased energy','Static labels restore their exact English source');
    check(fixture.querySelector('[data-test="dynamic"]').textContent==='Dynamic range label','Dynamically registered labels restore English');
    localStorage.setItem('process-studio-language','zh');
    window.dispatchEvent(new Event('pageshow'));
    check(getLanguage()==='zh' && fixture.querySelector('[data-test="label"]').textContent==='购入能量','Back-forward restore adopts current global preference');
    return {passed:passed.length,checks:passed};
  } finally {
    fixture.remove();
    setLanguage(previous);
    localStorage.setItem('process-studio-language',previous);
    translatePage();
  }
})()
