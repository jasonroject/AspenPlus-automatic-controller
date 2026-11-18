import { t } from '../i18n';
import React, { useEffect, useState } from 'react';
import { Box, Copy, Trash2, MousePointer2, Layers, Ruler, Move, Palette, LockKeyhole, PanelRightClose } from 'lucide-react';
import { CadShape, MaterialPresetId, MATERIAL_PRESETS, computeShapeMetrics, computeBounds2D, resizeShape2D, resizeShapeEdge2D, translateShape2D } from '../utils/cadEngine';

interface InspectorProps {
  shapes: CadShape[];
  selectedIds: string[];
  onUpdateShape: (shape: CadShape, transient?: boolean) => void;
  onUpdateMultipleShapes: (shapes: CadShape[], transient?: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCollapse: () => void;
}

const inputStyle = '[color-scheme:dark] w-full min-w-0 h-8 rounded-[4px] border border-[var(--line)] bg-[var(--input)] px-2.5 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--blue)] focus:bg-[var(--paper)] focus:ring-2 focus:ring-[var(--selection-border)] disabled:opacity-50';
const muted = 'text-[var(--muted)]';
const mono = { fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", fontVariantNumeric: 'tabular-nums' as const };
const colors = ['#C8CDD5', '#8E96A0', '#242B36', '#A88B57', '#0066FF', '#B64B4B'];

/** Keep a draft while typing; commit one history entry on Enter or blur. */
function NumberField({ label, value, onCommit, min = -100000, max = 100000, disabled = false }: {
  label: string; value: number; onCommit: (value: number) => void | boolean; min?: number; max?: number; disabled?: boolean;
}) {
  const formatted = String(Number(value.toPrecision(12)));
  const [draft, setDraft] = useState(formatted);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(formatted); setDirty(false); }, [formatted]);
  const commit = () => {
    if (!dirty) return;
    setDirty(false);
    const next = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(next) || next < min || next > max) { setDraft(formatted); return; }
    if (next !== value) onCommit(next);
    setDraft(formatted);
  };
  return <label className="flex flex-col gap-1.5 text-[11px] text-[var(--muted)]">
    {t(label)}<div className="relative"><input aria-label={t(label)} type="number" min={min} max={max} step="any" value={draft} disabled={disabled} style={mono} className={`${inputStyle} pr-7`}
      onChange={(e) => { setDraft(e.target.value); setDirty(true); }} onBlur={commit}
      onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.preventDefault(); setDraft(formatted); setDirty(false); } }} />
      <span className="absolute right-2 top-[9px] text-[9px] pointer-events-none text-[var(--muted)]">mm</span>
    </div>
  </label>;
}

function NameField({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={t("对象名称")} className={`${inputStyle} font-medium`} value={draft} disabled={disabled} maxLength={100} onChange={(e) => setDraft(e.target.value)}
    onBlur={() => { const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value); }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.preventDefault(); setDraft(value); } }} />;
}

function Group({ title, icon: Icon, children, note }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; note?: string }) {
  return <section className="px-4 py-4 border-b border-[var(--line)]">
    <div className="flex items-center gap-2 mb-3"><Icon className="w-3.5 h-3.5 text-[var(--muted)]" /><h3 className="text-[12px] font-semibold text-[var(--ink)]">{t(title)}</h3>{t(note && <span className="ml-auto text-[10px] text-[var(--muted)]">{t(note)}</span>)}</div>
    {children}
  </section>;
}

