import { t } from '../i18n';
import React, { useEffect, useState } from 'react';

export function ViewZoomControls({ label, percent, onChange, onFit, onFocusCanvas, min = 0.01, max = 100000 }: {
  label: string; percent: number; onChange: (percent: number) => void; onFit: () => void; onFocusCanvas?: () => void; min?: number; max?: number;
}) {
  const formatted = String(Number(percent.toPrecision(6)));
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);
  const commit = () => {
    const value = Number(draft.replace('%', '').trim());
    setDraft(formatted);
    if (draft.trim() && Number.isFinite(value) && value >= min && value <= max) onChange(value);
  };
  return <div className="view-zoom-controls" role="group" aria-label={t(`${label}视图缩放`)}>
    <span>{t("视图缩放")}</span>
    <button type="button" aria-label={t(`缩小${label}视图`)} disabled={percent <= min} onClick={() => { onChange(Math.max(min, percent / 1.25)); onFocusCanvas?.(); }}>−</button>
    <label><input aria-label={t(`${label}缩放百分比`)} inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.currentTarget.blur(); onFocusCanvas?.(); } if (e.key === 'Escape') { e.preventDefault(); setDraft(formatted); } }} /><span>%</span></label>
    <button type="button" aria-label={t(`放大${label}视图`)} disabled={percent >= max} onClick={() => { onChange(Math.min(max, percent * 1.25)); onFocusCanvas?.(); }}>＋</button>
    <button type="button" onClick={() => { onFit(); onFocusCanvas?.(); }} aria-label={t(`适合${label}视图`)}>{t("适合")}</button>
    <button type="button" onClick={() => { onChange(100); onFocusCanvas?.(); }} aria-label={t(`重置${label}缩放为100%`)}>100%</button>
  </div>;
}
