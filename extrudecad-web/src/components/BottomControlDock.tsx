import { t } from '../i18n';
import React, { useState, useEffect, useMemo } from 'react';
import {
  CadShape,
  PrimitivePresetType,
  BooleanOperationType,
  BooleanOperationResult,
  computeBounds2D,
  computeShapeDimensions,
  resizeShape2D,
  resizeShapeEdge2D,
  resizeLineWall2D,
  resizeCircleDiameter2D,
  translateShape2D,
  arePolygonsOverlapping2D,
  alignShapes2D,
  AlignMode,
  ALIGN_MODE_LABELS,
} from '../utils/cadEngine';
import { DrawTool2D } from './Cad2DCanvas';
import { PrecisionPrimitiveSpec } from '../utils/precisionPrimitives';
import { PrecisionTransform, getSelectionPivot } from '../utils/precisionTransforms';
import {
  MousePointer,
  Minus,
  Square,
  Triangle,
  Circle,
  PenTool,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  FilePlus2,
  RotateCcw,
  CheckSquare,
  Combine,
  ChevronDown,
  ArrowLeftRight,
  Layers,
  Scissors,
  FlipHorizontal2,
  LayoutGrid,
  RotateCw,
  X,
  SlidersHorizontal,
  Box,
  Plus,
  Check,
  Ruler,
  Move,
  Scaling,
  Crosshair,
} from 'lucide-react';

interface BottomControlDockProps {
  shapes: CadShape[];
  selectedId: string | null;
  selectedIds: string[];
  onSelectShape: (id: string | null) => void;
  onSelectMultipleShapes: (ids: string[]) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onUpdateShape: (updated: CadShape) => void;
  onUpdateMultipleShapes: (nextShapes: CadShape[]) => void;
  onDeleteShape: (id?: string) => void;
  onDuplicateShape: (id?: string) => void;
  onAddPrimitive: (preset: PrimitivePresetType) => void;
  onCreatePrecisionPrimitive: (spec: PrecisionPrimitiveSpec) => boolean;
  onTransformSelection: (operation: PrecisionTransform) => boolean;
  panelRequest?: { panel: 'create' | 'properties' | 'boolean' | 'transform'; mode?: 'move' | 'rotate' | 'scale'; nonce: number };
  onBooleanOperation: (
    op: BooleanOperationType,
    customTargetId?: string,
    customToolId?: string,
  ) => BooleanOperationResult;
  onBooleanPreview: (
    op: BooleanOperationType,
    targetId: string,
    toolId: string,
  ) => boolean;
  booleanPreviewActive: boolean;
  onCommitBooleanPreview: () => void;
  onCancelBooleanPreview: () => void;
  onRestoreBoolean: (resultId: string) => void;
  onMirrorShapes: (axis: 'x' | 'y', asCopy: boolean) => void;
  onRectArray: (rows: number, cols: number, gapX: number, gapY: number) => void;
  onPolarArray: (
    count: number,
    totalAngleDeg: number,
    centerX: number,
    centerY: number,
  ) => void;
  booleanFeedback: { ok: boolean; message: string } | null;
  onClearBooleanFeedback: () => void;
  onNewEmptyModel: () => void;
  onResetDemo: () => void;
  activeTool: DrawTool2D;
  drawingActive?: boolean;
  canConnectPoints: boolean;
  onConnectPoints: () => void;
  onChangeTool: (tool: DrawTool2D) => void;
  defaultZHeight: number;
  onChangeDefaultZHeight: (val: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  onUndo: () => void;
  onRedo: () => void;
}

const DRAW_TOOLS: {
  id: DrawTool2D;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'select', label: '选择', icon: MousePointer },
  { id: 'point', label: '点', icon: Crosshair },
  { id: 'line', label: '点线', icon: Minus },
  { id: 'rect', label: '矩形', icon: Square },
  { id: 'triangle', label: '三角', icon: Triangle },
  { id: 'circle', label: '圆形', icon: Circle },
  { id: 'polyline', label: '多边形', icon: PenTool },
  { id: 'measure', label: '测量', icon: Ruler },
];

const DRAW_TOOL_HINTS: Record<DrawTool2D, string> = {
  select: '选择 V · 单击或框选 · 再点蓝夹点编辑 · Enter / 空格重复绘图',
  point: '定位点 · 单击或输入 x,y 放置独立点 · Ctrl 单击选中两个点后连接',
  line: '点线一体 L · 单击或输入坐标连续连线 · 待起点时空Enter续画 · 移动点联动直线',
  rect: '矩形 R · 单击两个对角点',
  triangle: '三角形 · 两角点定义宽、高',
  circle: '圆形 C · 点击圆心、半径点 · D↵切换直径',
  polyline: '多边形 P · 逐点绘制闭合面 · 至少 3 点 · C↵ / Enter 完成',
  measure: '测量 DI↵ · 两点 XY 距离与角度',
};

const QUICK_PRIMITIVES: { id: PrimitivePresetType; label: string }[] = [
  { id: 'box', label: '+方块' },
  { id: 'triangle', label: '+三角' },
  { id: 'cylinder', label: '+圆柱' },
  { id: 'line', label: '+直线墙' },
];

const SWATCH_COLORS = [
  '#38bdf8',
  '#10b981',
  '#f59e0b',
  '#818cf8',
  '#f43f5e',
  '#94a3b8',
];