function Metric({ label, value, unit = 'mm' }: { label: string; value: number; unit?: string }) {
  return <div className="flex items-center justify-between py-1.5 text-[12px]"><span className={muted}>{t(label)}</span><span style={mono} className="text-[var(--ink)]">{t(Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—')} <span className="text-[10px] text-[var(--muted)]">{t(unit)}</span></span></div>;
}

export function Inspector({ shapes, selectedIds, onUpdateShape, onUpdateMultipleShapes, onDuplicate, onDelete, onCollapse }: InspectorProps) {
  const selected = shapes.filter((s) => selectedIds.includes(s.id));
  const shape = selected.length === 1 ? selected[0] : null;
  const metrics = shape ? computeShapeMetrics(shape) : null;
  const bounds = computeBounds2D(selected.flatMap((s) => s.points));
  const locked = Boolean(shape?.locked);
  const reference = shape?.type === 'point' || shape?.type === 'segment';
  const connectedCount = shape?.type === 'point' ? shapes.filter((candidate) => candidate.endpointIds?.includes(shape.id)).length : 0;
  const [referenceError, setReferenceError] = useState('');
  useEffect(() => setReferenceError(''), [shape?.id]);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const height = selected.length ? Math.max(...selected.map((s) => s.zOffset + s.zHeight)) - Math.min(...selected.map((s) => s.zOffset)) : 0;
  const setProperty = (patch: Partial<CadShape>) => {
    if (!shape || locked) return false;
    const next = { ...shape, ...patch };
    if (next.type === 'segment' && Math.hypot(next.points[1].x - next.points[0].x, next.points[1].y - next.points[0].y) < 1e-8) {
      setReferenceError('直线的两个端点不能重合。'); return false;
    }
    setReferenceError(''); onUpdateShape(next); return true;
  };
  const material = shape ? MATERIAL_PRESETS[shape.materialPreset] : null;

  return <aside className="inspector flex h-full w-[260px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--paper)] text-[var(--ink)]" aria-label={t("对象属性检查器")}>
    <div className="h-[37px] shrink-0 flex items-center justify-between border-b border-[var(--line)] px-4">
      <h2 className="text-[13px] font-semibold">{t("属性")}</h2><span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{t(selected.length ? `${selected.length} 已选` : '未选择')}</span><button className="icon-button" aria-label={t("收起属性面板")} title={t("收起属性面板 · Ctrl+1")} onClick={onCollapse}><PanelRightClose size={16} /></button>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto">
      {selected.length === 0 ? <div className="px-5 py-12 text-center">
        <div className="mx-auto mb-5 relative flex w-16 h-16 items-center justify-center rounded-lg border border-dashed border-[var(--line)] bg-[var(--input)]"><Box className="w-7 h-7 text-[var(--muted)]" /><MousePointer2 className="absolute -bottom-1 -right-1 w-6 h-6 p-1 rounded-md bg-[var(--paper)] text-[var(--blue)]" /></div>
        <h3 className="text-[13px] font-medium mb-2">{t("选择一个对象")}</h3><p className="text-[12px] leading-relaxed text-[var(--muted)]">{t("在画布或对象列表中点选，")}<br />{t("调整尺寸、位置和外观。")}</p>
        <div className="mt-8 rounded-lg border border-[var(--line)] p-3 text-left space-y-2"><div className="text-[10px] uppercase tracking-[0.1em] text-[var(--muted)]">{t("快捷操作")}</div><p className="text-[11px] text-[var(--muted)] flex justify-between"><span>{t("选择多个对象")}</span><kbd className="text-[var(--ink)]">{t("Ctrl + 单击")}</kbd></p><p className="text-[11px] text-[var(--muted)] flex justify-between"><span>{t("二维框选")}</span><span>{t("按住空白处拖动")}</span></p><p className="text-[11px] text-[var(--muted)] flex justify-between"><span>{t("撤销操作")}</span><kbd className="text-[var(--ink)]">Ctrl + Z</kbd></p></div>
      </div> : <>
        <Group title={t(shape ? '对象' : '多个对象')} icon={shape ? Box : Layers}>
          {shape ? <><NameField key={shape.id} value={shape.name} disabled={locked} onCommit={(name) => setProperty({ name })} /><div className="mt-2 flex items-center justify-between text-[10px] text-[var(--muted)]"><span>{t(shape.type === 'point' ? '独立定位点' : shape.type === 'segment' ? '两点直线 · 无厚度' : shape.type === 'circle' ? '圆形拉伸体' : shape.type === 'rect' ? '矩形拉伸体' : shape.type === 'line' ? '线段墙体' : '轮廓拉伸体')}</span>{t(locked && <span className="flex items-center gap-1"><LockKeyhole className="w-3 h-3" />{t("已锁定")}</span>)}</div></> : <><div className="text-[22px] font-medium tracking-tight">{t(selected.length)}<span className="text-xs text-[var(--muted)] ml-2">{t("个对象已选中")}</span></div><p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{t(selected.length === 2 && selected.every((s) => s.type === 'point') ? '点击下方“连接两点”创建直线，定位点将保留。' : '使用下方工具栏对齐、镜像或创建阵列。')}</p></>}
        </Group>
        {t(shape?.type === 'point' && connectedCount > 0 && <p className="px-4 py-3 text-[11px] text-[var(--blue)]">{t("连接") + " "}{t(connectedCount)}{" " + t("条直线 · 移动此点会同步更新")}</p>)}
        {t(shape?.type === 'segment' && shape.endpointIds && <p className="px-4 py-3 text-[11px] text-[var(--blue)]">{t("端点已关联 · 编辑端点会同步更新相连直线")}</p>)}
        {shape && metrics ? <React.Fragment key={shape.id}>
          {t(shape.type === 'segment' && <Group title={t("直线端点")} icon={Ruler} note={t("毫米 mm")}>
            <div className="grid grid-cols-2 gap-3">
              {t(([0, 1] as const).flatMap((index) => (['x', 'y'] as const).map((axis) => <NumberField key={`${index}-${axis}`} label={t(`${index === 0 ? '起点' : '终点'} ${axis.toUpperCase()}`)} value={shape.points[index][axis]} disabled={locked} onCommit={(value) => setProperty({ points: shape.points.map((p, i) => i === index ? { ...p, [axis]: value } : p) })} />)))}
              <NumberField label={t("直线长度")} value={metrics.perimeterMm} min={0.000001} disabled={locked} onCommit={(value) => onUpdateShape(resizeShapeEdge2D(shape, 0, value))} />
            </div>
            {t(referenceError && <p role="alert" className="mt-2 text-xs text-[#f0c577]">{t(referenceError)}</p>)}
          </Group>)}
          {t(!reference && <Group title={t("尺寸")} icon={Ruler} note={t("毫米 mm")}>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={t("宽度 X")} value={bounds.widthX} min={0.01} max={10000} disabled={locked} onCommit={(v) => onUpdateShape(resizeShape2D(shape, v, bounds.depthY))} />
              <NumberField label={t("深度 Y")} value={bounds.depthY} min={0.01} max={10000} disabled={locked} onCommit={(v) => onUpdateShape(resizeShape2D(shape, bounds.widthX, v))} />
              <NumberField label={t("拉伸高度 Z")} value={shape.zHeight} min={0.01} max={10000} disabled={locked} onCommit={(zHeight) => setProperty({ zHeight })} />
            </div>
          </Group>)}
          <Group title={t(shape.type === 'point' ? '点坐标' : '位置')} icon={Move} note={t(shape.type === 'point' ? '毫米 mm' : shape.type === 'segment' ? '整体移动' : '轮廓中心')}>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={t(shape.type === 'point' ? '点 X' : '中心 X')} value={centerX} disabled={locked} onCommit={(v) => onUpdateShape(translateShape2D(shape, v - centerX, 0))} />
              <NumberField label={t(shape.type === 'point' ? '点 Y' : '中心 Y')} value={centerY} disabled={locked} onCommit={(v) => onUpdateShape(translateShape2D(shape, 0, v - centerY))} />
              <NumberField label={t(shape.type === 'point' ? '点 Z' : shape.type === 'segment' ? '直线标高 Z' : '底面标高 Z')} value={shape.zOffset} disabled={locked} onCommit={(zOffset) => setProperty({ zOffset })} />
            </div>
          </Group>
          <Group title={t("外观")} icon={Palette}>
            {!reference && <><label className="block text-[11px] text-[var(--muted)] mb-1.5" htmlFor="inspector-material">{t("材质")}</label>
            <select id="inspector-material" aria-label={t("对象材质")} className={`${inputStyle} pr-1`} value={shape.materialPreset} disabled={locked} onChange={(e) => setProperty({ materialPreset: e.target.value as MaterialPresetId })}>{Object.values(MATERIAL_PRESETS).map((preset) => <option key={preset.id} value={preset.id}>{t(preset.name)}</option>)}</select></>}
            <div className="mt-4 mb-2 flex items-center justify-between"><span className="text-[11px] text-[var(--muted)]">{t("颜色")}</span><span style={mono} className="text-[10px] text-[var(--muted)]">{t(shape.color.toUpperCase())}</span></div>
            <div className="flex items-center gap-1.5">{t(colors.map((color) => <button key={color} type="button" aria-label={t(`对象颜色 ${color}`)} aria-pressed={shape.color.toLowerCase() === color.toLowerCase()} title={t(color)} disabled={locked} className="relative w-5 h-5 rounded-md border border-white/15 disabled:opacity-40" style={{ background: color, outline: shape.color.toLowerCase() === color.toLowerCase() ? '2px solid var(--blue)' : 'none', outlineOffset: 2 }} onClick={() => setProperty({ color })} />))}
              <label title={t("自定义颜色")} className="w-5 h-5 rounded-md border border-[var(--line)] overflow-hidden cursor-pointer"><input type="color" aria-label={t("自定义对象颜色")} disabled={locked} value={/^#[0-9a-f]{6}$/i.test(shape.color) ? shape.color : '#0066FF'} onChange={(e) => setProperty({ color: e.target.value })} className="w-7 h-7 -translate-x-1 -translate-y-1 cursor-pointer border-0 p-0 [color-scheme:dark]" /></label>
            </div>
          </Group>
          {t(!reference && <Group title={t("几何信息")} icon={Box}>
            <Metric label={t("体积")} value={metrics.volumeCm3} unit="cm³" />
            <Metric label={t("轮廓面积")} value={metrics.areaMm2} unit="mm²" />
            {t(material && <Metric label={t("估算质量")} value={metrics.weightGrams} unit="g" />)}
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">{t("质量根据当前几何与材质密度估算。")}</p>
          </Group>)}
        </React.Fragment> : <Group title={t("组合边界")} icon={Ruler} note={t("包含全部所选对象")}>
          <Metric label={t("宽度 X")} value={bounds.widthX} /><Metric label={t("深度 Y")} value={bounds.depthY} /><Metric label={t("高度 Z")} value={height} />
          <div className="mt-2 pt-2 border-t border-[var(--line)]"><Metric label={t("中心 X")} value={centerX} /><Metric label={t("中心 Y")} value={centerY} /></div>
        </Group>}
      </>}
    </div>
    {t(selected.length > 0 && <div className="shrink-0 grid grid-cols-2 gap-2 border-t border-[var(--line)] bg-[var(--paper)] p-3">
      <button type="button" onClick={onDuplicate} className="h-9 flex items-center justify-center gap-2 rounded-md border border-[var(--line)] text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]" aria-label={t("复制选中的对象")}><Copy className="w-3.5 h-3.5" />{t("复制")}</button>
      <button type="button" onClick={onDelete} className="h-9 flex items-center justify-center gap-2 rounded-md border border-[var(--line)] text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]" aria-label={t("删除选中的对象")}><Trash2 className="w-3.5 h-3.5" />{t("删除")}</button>
    </div>)}
  </aside>;
}
