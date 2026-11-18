import { useSyncExternalStore } from 'react';
import english from './locales/en.json';

export type Locale = 'zh' | 'en';
let locale: Locale = 'zh';
try { if (typeof window !== 'undefined' && localStorage.getItem('extrudecad.locale') === 'en') locale = 'en'; } catch { /* Session fallback. */ }
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useLocale = () => useSyncExternalStore(subscribe, () => locale, () => 'zh' as Locale);
export function setLocale(next: Locale) {
  locale = next;
  try { localStorage.setItem('extrudecad.locale', next); } catch { /* Session fallback. */ }
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
  document.title = next === 'en' ? 'ExtrudeCAD Studio — Sketch & Model' : 'ExtrudeCAD Studio — 草图与建模';
  listeners.forEach(listener => listener());
}
const dictionary: Record<string, string> = english;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  expression: new RegExp('^' + key.split(/\{\d+\}/).map(escape).join('([\\s\\S]*?)') + '$'), value,
}));

export function translate(text: string, language: Locale, depth = 0): string {
  if (language === 'zh' || !/[\u3400-\u9fff]/.test(text)) return text;
  if (dictionary[text]) return dictionary[text];
  for (const { expression, value } of patterns) {
    const match = expression.exec(text);
    if (match) return value.replace(/\{(\d+)\}/g, (_, index) => depth < 2 ? translate(match[Number(index) + 1] ?? '', language, depth + 1) : match[Number(index) + 1] ?? '');
  }
  return text;
}

/** Only presentation strings are translated; numbers, React nodes and model data pass through. */
export function t<T>(value: T): T { return (typeof value === 'string' ? translate(value, locale) : value) as T; }
