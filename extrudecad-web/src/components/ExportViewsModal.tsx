import { t } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import {
  CadShape, exportToSVG, exportToDXF, exportShapesToOBJ,
  exportShapesToSTL, computeSceneMetrics,
} from '../utils/cadEngine';
import { Cad3DExporterApi, RenderedViewCapture } from './Cad3DViewport';
import { Download, FileCode, Box, Image as ImageIcon, X, CheckCircle2, Layers, AlertCircle } from 'lucide-react';

interface ExportViewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  shapes: CadShape[];
  exporterApi: Cad3DExporterApi | null;
}

type ExportTab = 'cad-files' | 'all-views' | 'sheet';

export const ExportViewsModal: React.FC<ExportViewsModalProps> = ({ isOpen, onClose, shapes, exporterApi }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [captures, setCaptures] = useState<RenderedViewCapture[]>([]);
  const [sheetPreviewUrl, setSheetPreviewUrl] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [activeTab, setActiveTab] = useState<ExportTab>('cad-files');
  const sceneMetrics = computeSceneMetrics(shapes);
  const hasShapes = sceneMetrics.visibleCount > 0;
  const solidCount = shapes.filter((shape) => shape.visible && shape.type !== 'point' && shape.type !== 'segment' && shape.points.length >= 3).length;
  const referenceCount = sceneMetrics.visibleCount - solidCount;

  useEffect(() => {
    if (!isOpen) return;
    setCaptures([]);
    setSheetPreviewUrl('');
    setStatusMessage(null);
    setExportError(null);
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []);
      if (!elements.length) { event.preventDefault(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      previous?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || activeTab === 'cad-files' || !hasShapes) return;
    setExportError(null);
    if (!exporterApi) {
      setExportError('三维预览尚未就绪。模型文件仍可正常导出。');
      return;
    }
    setIsRendering(true);
    const frame = window.requestAnimationFrame(() => {
      try {
        if (activeTab === 'all-views') {
          const views = exporterApi.captureAllStandardViews().filter((view) => Boolean(view.dataUrl));
          if (!views.length) throw new Error('三维视图暂不可用，请先确认三维预览正常显示。');
          setCaptures(views);
        } else {
          const sheet = exporterApi.generateEngineeringSheetPng();
          if (!sheet) throw new Error('无法生成工程图，请先确认三维预览正常显示。');
          setSheetPreviewUrl(sheet);
        }
      } catch (error) {
        setExportError(error instanceof Error ? error.message : '生成预览失败，请重新尝试。');
      } finally {
        setIsRendering(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, activeTab, exporterApi, shapes, hasShapes]);

  if (!isOpen) return null;

  const download = (href: string, filename: string) => {
    if (!hasShapes || !href) {
      setExportError(!hasShapes ? '请先添加或显示一个构件，再导出。' : '导出内容尚未就绪。');
      return;
    }
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setExportError(null);
    setStatusMessage(`已准备下载 ${filename}`);
  };

  const downloadModel = (format: 'STL' | 'OBJ' | 'DXF' | 'SVG') => {
    if (!hasShapes) return;
    if ((format === 'STL' || format === 'OBJ') && !solidCount) return;
    try {
      const contents = { STL: exportShapesToSTL, OBJ: exportShapesToOBJ, DXF: exportToDXF, SVG: exportToSVG }[format](shapes);
      const mime = { STL: 'model/stl', OBJ: 'text/plain', DXF: 'application/dxf', SVG: 'image/svg+xml' }[format];
      const url = URL.createObjectURL(new Blob([contents], { type: mime }));
      download(url, `ExtrudeCAD-Model.${format.toLowerCase()}`);
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败，请检查模型后重试。');
    }
  };

  const formats = [
    { id: 'STL' as const, icon: Box, label: '三维打印网格', detail: '适合切片软件。保留模型的拉伸、孔洞和倒角。', note: '.stl · 三角网格' },
    { id: 'OBJ' as const, icon: Layers, label: '三维模型', detail: '适合在 Blender 等三维工具中继续编辑或渲染。', note: '.obj · Wavefront' },
    { id: 'DXF' as const, icon: FileCode, label: 'CAD 交换图纸', detail: '定位点为 POINT、草图直线为 LINE；闭合轮廓保留标高与拉伸厚度。', note: '.dxf · 毫米坐标' },
    { id: 'SVG' as const, icon: ImageIcon, label: '矢量草图', detail: '清晰的二维工程轮廓，适合报告、排版与打印。', note: '.svg · 矢量图' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="export-modal-title" tabIndex={-1} className="text-[var(--ink)] [color-scheme:dark] w-full max-w-5xl max-h-[90dvh] flex flex-col bg-[var(--paper)] border border-[var(--line)] rounded-md shadow-2xl overflow-hidden outline-none">
        <header className="flex items-start justify-between gap-4 px-5 sm:px-7 py-5 border-b border-[var(--line)]">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-[var(--blue)] mb-1.5">EXPORT STUDIO</p>
            <h2 id="export-modal-title" className="text-xl font-semibold text-[var(--ink)]">{t("导出你的设计")}</h2>
            <p className="text-xs text-[var(--muted)] mt-2">{t(sceneMetrics.visibleCount)}{" " + t("个可见对象") + " "}<span className="mx-2 text-[var(--muted)]">/</span> {t(sceneMetrics.bounds.widthX)} × {t(sceneMetrics.bounds.depthY)} × {t(sceneMetrics.bounds.heightZ)} mm</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("关闭导出窗口")} className="p-2 rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"><X className="w-5 h-5" /></button>
        </header>
        <div role="tablist" aria-label={t("导出类型")} className="flex gap-1 px-5 sm:px-7 pt-4">
          {t(([{ id: 'cad-files', label: '模型文件' }, { id: 'all-views', label: '视图截图' }, { id: 'sheet', label: '工程图纸' }] as const).map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 text-xs font-medium rounded-md transition-colors ${activeTab === tab.id ? 'bg-[var(--selection)] text-[var(--blue)]' : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]'}`}>{t(tab.label)}</button>
          )))}
        </div>
        {t((statusMessage || exportError || !hasShapes) && <div role={exportError || !hasShapes ? 'alert' : 'status'} className={`mx-5 sm:mx-7 mt-4 flex items-center gap-2 rounded-md border px-3 py-2.5 text-xs ${exportError || !hasShapes ? 'bg-[var(--surface)] text-[#EBCB8B] border-[#8A7348]' : 'bg-[var(--selection)] text-[var(--ink)] border-[var(--selection-border)]'}`}>
          {t(exportError || !hasShapes ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />)}
          {t(exportError || (!hasShapes ? '当前没有可导出的构件。添加图形或显示已有构件后再试。' : statusMessage))}
        </div>)}
        <div role="tabpanel" className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-7">
          {t(activeTab === 'cad-files' && referenceCount > 0 && <p className="mb-3 text-xs text-[var(--muted)]">{t(referenceCount)}{" " + t("个定位点／草图线可导出为 DXF、SVG。")}{t(solidCount ? `STL、OBJ 仅导出 ${solidCount} 个实体。` : 'STL、OBJ 需要闭合面拉伸的实体。')}</p>)}
          {t(activeTab === 'cad-files' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{t(formats.map(({ id, icon: Icon, label, detail, note }) => (
            <div key={id} className="flex flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between"><Icon className="w-6 h-6 text-[var(--blue)]" /><span className="text-xs text-[var(--muted)] font-mono">{t(id)}</span></div>
              <h3 className="text-sm font-semibold text-[var(--ink)] mt-5">{t(label)}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed mt-2 min-h-10">{t(detail)}</p>
              <div className="flex items-center justify-between gap-2 mt-5"><span className="text-[10px] text-[var(--muted)]">{t(note)}</span><button type="button" disabled={!hasShapes || ((id === 'STL' || id === 'OBJ') && !solidCount)} onClick={() => downloadModel(id)} className="inline-flex items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--blue)_65%,#000)] px-3 py-2 text-xs font-semibold text-white hover:bg-[color-mix(in_srgb,var(--blue)_75%,#000)] disabled:opacity-30 disabled:cursor-not-allowed"><Download className="w-3.5 h-3.5" />{t("导出") + " "}{t(id)}</button></div>
            </div>
          )))}</div>)}
          {t(activeTab !== 'cad-files' && isRendering && <div role="status" className="py-12 text-center text-sm text-[var(--muted)]">{t("正在生成预览…")}</div>)}
          {t(activeTab === 'all-views' && !isRendering && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{t(captures.map((capture) => (
            <div key={capture.id} className="rounded-md border border-[var(--line)] overflow-hidden bg-[var(--surface)]">
              <img src={capture.dataUrl} alt={capture.label} className="w-full aspect-[4/3] object-contain" />
              <div className="p-3 flex items-center justify-between gap-2"><span className="text-xs text-[var(--muted)]">{t(capture.label)}</span><button type="button" aria-label={t(`下载${capture.label}`)} onClick={() => download(capture.dataUrl, `ExtrudeCAD-View-${capture.id}.png`)} className="p-2 rounded-md text-[var(--blue)] hover:bg-[var(--hover)]"><Download className="w-4 h-4" /></button></div>
            </div>
          )))}</div>)}
          {t(activeTab === 'sheet' && !isRendering && sheetPreviewUrl && <div className="space-y-4">
            <img src={sheetPreviewUrl} alt="全视图工程图纸预览" className="w-full h-auto rounded-md border border-[var(--line)] bg-white" />
            <button type="button" onClick={() => download(sheetPreviewUrl, 'ExtrudeCAD-Engineering-Sheet.png')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-[color-mix(in_srgb,var(--blue)_65%,#000)] hover:bg-[color-mix(in_srgb,var(--blue)_75%,#000)] text-white text-xs font-semibold"><Download className="w-4 h-4" />{t("下载工程图 PNG")}</button>
          </div>)}
        </div>
        <footer className="px-5 sm:px-7 py-3 border-t border-[var(--line)] text-[11px] text-[var(--muted)] flex items-center justify-between gap-3"><span>{t("仅导出可见构件 · 模型尺寸单位为 mm")}</span><span>{t("ESC 关闭")}</span></footer>
      </div>
    </div>
  );
};