function DockNumberField({ label, value, onCommit, min, max, step, className, disabled = false }: {
  label: string; value: number; onCommit: (value: number) => void;
  min: number; max: number; step: number; className: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(String(value)); setDirty(false); }, [value]);
  const commit = () => {
    if (!dirty) return;
    setDirty(false);
    const next = Number(draft);
    setDraft(String(value));
    if (draft.trim() && Number.isFinite(next) && next >= min && next <= max) onCommit(next);
  };
  return <label className="flex items-center gap-2 text-xs text-[var(--muted)] whitespace-nowrap">
    {t(label)}<input type="number" aria-label={t(label)} value={draft} min={min} max={max} step={step} disabled={disabled}
      className={className} onChange={(event) => { setDraft(event.target.value); setDirty(true); }} onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') { event.preventDefault(); setDraft(String(value)); setDirty(false); }
      }} />
  </label>;
}

export const BottomControlDock: React.FC<BottomControlDockProps> = ({
  shapes,
  selectedId,
  selectedIds,
  onSelectShape,
  onSelectMultipleShapes,
  onSelectAll,
  onClearSelection,
  onUpdateShape,
  onUpdateMultipleShapes,
  onDeleteShape,
  onDuplicateShape,
  onAddPrimitive,
  onCreatePrecisionPrimitive,
  onTransformSelection,
  panelRequest,
  onBooleanOperation,
  onBooleanPreview,
  booleanPreviewActive,
  onCommitBooleanPreview,
  onCancelBooleanPreview,
  onRestoreBoolean,
  onMirrorShapes,
  onRectArray,
  onPolarArray,
  booleanFeedback,
  onClearBooleanFeedback,
  onNewEmptyModel,
  onResetDemo,
  activeTool,
  drawingActive = false,
  canConnectPoints,
  onConnectPoints,
  onChangeTool,
  defaultZHeight,
  onChangeDefaultZHeight,
  canUndo,
  canRedo,
  undoCount,
  redoCount,
  onUndo,
  onRedo,
}) => {
  const [panel, setPanel] = useState<'create' | 'properties' | 'boolean' | 'transform' | null>(null);
  useEffect(() => {
    if (!panel) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); setPanel(null); } };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [panel]);
  useEffect(() => { if (panelRequest) { setPanel(panelRequest.panel); if (panelRequest.mode) setTransformMode(panelRequest.mode); } }, [panelRequest]);
  useEffect(() => { if (drawingActive) setPanel(null); }, [drawingActive]);
  const togglePanel = (next: typeof panel) => setPanel((current) => current === next ? null : next);
  const [primitiveKind, setPrimitiveKind] = useState<PrecisionPrimitiveSpec['kind']>('box');
  const [lastPrimitiveSpec, setLastPrimitiveSpec] = useState<PrecisionPrimitiveSpec | null>(null);
  const primitiveDefaults: PrecisionPrimitiveSpec = lastPrimitiveSpec ?? {
    kind: 'box', centerX: 0, centerY: 0, zOffset: 0,
    width: 40, depth: 40, diameter: 40, zHeight: defaultZHeight,
  };
  const [transformMode, setTransformMode] = useState<'move' | 'rotate' | 'scale'>('move');
  const [customPivot, setCustomPivot] = useState(false);
  const [boolTargetId, setBoolTargetId] = useState<string>('');
  const [boolToolId, setBoolToolId] = useState<string>('');
  const [alignMode, setAlignMode] = useState<AlignMode>('centerX');
  // 镜像/阵列面板状态
  const [mirrorAxis, setMirrorAxis] = useState<'x' | 'y'>('x');
  const [arrayCols, setArrayCols] = useState<number>(3);
  const [arrayRows, setArrayRows] = useState<number>(2);
  const [arrayGapX, setArrayGapX] = useState<number>(5);
  const [arrayGapY, setArrayGapY] = useState<number>(5);
  const [polarCount, setPolarCount] = useState<number>(6);
  const [polarAngle, setPolarAngle] = useState<number>(360);
  const [polarCx, setPolarCx] = useState<number>(0);
  const [polarCy, setPolarCy] = useState<number>(0);

  // Keep Boolean Target A and Tool B synced with canvas selection
  useEffect(() => {
    const visibleShapes = shapes.filter((s) => s.visible && s.type !== 'point' && s.type !== 'segment');
    if (visibleShapes.length === 0) {
      setBoolTargetId('');
      setBoolToolId('');
      return;
    }

    const nextTarget =
      selectedIds[0] && visibleShapes.some((s) => s.id === selectedIds[0])
        ? selectedIds[0]
        : visibleShapes[0].id;

    const nextTool =
      selectedIds[1] &&
      selectedIds[1] !== nextTarget &&
      visibleShapes.some((s) => s.id === selectedIds[1])
        ? selectedIds[1]
        : visibleShapes.find((s) => s.id !== nextTarget)?.id ?? '';

    setBoolTargetId(nextTarget);
    setBoolToolId(nextTool);
  }, [shapes, selectedIds]);

  const selectedShape =
    shapes.find((s) => s.id === selectedId) ?? null;
  const selectedBounds = selectedShape
    ? computeBounds2D(selectedShape.points)
    : null;
  const selectedDimensions = useMemo(() => selectedShape ? computeShapeDimensions(selectedShape) : null, [selectedShape]);
  const [activeEdgeIdx, setActiveEdgeIdx] = useState<number>(0);
  const [edgeLenInput, setEdgeLenInput] = useState<string>('');
  const [syncOppositeRect, setSyncOppositeRect] = useState<boolean>(false);

  // Sync activeEdgeIdx and edgeLenInput when selectedShape or its points change
  useEffect(() => {
    if (!selectedDimensions || selectedDimensions.edges.length === 0) {
      setActiveEdgeIdx(0);
      setEdgeLenInput('');
      return;
    }
    const safeIdx =
      activeEdgeIdx < selectedDimensions.edges.length ? activeEdgeIdx : 0;
    if (safeIdx !== activeEdgeIdx) {
      setActiveEdgeIdx(safeIdx);
    }
    const edgeObj = selectedDimensions.edges[safeIdx];
    if (edgeObj) {
      setEdgeLenInput(String(edgeObj.lengthMm));
    }
  }, [selectedShape, selectedDimensions, activeEdgeIdx]);

  const isMultiSelected = selectedIds.length > 1;
  const hasSelection = selectedIds.length > 0;
  const visibleShapes = shapes.filter((s) => s.visible);
  const booleanShapes = visibleShapes.filter((s) => s.type !== 'point' && s.type !== 'segment');
  const selectedReference = selectedShape?.type === 'point' || selectedShape?.type === 'segment';
  const editableSelection = shapes.filter((s) => selectedIds.includes(s.id) && s.visible && !s.locked);
  const selectionPivot = getSelectionPivot(shapes, selectedIds);
  const allSelected = visibleShapes.length > 0 && visibleShapes.every((s) => selectedIds.includes(s.id));

  const handleApplyAlign = () => {
    if (!isMultiSelected) return;
    onUpdateMultipleShapes(alignShapes2D(shapes, selectedIds, alignMode));
  };

  const shapeA = shapes.find((s) => s.id === boolTargetId) ?? null;
  const shapeB = shapes.find((s) => s.id === boolToolId) ?? null;
  const canRunBoolean = Boolean(shapeA && shapeB && shapeA.id !== shapeB.id && !shapeA.locked && !shapeB.locked);
  const areABOverlapping =
    shapeA && shapeB
      ? arePolygonsOverlapping2D(shapeA.points, shapeB.points)
      : false;

  const handleSwapAB = () => {
    if (!boolTargetId || !boolToolId) return;
    const prevA = boolTargetId;
    const prevB = boolToolId;
    setBoolTargetId(prevB);
    setBoolToolId(prevA);
    onSelectMultipleShapes([prevB, prevA]);
  };

  const applyZHeightToSelection = (newZ: number) => {
    if (!Number.isFinite(newZ) || newZ < 0.01 || newZ > 10000) return;
    onChangeDefaultZHeight(newZ);
    if (selectedIds.length > 1) {
      const idSet = new Set(selectedIds);
      onUpdateMultipleShapes(
        shapes.map((s) => (idSet.has(s.id) && s.visible && !s.locked && s.type !== 'point' && s.type !== 'segment' ? { ...s, zHeight: newZ } : s)),
      );
    } else if (selectedShape && !selectedShape.locked && !selectedReference) {
      onUpdateShape({ ...selectedShape, zHeight: newZ });
    }
  };

  const applyColorToSelection = (hex: string) => {
    if (selectedIds.length > 1) {
      const idSet = new Set(selectedIds);
      onUpdateMultipleShapes(
        shapes.map((s) => (idSet.has(s.id) && s.visible && !s.locked ? { ...s, color: hex } : s)),
      );
    } else if (selectedShape && !selectedShape.locked) {
      onUpdateShape({ ...selectedShape, color: hex });
    }
  };

  const commandClass = 'flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[var(--blue)]';
  const neutral = `${commandClass} text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]`;
  const primary = `${commandClass} bg-[color-mix(in_srgb,var(--blue)_65%,#000)] text-white border border-[var(--selection-border)] hover:bg-[color-mix(in_srgb,var(--blue)_75%,#000)]`;
  const inputClass = '[color-scheme:dark] h-8 rounded-[4px] border border-[var(--line)] bg-[var(--input)] px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--blue)] tabular-nums';
  const groupClass = 'flex items-center gap-0.5 pr-1.5 mr-1 border-r border-[var(--line)] shrink-0';
  const closePanel = () => setPanel(null);
  const numberField = (label: string, value: number, onChange: (v: number) => void, min = -10000, max = 10000, step = 1, disabled = false) => (
    <DockNumberField key={`${selectedId ?? 'scene'}:${label}`} label={t(label)} value={value} onCommit={onChange}
      min={min} max={max} step={step} disabled={disabled} className={`${inputClass} w-[72px] disabled:opacity-40`} />
  );
  const formField = (label: string, name: string, value: number, min?: number, max?: number) => (
    <label key={name} className="flex min-w-0 flex-col gap-1.5 text-[11px] text-[var(--muted)]">
      {t(label)}<input name={name} aria-label={t(label)} type="number" required min={min} max={max} step="any" defaultValue={value}
        className={`${inputClass} w-full min-w-0`} />
    </label>
  );
  const handlePrecisionCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    const spec: PrecisionPrimitiveSpec = {
      kind: primitiveKind,
      centerX: number('centerX'), centerY: number('centerY'), zOffset: number('zOffset'),
      width: primitiveKind === 'box' ? number('width') : primitiveDefaults.width,
      depth: primitiveKind === 'box' ? number('depth') : primitiveDefaults.depth,
      diameter: primitiveKind === 'cylinder' ? number('diameter') : primitiveDefaults.diameter,
      zHeight: number('zHeight'),
    };
    if (onCreatePrecisionPrimitive(spec)) {
      setLastPrimitiveSpec(spec);
      closePanel();
    }
  };
  const handlePrecisionTransform = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    const copy = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'copy';
    let applied = false;
    if (transformMode === 'move') applied = onTransformSelection({ kind: 'move', dx: number('dx'), dy: number('dy'), dz: number('dz'), copy });
    if (transformMode === 'rotate') applied = onTransformSelection({ kind: 'rotate', angleDeg: number('angle'), copy,
      ...(customPivot ? { pivot: { x: number('pivotX'), y: number('pivotY') } } : {}) });
    if (transformMode === 'scale') applied = onTransformSelection({ kind: 'scale', factor: number('factor'), copy,
      ...(customPivot ? { pivot: { x: number('pivotX'), y: number('pivotY'), z: number('pivotZ') } } : {}) });
    if (applied) closePanel();
  };
  const setBooleanOperand = (which: 'a' | 'b', id: string) => {
    const a = which === 'a' ? id : boolTargetId;
    const b = which === 'b' ? id : boolToolId === id ? booleanShapes.find((s) => s.id !== id)?.id ?? '' : boolToolId;
    setBoolTargetId(a);
    setBoolToolId(b);
    onSelectMultipleShapes([a, b].filter(Boolean));
  };

  return (
    <section aria-label={t("CAD绘图工具栏")} className="relative max-w-full text-[var(--ink)] pointer-events-auto">
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 flex w-[660px] max-w-[min(calc(100cqw-24px),calc(100vw-24px))] flex-col gap-2">
      {panel && (
        <div id="cad-command-panel" className="max-h-[min(460px,58vh)] overflow-auto rounded-md border border-[var(--line)] bg-[var(--paper)] p-4 shadow-[0_8px_28px_rgba(0,0,0,0.28)]" role="region" aria-label={t(panel === 'create' ? '添加与工程面板' : panel === 'properties' ? '精细编辑面板' : panel === 'boolean' ? 'CAD布尔运算面板' : '变换与阵列面板')}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="w-1 h-3 rounded-full bg-[var(--blue)]" /><h2 className="text-xs font-semibold tracking-wide">{t(panel === 'create' ? '添加几何体' : panel === 'properties' ? '精细编辑' : panel === 'boolean' ? '布尔组合' : '变换与阵列')}</h2><span className="text-[11px] text-[var(--muted)]">{t(panel === 'create' ? '尺寸以 mm 为单位' : panel === 'properties' ? '尺寸以 mm 为单位' : panel === 'boolean' ? '先预览，再应用' : `${editableSelection.length} 个可编辑对象`)}</span></div>
            <button type="button" className={neutral} aria-label={t("收起编辑面板")} onClick={closePanel}><X className="w-4 h-4" /></button>
          </div>

          {t(panel === 'create' && <div>
            <div className="grid grid-cols-4 gap-2">{t(QUICK_PRIMITIVES.map(({ id, label }) => <button key={id} type="button" onClick={() => onAddPrimitive(id)} className="flex items-center justify-center gap-2 rounded-[4px] border border-[var(--line)] bg-[var(--input)] px-2 py-2 text-xs text-[var(--ink)] transition-colors hover:border-[var(--blue)] hover:bg-[var(--selection)]" aria-label={t(`添加${label.slice(1)}`)}>{t(id === 'box' ? <Box className="h-4 w-4 shrink-0 text-[var(--muted)]" /> : id === 'cylinder' ? <Circle className="h-4 w-4 shrink-0 text-[var(--muted)]" /> : id === 'triangle' ? <Triangle className="h-4 w-4 shrink-0 text-[var(--muted)]" /> : <Minus className="h-4 w-4 shrink-0 text-[var(--muted)]" />)}{t(label.slice(1))}</button>))}</div>
            <form onSubmit={handlePrecisionCreate} className="mt-4 space-y-3 border-t border-[var(--line)] pt-3" aria-label={t("按尺寸创建几何体")}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-medium">{t("按尺寸创建")}</h3><select aria-label={t("精确创建类型")} value={primitiveKind} onChange={(event) => setPrimitiveKind(event.target.value as PrecisionPrimitiveSpec['kind'])} className={inputClass}><option value="box">{t("长方体")}</option><option value="cylinder">{t("圆柱体")}</option></select></div>
              <div className="grid grid-cols-3 gap-3">
                {t(formField('创建中心 X', 'centerX', primitiveDefaults.centerX, -100000, 100000))}
                {t(formField('创建中心 Y', 'centerY', primitiveDefaults.centerY, -100000, 100000))}
                {t(formField('创建底面 Z', 'zOffset', primitiveDefaults.zOffset, -100000, 100000))}
                {t(primitiveKind === 'box' ? <>{t(formField('创建宽度 X', 'width', primitiveDefaults.width, 0.01, 10000))}{t(formField('创建深度 Y', 'depth', primitiveDefaults.depth, 0.01, 10000))}</> : formField('创建直径', 'diameter', primitiveDefaults.diameter, 0.01, 10000))}
                {t(formField('创建拉伸高度 Z', 'zHeight', primitiveDefaults.zHeight, 0.01, 10000))}
              </div>
              <div className="flex items-center justify-between gap-3"><span className="text-[11px] text-[var(--muted)]">{t("中心定位 · 直边拉伸")}</span><button type="submit" data-testid="precision-create-btn" className={primary}><Plus className="h-4 w-4" />{t("创建")}{t(primitiveKind === 'box' ? '长方体' : '圆柱体')}</button></div>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3"><button type="button" className={neutral} onClick={onNewEmptyModel}><FilePlus2 className="h-4 w-4" />{t("新建空白模型")}</button><button type="button" className={neutral} onClick={onResetDemo}><RotateCcw className="h-4 w-4" />{t("载入示例")}</button>{t(numberField('默认拉伸高度', defaultZHeight, onChangeDefaultZHeight, 1, 300))}</div>
          </div>)}

          {panel === 'properties' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-[var(--muted)] flex items-center gap-2">{t("当前图形") + " "}<select aria-label={t("切换当前编辑图形")} className={`${inputClass} max-w-[220px]`} value={selectedShape?.id ?? ''} onChange={(e) => onSelectShape(e.target.value || null)}>
                    <option value="">{t("选择一个图形")}</option>{shapes.map((s) => <option key={s.id} value={s.id}>{s.name}{t(!s.visible ? ' · 已隐藏' : '')}</option>)}
                  </select>
                </label>
                {t(isMultiSelected && <span className="text-xs text-[var(--blue)]">{t("已选") + " "}{t(selectedIds.length)}{" " + t("个 · 仅编辑未锁定可见对象；高度仅作用于实体")}</span>)}
                {t(isMultiSelected && <div className="flex items-center gap-2" data-testid="assembly-align-panel"><select aria-label={t("选择对齐方式")} value={alignMode} onChange={(e) => setAlignMode(e.target.value as AlignMode)} className={inputClass}>{t((Object.keys(ALIGN_MODE_LABELS) as AlignMode[]).map((mode) => <option key={mode} value={mode}>{t(ALIGN_MODE_LABELS[mode])}</option>))}</select><button type="button" data-testid="apply-align-btn" disabled={editableSelection.length < 2} onClick={handleApplyAlign} className={primary}>{t("对齐到首个")}</button></div>)}
              </div>
              {t(selectedShape && selectedBounds && selectedDimensions ? (
                <fieldset disabled={editableSelection.length === 0} className="min-w-0 space-y-3 disabled:opacity-50">
                  {t(selectedShape.locked && <p className="text-[11px] text-[var(--muted)]">{t("当前对象已锁定；请在构件树解锁后编辑。")}</p>)}
                  <div className="flex items-center flex-wrap gap-x-5 gap-y-3">
                    {t(selectedReference ? <>
                      {t(numberField('坐标 X', (selectedBounds.minX + selectedBounds.maxX) / 2, (v) => onUpdateShape(translateShape2D(selectedShape, v - (selectedBounds.minX + selectedBounds.maxX) / 2, 0)), -100000, 100000, 0.01))}
                      {t(numberField('坐标 Y', (selectedBounds.minY + selectedBounds.maxY) / 2, (v) => onUpdateShape(translateShape2D(selectedShape, 0, v - (selectedBounds.minY + selectedBounds.maxY) / 2)), -100000, 100000, 0.01))}
                      {t(numberField('坐标 Z', selectedShape.zOffset, (v) => onUpdateShape({ ...selectedShape, zOffset: v }), -100000, 100000, 0.01))}
                    </> : <>{t(numberField('拉伸高度 Z', selectedShape.zHeight, applyZHeightToSelection, 0.01, 10000))}
                    <input type="range" aria-label={t("Z轴拉伸高度滑块")} min={1} max={300} step={1} value={selectedShape.zHeight} onChange={(e) => applyZHeightToSelection(Number(e.target.value))} className="w-28 accent-[var(--blue)]" />
                    {t(numberField('宽度 X', selectedBounds.widthX, (v) => onUpdateShape(resizeShape2D(selectedShape, v, selectedBounds.depthY)), 0.01, 10000, 0.01, Boolean(selectedShape.locked)))}
                    {t(numberField('深度 Y', selectedBounds.depthY, (v) => onUpdateShape(resizeShape2D(selectedShape, selectedBounds.widthX, v)), 0.01, 10000, 0.01, Boolean(selectedShape.locked)))}</>)}
                    <div className="flex items-center gap-2"><span className="text-xs text-[var(--muted)] mr-1">{t("颜色")}</span>{t(SWATCH_COLORS.map((hex) => <button type="button" key={hex} aria-label={t(`选择颜色 ${hex}`)} aria-pressed={selectedShape.color === hex} title={t(hex)} onClick={() => applyColorToSelection(hex)} style={{ backgroundColor: hex }} className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${selectedShape.color === hex ? 'border-[var(--blue)] ring-2 ring-[var(--selection-border)]' : 'border-transparent'}`} />))}</div>
                  </div>
                  {t(!isMultiSelected && selectedShape.type !== 'point' && <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[var(--line)]" data-testid="top-edge-custom-editor">
                    {t(selectedShape.type === 'segment' ? numberField('直线长度', selectedDimensions.primaryLengthMm, (v) => onUpdateShape(resizeShapeEdge2D(selectedShape, 0, v)), 0.000001, 100000, 0.01) : selectedDimensions.isLineFeature ? <>
                      {t(numberField('墙体长度', selectedDimensions.primaryLengthMm, (v) => onUpdateShape(resizeLineWall2D(selectedShape, v, selectedDimensions.thicknessMm)), 0.01, 10000, 0.01))}
                      {t(numberField('墙体厚度', selectedDimensions.thicknessMm ?? 6, (v) => onUpdateShape(resizeLineWall2D(selectedShape, selectedDimensions.primaryLengthMm, v)), 0.01, 10000, 0.01))}
                    </> : selectedDimensions.shapeType === 'circle' ? numberField('圆形直径', selectedDimensions.diameterMm ?? 30, (v) => onUpdateShape(resizeCircleDiameter2D(selectedShape, v)), 0.01, 10000, 0.01) : <>
                      <label className="text-xs text-[var(--muted)] flex items-center gap-2">{t("单边尺寸")}<select data-testid="top-edge-select" aria-label={t("选择要自定义长度的边")} className={inputClass} value={activeEdgeIdx} onChange={(e) => setActiveEdgeIdx(Number(e.target.value))}>{t(selectedDimensions.edges.map((edge) => <option key={edge.edgeIndex} value={edge.edgeIndex}>{t("边") + " "}{t(edge.edgeIndex + 1)} · {t(edge.lengthMm)} mm</option>))}</select></label>
                      <input data-testid="top-edge-length-input" aria-label={t("自定义选中边长度(mm)")} type="number" min={1} max={1000} step={0.1} className={`${inputClass} w-24`} value={edgeLenInput} onChange={(e) => setEdgeLenInput(e.target.value)} />
                      {t(selectedDimensions.edges.length === 4 && <label className="flex items-center gap-2 text-xs text-[var(--muted)]"><input type="checkbox" checked={syncOppositeRect} onChange={(e) => setSyncOppositeRect(e.target.checked)} className="accent-[var(--blue)]" />{t("同步对边")}</label>)}
                      <button type="button" className={primary} disabled={!Number.isFinite(Number(edgeLenInput)) || Number(edgeLenInput) < 1 || Number(edgeLenInput) > 1000} onClick={() => onUpdateShape(resizeShapeEdge2D(selectedShape, activeEdgeIdx, Number(edgeLenInput), { syncOppositeRectEdge: syncOppositeRect }))}>{t("应用边长")}</button>
                    </>)}
                    {t(selectedShape.booleanMeta && <button type="button" data-testid="boolean-restore-btn" className={neutral} onClick={() => onRestoreBoolean(selectedShape.id)} title={t("还原布尔运算前的两个图形")}><RotateCcw className="w-4 h-4" />{t("还原布尔来源")}</button>)}
                  </div>)}
                </fieldset>
              ) : <div className="flex items-center gap-5 flex-wrap text-xs text-[var(--muted)]"><span>{t("在画布或对象列表中选择图形，即可调整尺寸。")}</span>{t(numberField('新图形默认高度', defaultZHeight, onChangeDefaultZHeight, 1, 300))}</div>)}
            </div>
          )}

          {panel === 'boolean' && <div data-testid="boolean-menu-dropdown" className="space-y-3">
            {booleanShapes.length >= 2 ? <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">{t("主图形 A")}<select data-testid="boolean-target-select" aria-label={t("布尔运算主图形A")} value={boolTargetId} onChange={(e) => setBooleanOperand('a', e.target.value)} className={`${inputClass} max-w-[210px]`}>{booleanShapes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <button type="button" data-testid="boolean-swap-btn" className={neutral} aria-label={t("交换主图形与工具图形")} title={t("交换 A 与 B，改变差集切割方向")} onClick={handleSwapAB}><ArrowLeftRight className="w-4 h-4" /></button>
                <label className="flex items-center gap-2 text-xs text-[var(--muted)]">{t("工具图形 B")}<select data-testid="boolean-tool-select" aria-label={t("布尔运算工具图形B")} value={boolToolId} onChange={(e) => setBooleanOperand('b', e.target.value)} className={`${inputClass} max-w-[210px]`}>{booleanShapes.filter((s) => s.id !== boolTargetId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <span className="text-[11px] text-[var(--muted)]">{t(areABOverlapping ? '轮廓已重叠' : '轮廓未重叠 · 保持原坐标')}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {t(([{ op: 'union', title: '并集 A ∪ B', icon: Combine }, { op: 'intersection', title: '交集 A ∩ B', icon: Layers }, { op: 'subtraction', title: '差集 A − B', icon: Scissors }] as const).map(({ op, title, icon: Icon }) => <button key={op} type="button" data-testid={`boolean-op-${op}`} disabled={!canRunBoolean} className={primary} onClick={() => { if (onBooleanPreview(op, boolTargetId, boolToolId)) closePanel(); }}><Icon className="w-4 h-4" />{t(title)}</button>))}
                <span className="self-center text-[11px] text-[var(--muted)] ml-1">{t("XY 截面运算 · 结果沿用 A 的标高与高度；B 的 Z 位置不参与切割。")}</span>
              </div>
              <p className="text-[11px] text-[var(--muted)]">{t("预览后确认应用，源对象会隐藏保留。当前结果支持单个外轮廓与一个内孔。")}</p>
            </> : <p className="text-xs text-[var(--muted)]">{t("需要两个可见闭合实体。定位点和草图直线不参加布尔运算。")}</p>}
          </div>}

          {t(panel === 'transform' && <div data-testid="transform-menu-dropdown" className="space-y-3">
            {t(editableSelection.length === 0 && <p className="text-xs text-[var(--muted)]">{t("选择至少一个可见且未锁定的对象后应用变换。")}</p>)}
            {t(editableSelection.length > 0 && editableSelection.length < selectedIds.length && <p className="text-[11px] text-[var(--muted)]">{t("已锁定或隐藏的对象将保持不变。")}</p>)}
            <div role="tablist" aria-label={t("精确变换方式")} className="flex gap-1 rounded-md bg-[var(--input)] p-1">
              {t(([{ id: 'move', label: '平移', icon: Move }, { id: 'rotate', label: '旋转 XY', icon: RotateCw }, { id: 'scale', label: '等比缩放', icon: Scaling }] as const).map(({ id, label, icon: Icon }) =>
                <button type="button" key={id} role="tab" aria-selected={transformMode === id} aria-controls="precision-transform-form" onClick={() => setTransformMode(id)} className={`${transformMode === id ? primary : neutral} flex-1`}><Icon className="h-3.5 w-3.5" />{t(label)}</button>))}
            </div>
            <form key={transformMode} id="precision-transform-form" onSubmit={handlePrecisionTransform} aria-label={t("精确变换参数")}>
              <fieldset disabled={editableSelection.length === 0} className="min-w-0 space-y-3 disabled:opacity-50">
                <div className="grid grid-cols-3 gap-3">
                  {t(transformMode === 'move' ? <>{t(formField('平移 ΔX (mm)', 'dx', 0, -100000, 100000))}{t(formField('平移 ΔY (mm)', 'dy', 0, -100000, 100000))}{t(formField('平移 ΔZ (mm)', 'dz', 0, -100000, 100000))}</> :
                    transformMode === 'rotate' ? <>{t(formField('旋转角度 (°)', 'angle', 90, -36000, 36000))}<p className="col-span-2 self-end pb-2 text-[11px] text-[var(--muted)]">{t("绕 Z 轴旋转；正角度为 XY 逆时针。")}</p></> :
                      <>{t(formField('等比缩放系数', 'factor', 1, 0.001, 1000))}<p className="col-span-2 self-end pb-2 text-[11px] text-[var(--muted)]">{t("XYZ 尺寸与相对位置同时缩放。")}</p></>)}
                </div>
                {t(transformMode !== 'move' && <div className="space-y-3 rounded-md border border-[var(--line)] px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                    <span>{t("组合中心：")}{t(selectionPivot.x.toFixed(2))}, {t(selectionPivot.y.toFixed(2))}{t(transformMode === 'scale' ? `, ${selectionPivot.z.toFixed(2)}` : '')} mm</span>
                    <label className="flex items-center gap-2"><input type="checkbox" aria-label={t("使用自定义变换中心")} checked={customPivot} onChange={(event) => setCustomPivot(event.target.checked)} className="accent-[var(--blue)]" />{t("自定义中心")}</label>
                  </div>
                  {t(customPivot && <div className="grid grid-cols-3 gap-3">{t(formField('变换中心 X', 'pivotX', selectionPivot.x, -100000, 100000))}{t(formField('变换中心 Y', 'pivotY', selectionPivot.y, -100000, 100000))}{t(transformMode === 'scale' && formField('变换中心 Z', 'pivotZ', selectionPivot.z, -100000, 100000))}</div>)}
                </div>)}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="submit" name="action" value="apply" data-testid="precision-transform-apply" className={`${primary} order-2`}><Check className="h-3.5 w-3.5" />{t("应用变换")}</button>
                  <button type="submit" name="action" value="copy" data-testid="precision-transform-copy" className={`${neutral} order-1`}><Copy className="h-3.5 w-3.5" />{t("复制并应用")}</button>
                </div>
              </fieldset>
            </form>
            <details className="border-t border-[var(--line)] pt-3">
              <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--ink)]">{t("镜像与阵列")}</summary>
              <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-[var(--muted)] w-20 flex items-center gap-2"><FlipHorizontal2 className="w-4 h-4 text-[var(--blue)]" />{t("镜像")}</span>
              <select aria-label={t("镜像翻转方向")} value={mirrorAxis} onChange={(e) => setMirrorAxis(e.target.value as 'x' | 'y')} className={inputClass}><option value="x">{t("左右翻转")}</option><option value="y">{t("上下翻转")}</option></select>
              <button type="button" data-testid="mirror-inplace-btn" className={primary} disabled={editableSelection.length === 0} onClick={() => onMirrorShapes(mirrorAxis, false)}>{t("原地镜像")}</button>
              <button type="button" data-testid="mirror-copy-btn" className={neutral} disabled={editableSelection.length === 0} onClick={() => onMirrorShapes(mirrorAxis, true)} title={t("绕原点轴 X=0 或 Y=0 生成镜像副本")}>{t("生成镜像副本")}</button>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
              <span className="text-xs text-[var(--muted)] w-20 flex items-center gap-2"><LayoutGrid className="w-4 h-4 text-[var(--blue)]" />{t("矩形阵列")}</span>
              {t(numberField('阵列列数', arrayCols, (v) => setArrayCols(Math.round(v)), 1, 20))}
              {t(numberField('阵列行数', arrayRows, (v) => setArrayRows(Math.round(v)), 1, 20))}
              {t(numberField('X 间距', arrayGapX, setArrayGapX, 0, 500))}
              {t(numberField('Y 间距', arrayGapY, setArrayGapY, 0, 500))}
              <button type="button" data-testid="rect-array-btn" className={primary} disabled={editableSelection.length === 0 || arrayRows * arrayCols <= 1} onClick={() => onRectArray(arrayRows, arrayCols, arrayGapX, arrayGapY)}>{t("生成阵列")}</button>
              <span className="text-[11px] text-[var(--muted)]">{t("间距为图形边缘距离，单位 mm")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
              <span className="text-xs text-[var(--muted)] w-20 flex items-center gap-2"><RotateCw className="w-4 h-4 text-[var(--blue)]" />{t("环形阵列")}</span>
              {t(numberField('环形数量', polarCount, (v) => setPolarCount(Math.round(v)), 2, 60))}
              {t(numberField('总角度 °', polarAngle, setPolarAngle, -360, 360, 15))}
              {t(numberField('中心 X', polarCx, setPolarCx))}
              {t(numberField('中心 Y', polarCy, setPolarCy))}
              <button type="button" data-testid="polar-array-btn" className={primary} disabled={editableSelection.length === 0 || polarCount < 2 || polarAngle === 0} onClick={() => onPolarArray(polarCount, polarAngle, polarCx, polarCy)}>{t("生成环阵")}</button>
            </div>
              </div>
            </details>
          </div>)}
        </div>
      )}

      {t(booleanPreviewActive && <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--selection-border)] bg-[var(--paper)] px-4 py-3 shadow-lg" role="status"><span className="text-xs text-[var(--blue)] mr-2">{t("二维轮廓预览 · 尚未应用")}</span><button type="button" data-testid="boolean-preview-commit" onClick={onCommitBooleanPreview} className={primary}><Check className="w-4 h-4" />{t("确认应用")}</button><button type="button" data-testid="boolean-preview-cancel" onClick={onCancelBooleanPreview} className={neutral}>{t("取消预览")}</button></div>)}
      {t(booleanFeedback && <div data-testid="boolean-feedback-banner" role="status" className={`flex items-start justify-between gap-3 px-4 py-3 text-xs rounded-md border border-[var(--line)] shadow-lg ${booleanFeedback.ok ? 'text-[var(--ink)] bg-[var(--paper)]' : 'text-[var(--muted)] bg-[var(--paper)]'}`}><span className="leading-relaxed">{t(booleanFeedback.message)}</span><button type="button" onClick={onClearBooleanFeedback} aria-label={t("关闭操作提示")} className="p-0.5 shrink-0 text-[var(--muted)] hover:text-[var(--blue)]"><X className="w-3.5 h-3.5" /></button></div>)}
      </div>

      <div className="flex h-[56px] max-w-full items-center rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 shadow-[0_6px_20px_rgba(0,0,0,0.28)] overflow-x-auto" role="toolbar" aria-label={t("建模工具")}>
        <div className={groupClass}>
          <button type="button" className={`${neutral} !w-8 !px-0`} onClick={onUndo} disabled={!canUndo} aria-label={t("撤销上一步操作")} title={t(drawingActive ? '绘图中请按 U↵ / Ctrl+Z 撤销绘图最近一步' : `撤销 Ctrl+Z · ${undoCount} 步`)}><Undo2 className="h-4 w-4" /></button>
          <button type="button" className={`${neutral} !w-8 !px-0`} onClick={onRedo} disabled={!canRedo} aria-label={t("重做下一步操作")} title={t(drawingActive ? '结束绘图后可重做；U↵ / Ctrl+Z 撤销绘图最近一步' : `重做 Ctrl+Y · ${redoCount} 步`)}><Redo2 className="h-4 w-4" /></button>
        </div>
        <div className={groupClass} role="group" aria-label={t("二维草图工具")}>
          {t(DRAW_TOOLS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-label={t(id === 'select' ? '选择或框选图形' : id === 'point' ? '创建定位点' : id === 'measure' ? '测量 XY 两点距离' : `绘制${label}`)} aria-pressed={activeTool === id} onClick={() => onChangeTool(id)} title={t(DRAW_TOOL_HINTS[id])}
            className={`flex h-9 ${id === 'line' || id === 'point' ? 'w-auto gap-1.5 px-2.5' : 'w-9'} shrink-0 items-center justify-center rounded-[4px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--blue)] ${activeTool === id ? 'bg-[var(--selection)] text-[var(--blue)]' : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]'}`}><Icon className="h-[18px] w-[18px]" />{t((id === 'line' || id === 'point') && <span className="whitespace-nowrap text-xs">{t(label)}</span>)}</button>))}
          <button type="button" aria-label={t("连接两点")} title={t("Ctrl 单击选择两个定位点，连接后移动点会联动直线")} disabled={!canConnectPoints} onClick={onConnectPoints} className={canConnectPoints ? primary : neutral}><Minus className="h-4 w-4" />{t("连接两点")}</button>
        </div>
        <div className={groupClass}>
          <button type="button" className={`${neutral} !w-8 !px-0`} aria-label={t("全选或取消全选图形")} aria-pressed={allSelected} title={t("全选 Ctrl+A")} onClick={allSelected ? onClearSelection : onSelectAll}><CheckSquare className="h-4 w-4" /></button>
          <button type="button" className={`${neutral} !w-8 !px-0`} aria-label={t("复制选中图形")} title={t("复制")} disabled={!hasSelection} onClick={() => onDuplicateShape()}><Copy className="h-4 w-4" /></button>
          <button type="button" className={`${neutral} !w-8 !px-0`} aria-label={t("删除选中图形")} title={t("删除 Delete")} disabled={!hasSelection} onClick={() => onDeleteShape()}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className={`${panel === 'create' ? primary : neutral} !h-10 flex-col !gap-0.5`} onClick={() => togglePanel('create')} aria-expanded={panel === 'create'} aria-controls="cad-command-panel" aria-label={t("添加基础几何体")} title={t("添加几何体")}><Plus className="h-4 w-4" /><span className="text-[10px] leading-none">{t("添加")}</span></button>
          <button type="button" className={`${panel === 'properties' ? primary : neutral} !h-10 flex-col !gap-0.5`} onClick={() => togglePanel('properties')} aria-expanded={panel === 'properties'} aria-controls="cad-command-panel" aria-label={t("精细编辑尺寸与边长")} title={t("精细编辑 · 单边尺寸、对齐")}><SlidersHorizontal className="h-4 w-4" /><span className="text-[10px] leading-none">{t("编辑")}</span></button>
          <button type="button" data-testid="boolean-menu-trigger" className={`${panel === 'boolean' ? primary : neutral} !h-10 flex-col !gap-0.5`} onClick={() => togglePanel('boolean')} aria-expanded={panel === 'boolean'} aria-controls="cad-command-panel" aria-label={t("打开布尔运算菜单")} title={t("布尔 · 并集、交集、差集")}><Combine className="h-4 w-4" /><span className="text-[10px] leading-none">{t("布尔")}</span></button>
          <button type="button" data-testid="transform-menu-trigger" className={`${panel === 'transform' ? primary : neutral} !h-10 flex-col !gap-0.5`} onClick={() => togglePanel('transform')} aria-expanded={panel === 'transform'} aria-controls="cad-command-panel" aria-label={t("打开变换与阵列菜单")} title={t("精确平移、旋转、缩放、镜像与阵列")}><Move className="h-4 w-4" /><span className="text-[10px] leading-none">{t("变换")}</span></button>
        </div>
      </div>
    </section>
  );
};
