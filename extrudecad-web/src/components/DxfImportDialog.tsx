import { t } from '../i18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileInput, X } from 'lucide-react';
import { CadShape } from '../utils/cadEngine';
import { DxfImportUnits, parseDxf } from '../utils/dxfImport';

interface DxfImportDialogProps {
  file: { name: string; text: string } | null;
  onClose: () => void;
  onImport: (shapes: CadShape[]) => void;
}

const inputClass = 'h-9 w-full rounded border border-[var(--line)] bg-[var(--input)] px-2.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--blue)]';

export function DxfImportDialog({ file, onClose, onImport }: DxfImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [units, setUnits] = useState<DxfImportUnits>('auto');
  const [heightDraft, setHeightDraft] = useState('30');
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!file) return;
    setUnits('auto');
    setHeightDraft('30');
    setSubmitError('');
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [file]);

  const parsed = useMemo(() => {
    if (!file) return { result: null, error: '' };
    const height = Number(heightDraft);
    if (!heightDraft.trim() || !Number.isFinite(height) || height <= 0) {
      return { result: null, error: '请输入大于零的默认拉伸高度。' };
    }
    try {
      return { result: parseDxf(file.text, { units, defaultHeightMm: height }), error: '' };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '无法读取这个 DXF 文件。' };
    }
  }, [file, units, heightDraft]);

  if (!file) return null;
  const result = parsed.result;
  const skipped = result ? Object.entries(result.skippedEntities).filter(([, count]) => count > 0) : [];
  const skippedCount = skipped.reduce((sum, [, count]) => sum + count, 0);
  const canImport = Boolean(result?.shapes.length);
  const importShapes = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canImport || !result) return;
    try {
      onImport(result.shapes);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '导入未完成，请检查文件后重试。');
    }
  };

  return <dialog ref={dialogRef} aria-labelledby="dxf-import-title" aria-describedby="dxf-import-scope"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    className="fixed inset-0 m-auto w-[560px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-2xl outline-none [color-scheme:dark] backdrop:bg-black/65 backdrop:backdrop-blur-sm">
    <form onSubmit={importShapes} className="flex max-h-[calc(100dvh-24px)] flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div className="min-w-0"><h2 id="dxf-import-title" className="flex items-center gap-2 text-base font-semibold"><FileInput className="h-4 w-4 text-[var(--blue)]" />{t("导入 DXF 图元")}</h2><p className="mt-1.5 truncate text-xs text-[var(--muted)]" title={file.name}>{file.name}</p></div>
        <button type="button" autoFocus onClick={onClose} aria-label={t("关闭 DXF 导入窗口")} className="shrink-0 rounded p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">{t("文件单位") + " "}<select aria-label={t("DXF 导入单位")} value={units} onChange={(event) => { setUnits(event.target.value as DxfImportUnits); setSubmitError(''); }} className={inputClass}>
              <option value="auto">{t("自动识别文件单位")}</option><option value="mm">{t("毫米 (mm)")}</option><option value="cm">{t("厘米 (cm)")}</option><option value="m">{t("米 (m)")}</option><option value="in">{t("英寸 (in)")}</option><option value="ft">{t("英尺 (ft)")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">{t("闭合轮廓默认高度 (mm)") + " "}<input aria-label={t("DXF 默认拉伸高度")} type="number" required step="any" value={heightDraft} onChange={(event) => { setHeightDraft(event.target.value); setSubmitError(''); }} className={inputClass} />
          </label>
        </div>
        {t(units === 'auto' && <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">{t("文件未声明单位时，请手动选择单位后继续。")}</p>)}
        {t((parsed.error || submitError) && <div role="alert" className="mt-4 flex items-start gap-2 rounded border border-[#8a7348] bg-[var(--surface)] px-3 py-2.5 text-xs leading-relaxed text-[#ebcb8b]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t(submitError || parsed.error)}</span></div>)}
        {t(result && <>
          <dl className="mt-4 grid grid-cols-3 gap-2 rounded border border-[var(--line)] bg-[var(--input)] p-3 text-xs">
            <div><dt className="text-[var(--muted)]">{t("可导入对象")}</dt><dd className="mt-1.5 text-lg tabular-nums">{t(result.shapes.length)}</dd></div>
            <div><dt className="text-[var(--muted)]">{t("将跳过实体")}</dt><dd className="mt-1.5 text-lg tabular-nums">{t(skippedCount)}</dd></div>
            <div><dt className="text-[var(--muted)]">{t("采用单位")}</dt><dd className="mt-2 break-words">{t(result.unitLabel)}</dd><dd className="mt-1 text-[10px] text-[var(--muted)]">{t("1 单位 =") + " "}{t(result.unitScaleMm)} mm</dd></div>
          </dl>
          {t(result.shapes.length === 0 && <p role="status" className="mt-3 text-xs leading-relaxed text-[#ebcb8b]">{t("未找到可导入的点、直线或闭合轮廓。请检查 DXF 中的实体类型。")}</p>)}
          {t(result.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">{t(result.warnings.map((warning, index) => <li key={index}>{t(warning)}</li>))}</ul>)}
        </>)}
        <p id="dxf-import-scope" className="mt-4 border-t border-[var(--line)] pt-3 text-[11px] leading-relaxed text-[var(--muted)]">{t("支持 ASCII DXF 的定位点（POINT）、同标高直线（LINE）、闭合直线多段线（LWPOLYLINE）和圆（CIRCLE）。点线保留为无厚度草图对象；默认高度仅用于闭合轮廓。外部闭合轮廓各自拉伸；ExtrudeCAD 导出的轮廓可恢复单个内孔。不支持 DWG、STEP。")}</p>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-4">
        <span className="text-[11px] text-[var(--muted)]">{t("追加到当前工程 · 可撤销")}</span>
        <div className="flex gap-2"><button type="button" onClick={onClose} className="h-9 rounded border border-[var(--line)] px-3 text-xs text-[var(--muted)] hover:bg-[var(--hover)]">{t("取消")}</button><button type="submit" disabled={!canImport} data-testid="dxf-import-confirm" className="h-9 rounded border border-[var(--selection-border)] bg-[#287acb] px-4 text-xs font-medium text-white hover:bg-[#328ae0] disabled:cursor-not-allowed disabled:opacity-35">{t(skippedCount > 0 ? `跳过 ${skippedCount} 项并导入 ${result?.shapes.length ?? 0} 个对象` : `导入 ${result?.shapes.length ?? 0} 个对象`)}</button></div>
      </footer>
    </form>
  </dialog>;
}
