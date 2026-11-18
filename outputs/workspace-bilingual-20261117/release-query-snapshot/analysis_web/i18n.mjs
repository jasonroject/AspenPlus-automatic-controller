import {dictionary, translateDynamic} from './i18n-dictionary.mjs';

const preferenceKey = 'process-studio-language';
const browser = typeof document !== 'undefined';
const pairs = new Map(Object.entries(dictionary));
const reverse = new Map([...pairs].map(([en, zh]) => [zh, en]));
let language = browser && location.pathname.endsWith('workspace.zh.html') ? 'zh' : 'en', titleRecord;
if (browser) {
  try {
    const query = new URL(location.href).searchParams.get('lang');
    language = query === 'zh' || query === 'en' ? query : localStorage.getItem(preferenceKey) || (location.pathname.endsWith('workspace.zh.html') ? 'zh' : 'en');
    if (!['en', 'zh'].includes(language)) language = 'en';
    localStorage.setItem(preferenceKey, language);
  } catch { /* The control also works when storage is unavailable. */ }
}
export const getLanguage = () => language;
export function t(english, chinese) {
  if (chinese) { pairs.set(english, chinese); reverse.set(chinese, english); }
  if (language !== 'zh') return english;
  const translated=pairs.get(english) ?? translateDynamic(english);
  // Generated messages may enter the DOM in Chinese before the text observer
  // sees them. Keep their exact English source for a later language switch.
  if (translated) { pairs.set(english,translated); reverse.set(translated,english); }
  return translated ?? english;
}
const originalText = new WeakMap(), originalAttributes = new WeakMap();
const skip = 'script,style,pre,code,textarea,[data-no-i18n],[translate="no"],.language-switch';
function replaceText(node) {
  if (!node.parentElement || node.parentElement.closest(skip)) return;
  const current = node.nodeValue, previous = originalText.get(node);
  const source = previous && current === previous.rendered ? previous.source : current;
  const trimmed = source.trim();
  if (!trimmed) return;
  const english = reverse.get(trimmed) ?? trimmed;
  const translated = language === 'zh' ? pairs.get(english) ?? translateDynamic(english) ?? trimmed : english;
  const rendered = source.replace(trimmed, translated);
  originalText.set(node, {source: source.replace(trimmed, english), rendered});
  if (current !== rendered) node.nodeValue = rendered;
}
export function translatePage(root = browser ? document.body : null) {
  if (!root || !browser) return;
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  const currentTitle = document.title;
  const titleSource = titleRecord && currentTitle === titleRecord.rendered ? titleRecord.source : reverse.get(currentTitle) ?? currentTitle;
  const translatedTitle = t(titleSource);
  titleRecord = {source: titleSource, rendered: translatedTitle};
  if (currentTitle !== translatedTitle) document.title = translatedTitle;
  // Option text is also its value unless a value attribute was supplied. Freeze
  // this machine-facing value before changing the visible label.
  for (const option of root.querySelectorAll('option:not([value])')) option.setAttribute('value', option.value);
  for (const element of root.querySelectorAll('[data-i18n-en][data-i18n-zh]')) {
    if (element.closest(skip)) continue;
    // A renderer may replace an initially static status with a computed message.
    // Do not restore an obsolete loading label over that newer state.
    const content = element.textContent.trim();
    if (content !== element.dataset.i18nEn && content !== element.dataset.i18nZh) continue;
    const value = t(element.dataset.i18nEn, element.dataset.i18nZh);
    if (element.textContent !== value) element.textContent = value;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) replaceText(walker.currentNode);
  for (const element of root.querySelectorAll('[aria-label],[title],[placeholder]')) {
    if (element.closest(skip)) continue;
    const record = originalAttributes.get(element) || {};
    for (const name of ['aria-label', 'title', 'placeholder']) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name), previous = record[name];
      const source = previous && current === previous.rendered ? previous.source : reverse.get(current) ?? current;
      const rendered = t(source);
      record[name] = {source, rendered};
      if (rendered !== current) element.setAttribute(name, rendered);
    }
    originalAttributes.set(element, record);
  }
  for (const button of document.querySelectorAll('.language-switch button')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (/^(?:\.\/)?(?:index\.en|workspace\.zh)\.html(?:[?#]|$)/.test(href)) anchor.setAttribute('href', href.replace(/(?:index\.en|workspace\.zh)\.html/, language === 'zh' ? 'workspace.zh.html' : 'index.en.html'));
  }
}
export function setLanguage(next) {
  if (!['en', 'zh'].includes(next) || next === language) return;
  language = next;
  if (!browser) return;
  try { localStorage.setItem(preferenceKey, next); } catch { /* Session-only selection. */ }
  const current = new URL(location.href);
  if (current.searchParams.has('lang')) { current.searchParams.set('lang', next); history.replaceState(history.state, '', current); }
  const archive = /\/(index\.en|workspace\.zh)\.html$/.test(location.pathname);
  if (archive) {
    const target = language === 'zh' ? 'workspace.zh.html' : 'index.en.html';
    location.assign(target + location.search + location.hash);
    return;
  }
  window.dispatchEvent(new CustomEvent('languagechange', {detail: {language}}));
  translatePage();
}
export function mountLanguage(container) {
  if (!browser) return null;
  let control = document.querySelector('.language-switch');
  if (!control) {
    control = document.createElement('div');
    control.className = 'language-switch';
    control.setAttribute('role', 'group');
    control.setAttribute('aria-label', 'Language / 界面语言');
    control.innerHTML = '<button type="button" data-language="en" lang="en" aria-label="Switch to English">EN</button><button type="button" data-language="zh" lang="zh-CN" aria-label="切换为中文">中文</button>';
    control.addEventListener('click', event => { const button = event.target.closest('[data-language]'); if (button) setLanguage(button.dataset.language); });
    const host = container || document.querySelector('.workbench-header,.site-header,.pipeline-top,.case-toolbar-actions,.sidebar');
    (host || document.body).append(control);
  }
  translatePage();
  return control;
}
if (browser) {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./i18n.css', import.meta.url).href; document.head.append(stylesheet);
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; translatePage(); });
  });
  const start = () => { translatePage(); observer.observe(document.body, {childList: true, characterData: true, subtree: true}); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, {once: true});
  window.addEventListener('storage', event => { if (event.key === preferenceKey && ['en', 'zh'].includes(event.newValue)) setLanguage(event.newValue); });
  window.addEventListener('pageshow', () => {
    // A page restored from the back-forward cache may have missed a preference
    // change made in the next page. Re-render in the current global language.
    try { const saved = localStorage.getItem(preferenceKey); if (['en','zh'].includes(saved)) setLanguage(saved); } catch { /* Keep the in-page selection. */ }
    translatePage();
  });
}
