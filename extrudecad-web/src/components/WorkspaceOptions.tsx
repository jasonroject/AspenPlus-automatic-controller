import { t, useLocale, setLocale, Locale } from '../i18n';
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type PanelLayout = 'compact' | 'standard' | 'wide';
export function WorkspaceOptions({ open, onClose, layout, onLayoutChange, onFit }: {
  open: boolean; onClose: () => void; layout: PanelLayout; onLayoutChange: (layout: PanelLayout) => void; onFit: () => void;
}) {
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) { if (!ref.current?.open) ref.current?.showModal(); }
    else ref.current?.close();
  }, [open]);
  return <dialog ref={ref} className="workspace-options" aria-labelledby="workspace-options-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="options-heading"><h2 id="workspace-options-title">{t("工作区选项")}</h2><button className="icon-button" aria-label={t("关闭工作区选项")} onClick={onClose}><X size={18} /></button></div>
    <label className="options-row language-option">{t('界面语言')}<select aria-label={t('界面语言')} value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="zh">中文</option><option value="en">English</option></select></label>
    <label className="options-row">{t("面板固定尺寸")}<select aria-label={t("面板固定尺寸")} value={layout} onChange={e => onLayoutChange(e.target.value as PanelLayout)}><option value="compact">{t("紧凑 · 左190 / 右230 px")}</option><option value="standard">{t("标准 · 左220 / 右260 px")}</option><option value="wide">{t("宽敞 · 左260 / 右300 px")}</option></select></label>
    <p>{t("顶栏固定48px，侧栏按所选像素宽度显示。绘图区放大缩小时，按钮、文字与面板大小保持不变。窄窗口自动收起侧栏。")}</p>
    <div className="options-section"><h3>{t("工作区缩放")}</h3><p>{t("在二维或三维编辑视图内滚动鼠标，以鼠标位置为中心缩放图形。也可使用上方 − / ＋、百分比、100% 或“适合”。视图外滚轮不缩放界面，Ctrl + 滚轮不会缩放整个页面；列表和属性面板仍可正常滚动。")}</p><p>{t("二维100%为基础显示倍率；三维100%为当前视角适合模型的倍率。这里不是打印比例。")}</p><button type="button" className="quiet-button" onClick={() => { onFit(); onClose(); }}>{t("适合当前工作区")}</button></div>
    <div className="options-section"><h3>{t("点线外观")}</h3><p>{t("草图左上“显示”可设置点样式、点尺寸、线显示宽度和节点名称。")}</p></div>
  </dialog>;
}
