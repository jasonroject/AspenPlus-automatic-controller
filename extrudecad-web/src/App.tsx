import { t, useLocale } from './i18n';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Layers3, Save, Download, PanelLeftClose, PanelLeftOpen, Eye, EyeOff, LockKeyhole, UnlockKeyhole, Plus, HelpCircle, X, SplitSquareHorizontal, Square, RotateCcw, ChevronRight, MousePointer2, Check, Search, Focus, Maximize2 } from 'lucide-react';
import {
  CadShape,
  CameraViewId,
  PrimitivePresetType,
  BooleanOperationType,
  BooleanOperationResult,
  createPrecisionDemoScene,
  createPrimitiveShape,
  createSketchLineShape,
  createCleanTBeamPoints,
  translateShape2D,
  computeBooleanShapes,
  computeBounds2D,
  mirrorShape2D,
  rotateShape2D,
} from './utils/cadEngine';
import {
  HistoryState,
  createHistoryState,
  pushHistoryState,
  replaceHistoryPresent,
  undoHistoryState,
  redoHistoryState,
  canUndo,
  canRedo,
  isSameHistoryItem,
} from './utils/historyManager';
import { Cad2DCanvas, DrawTool2D } from './components/Cad2DCanvas';
import { Cad3DViewport, Cad3DExporterApi } from './components/Cad3DViewport';
import { BottomControlDock } from './components/BottomControlDock';
import { ExportViewsModal } from './components/ExportViewsModal';
import { Inspector } from './components/Inspector';
import { CommandPalette, CadCommand } from './components/CommandPalette';
import { DxfImportDialog } from './components/DxfImportDialog';
import { FileOpenMenu } from './components/FileOpenMenu';
import { WorkspaceOptions, PanelLayout } from './components/WorkspaceOptions';
import { resolveCommandAlias } from './utils/commandAliases';
import { PrecisionTransform, transformSelectedShapes } from './utils/precisionTransforms';
import { PrecisionPrimitiveSpec, createPrecisionPrimitive } from './utils/precisionPrimitives';
import { reconcileSketchGraph, cloneSketchSelection } from './utils/sketchGraph';
import {
  downloadProject,
  pickProjectFile,
  saveProjectToLocal,
  loadProjectFromLocal,
} from './utils/projectFile';

export type WorkspaceLayoutMode = 'split' | '2d-only' | '3d-only';

export default function App() {
  const locale = useLocale();
  useEffect(() => { document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'; document.title = locale === 'en' ? 'ExtrudeCAD Studio — Sketch & Model' : 'ExtrudeCAD Studio — 草图与建模'; }, [locale]);
  // 启动时优先从本机自动存档恢复上次画布，无存档则载入示例场景
  const [bootstrap] = useState(() => {
    const restored = loadProjectFromLocal();
    return {
      shapes: restored ?? createPrecisionDemoScene(),
      wasRestored: restored !== null,
    };
  });
  const [history, setHistory] = useState<HistoryState<CadShape[]>>(() =>
    createHistoryState(bootstrap.shapes),
  );
  const shapes = history.present;
  const historyRef = useRef(history);
  historyRef.current = history;
  const dragHistoryRef = useRef<HistoryState<CadShape[]> | null>(null);
  const canvasInteractionRef = useRef(false);
  const drawingCommandRef = useRef(false);
  const lastDrawingToolRef = useRef<DrawTool2D | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);
  const [showRestoreNotice, setShowRestoreNotice] = useState<boolean>(
    bootstrap.wasRestored,
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(bootstrap.shapes[0] ? [bootstrap.shapes[0].id] : []);
  const selectedId = selectedIds[0] ?? null;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [cleanScreen, setCleanScreen] = useState(false);
  const [commandLineOpen, setCommandLineOpen] = useState(true);
  const [commandDraft, setCommandDraft] = useState('');
  const [commandError, setCommandError] = useState('');
  const commandInputRef = useRef<HTMLInputElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(() => {
    try { const value = localStorage.getItem('extrudecad.panel-layout'); return value === 'compact' || value === 'wide' ? value : 'standard'; } catch { return 'standard'; }
  });
  useEffect(() => { try { localStorage.setItem('extrudecad.panel-layout', panelLayout); } catch { /* Keep session layout. */ } }, [panelLayout]);
  useEffect(() => {
    const preventPageWheelZoom = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) event.preventDefault(); };
    window.addEventListener('wheel', preventPageWheelZoom, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', preventPageWheelZoom, true);
  }, []);
  const [dxfFile, setDxfFile] = useState<{ name: string; text: string } | null>(null);
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const [objectQuery, setObjectQuery] = useState('');
  const [fitRequest, setFitRequest] = useState(0);
  const [panelRequest, setPanelRequest] = useState<{ panel: 'create' | 'properties' | 'boolean' | 'transform'; mode?: 'move' | 'rotate' | 'scale'; nonce: number }>();
  const [saveStatus, setSaveStatus] = useState<'pending' | 'saved' | 'failed'>('pending');
  const [activeTool, setActiveTool] = useState<DrawTool2D>('select');
  const [layoutMode, setLayoutMode] = useState<WorkspaceLayoutMode>('3d-only');
  const [activeCameraView, setActiveCameraView] =
    useState<CameraViewId>('perspective');
  const [defaultZHeight, setDefaultZHeight] = useState<number>(30);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [gridStep, setGridStep] = useState<number>(2);
  const [wireframeOverlay, setWireframeOverlay] = useState<boolean>(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [exporterApi, setExporterApi] = useState<Cad3DExporterApi | null>(null);
  const [booleanFeedback, setBooleanFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const commitScene = useCallback((previous: HistoryState<CadShape[]>, proposed: CadShape[], transient = false) => {
    try {
      const next = reconcileSketchGraph(previous.present, proposed);
      if (!isSameHistoryItem(previous.present, next)) setBooleanFeedback(feedback => feedback && !feedback.ok ? null : feedback);
      return transient ? replaceHistoryPresent(previous, next) : pushHistoryState(previous, next);
    } catch (error) {
      setBooleanFeedback({ ok: false, message: error instanceof Error ? error.message : '点线更新未完成。' });
      return previous;
    }
  }, []);

  const handleBeginGeometryDrag = useCallback(() => {
    if (!dragHistoryRef.current) dragHistoryRef.current = historyRef.current;
  }, []);
  const handleCancelGeometryDrag = useCallback(() => {
    if (dragHistoryRef.current) setHistory(dragHistoryRef.current);
    dragHistoryRef.current = null;
  }, []);
  const handleEndGeometryDrag = useCallback(() => {
    const before = dragHistoryRef.current;
    dragHistoryRef.current = null;
    // A rejected first preview may not have pushed history. Commit the whole gesture from its original snapshot.
    if (before) setHistory((current) => pushHistoryState(before, current.present));
  }, []);
  const handleCanvasInteractionChange = useCallback((active: boolean) => { canvasInteractionRef.current = active; }, []);
  const handleDrawingStateChange = useCallback((active: boolean) => {
    drawingCommandRef.current = active;
    setDrawingActive(active);
    if (active) setShowRestoreNotice(false);
  }, []);
  const handleUndoDrawingSegment = useCallback((createdIds: string[]): boolean => {
    const current = historyRef.current;
    const previous = current.past[current.past.length - 1];
    const ids = new Set(createdIds);
    if (!ids.size || !previous || previous.some((shape) => ids.has(shape.id)) ||
      current.present.length !== previous.length + ids.size ||
      !createdIds.every((id) => current.present.some((shape) => shape.id === id)) ||
      !isSameHistoryItem(current.present.filter((shape) => !ids.has(shape.id)), previous)) return false;
    const next = undoHistoryState(current);
    historyRef.current = next;
    setHistory(next);
    return true;
  }, []);

  // Prune any deleted IDs from selectedIds when undo/redo/delete happens
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => shapes.some((s) => s.id === id));
      if (valid.length !== prev.length) {
        return valid;
      }
      return prev;
    });
  }, [shapes]);

  // Auto-save the whole project to localStorage (debounced) so a refresh never loses work
  useEffect(() => {
    setSaveStatus('pending');
    const timer = setTimeout(() => {
      const result = saveProjectToLocal(shapes);
      setSaveStatus(result === false ? 'failed' : 'saved');
    }, 800);
    return () => clearTimeout(timer);
  }, [shapes]);

  useEffect(() => {
    const flushAutosave = () => { saveProjectToLocal(shapes); };
    window.addEventListener('pagehide', flushAutosave);
    return () => window.removeEventListener('pagehide', flushAutosave);
  }, [shapes]);

  // Auto-dismiss the "restored from autosave" toast
  useEffect(() => {
    if (!showRestoreNotice) return;
    const timer = setTimeout(() => setShowRestoreNotice(false), 4500);
    return () => clearTimeout(timer);
  }, [showRestoreNotice]);

  const handleSelectSingleShape = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : []);
  }, []);

  const handleSelectShape = useCallback((id: string | null, additive = false, remove = false) => {
    setSelectedIds((ids) => {
      if (remove) return ids.filter(selected => selected !== id);
      if (!additive) return id ? [id] : [];
      if (!id) return ids;
      return ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id];
    });
  }, []);

  const handleSelectAllShapes = useCallback(() => {
    const allVisibleIds = shapes.filter((s) => s.visible).map((s) => s.id);
    setSelectedIds(allVisibleIds);
    setActiveTool('select');
  }, [shapes]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => undoHistoryState(prev));
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => redoHistoryState(prev));
  }, []);

  const handleDeleteShape = useCallback(
    (id?: string) => {
      setHistory((prev) => {
        const idsToRemove = new Set(
          id && !selectedIds.includes(id)
            ? [id]
            : selectedIds.length > 0
              ? selectedIds
              : id
                ? [id]
                : [],
        );
        if (idsToRemove.size === 0) return prev;
        const next = prev.present.filter((s) => !idsToRemove.has(s.id) || s.locked);
        if (next.length === prev.present.length) return prev;
        setSelectedIds(next[next.length - 1] ? [next[next.length - 1].id] : []);
        return commitScene(prev, next);
      });
    },
    [selectedIds, commitScene],
  );

  const handleUpdateShape = useCallback(
    (updated: CadShape, transient = false) => {
      setHistory((prev) => {
        const nextShapes = prev.present.map((s) =>
          s.id === updated.id && !s.locked ? updated : s,
        );
        return commitScene(prev, nextShapes, transient);
      });
    },
    [commitScene],
  );

  const handleUpdateMultipleShapes = useCallback(
    (nextShapes: CadShape[], transient = false) => {
      setHistory((prev) => {
        const protectedShapes = prev.present.map((shape) => shape.locked ? shape : nextShapes.find((next) => next.id === shape.id) ?? shape);
        return commitScene(prev, protectedShapes, transient);
      });
    },
    [commitScene],
  );

  const handleCreateShapes = useCallback((additions: CadShape[]) => {
    setHistory((prev) => commitScene(prev, [...prev.present, ...additions]));
    setSelectedIds(additions.length ? [additions[additions.length - 1].id] : []);
  }, [commitScene]);
  const handleCreateShape = useCallback((newShape: CadShape) => handleCreateShapes([newShape]), [handleCreateShapes]);

  const handleDuplicateShape = useCallback(
    (id?: string) => {
      setHistory((prev) => {
        const targetIds =
          selectedIds.length > 1
            ? selectedIds
            : id
              ? [id]
              : selectedIds;
        if (targetIds.length === 0) return prev;
        const usedNames = new Set(prev.present.map((shape) => shape.name));
        const copies = cloneSketchSelection(prev.present, targetIds, (target) => {
          const shifted = translateShape2D(target, 14, -14);
          const baseName = `${target.name} (副本)`;
          let name = baseName;
          let suffix = 2;
          while (usedNames.has(name)) name = `${baseName} (${suffix++})`;
          usedNames.add(name);
          return {
            ...shifted,
            name,
            locked: false,
            visible: true,
            booleanMeta: undefined,
          };
        });
        if (copies.length === 0) return prev;
        setSelectedIds(copies.map((c) => c.id));
        return pushHistoryState(prev, [...prev.present, ...copies]);
      });
    },
    [selectedIds],
  );

  const handleAddPrimitive = useCallback(
    (preset: PrimitivePresetType) => {
      setHistory((prev) => {
        const nextIndex = prev.present.length + 1;
        const created = createPrimitiveShape(preset, nextIndex);
        if (preset === 't-beam') {
          created.points = createCleanTBeamPoints(
            ((nextIndex - 1) % 4) * 8,
            ((nextIndex - 1) % 4) * 8,
          );
        }
        created.zHeight = defaultZHeight;
        setSelectedIds([created.id]);
        return pushHistoryState(prev, [...prev.present, created]);
      });
      setActiveTool('select');
    },
    [defaultZHeight],
  );

  // Boolean preview state: 预览结果只以虚线显示，确认后才进入历史记录
  const [booleanPreview, setBooleanPreview] = useState<{
    op: BooleanOperationType;
    targetId: string;
    toolId: string;
    sourceA: CadShape;
    sourceB: CadShape;
    resultShape: CadShape;
    message: string;
  } | null>(null);

  const handleResetDemo = useCallback(() => {
    const starter = createPrecisionDemoScene();
    setHistory((prev) => pushHistoryState(prev, starter));
    setSelectedIds(starter[0] ? [starter[0].id] : []);
    setLayoutMode('3d-only');
    setActiveTool('select');
    setBooleanFeedback(null);
    setBooleanPreview(null);
  }, []);

  const handleNewEmptyModel = useCallback(() => {
    setHistory((prev) => pushHistoryState(prev, []));
    setSelectedIds([]);
    setActiveTool('rect');
    setLayoutMode('2d-only');
    setBooleanFeedback(null);
    setBooleanPreview(null);
  }, []);

  const handleBooleanOperation = useCallback(
    (
      op: BooleanOperationType,
      customTargetId?: string,
      customToolId?: string,
    ): BooleanOperationResult => {
      const targetId = customTargetId ?? selectedIds[0];
      const toolId =
        customToolId ??
        selectedIds[1] ??
        shapes.find((s) => s.visible && s.id !== targetId)?.id;

      const shapeA = shapes.find((s) => s.id === targetId);
      const shapeB = shapes.find((s) => s.id === toolId);

      if (!shapeA || !shapeB || shapeA.id === shapeB.id) {
        const res: BooleanOperationResult = {
          ok: false,
          operation: op,
          resultShape: null,
          wasAutoAligned: false,
          message: '请至少确保画布中有 2 个不同的图形再执行布尔运算。',
        };
        setBooleanFeedback({ ok: false, message: res.message });
        return res;
      }

      if (shapeA.locked || shapeB.locked) {
        const res: BooleanOperationResult = { ok: false, operation: op, resultShape: null, wasAutoAligned: false, message: '请先解锁两个源对象，再执行布尔运算。' };
        setBooleanFeedback({ ok: false, message: res.message });
        return res;
      }

      const res = computeBooleanShapes(shapeA, shapeB, op);

      if (res.ok && res.resultShape) {
        const created = res.resultShape;
        // 结果实体化：原始操作数不删除，仅隐藏保留，结果图形带 booleanMeta 可还原
        setHistory((prev) => {
          const nextShapes = prev.present
            .map((s) =>
              s.id === shapeA.id || s.id === shapeB.id
                ? { ...s, visible: false }
                : s,
            )
            .concat(created);
          return pushHistoryState(prev, nextShapes);
        });
        setSelectedIds([created.id]);
        setActiveTool('select');
        setBooleanPreview(null);
      }
      setBooleanFeedback({ ok: res.ok, message: res.message });
      return res;
    },
    [shapes, selectedIds],
  );

  const handleSaveProject = useCallback(() => {
    downloadProject(shapes);
    setBooleanFeedback({ ok: true, message: '工程文件已生成，请查看浏览器下载。' });
  }, [shapes]);

  const handleOpenProject = useCallback(async () => {
    try {
      const loaded = await pickProjectFile();
      setHistory(createHistoryState(loaded));
      setSelectedIds(loaded[0] ? [loaded[0].id] : []);
      setActiveTool('select');
      setBooleanFeedback({
        ok: true,
        message: `已打开工程：载入 ${loaded.length} 个图形。`,
      });
      saveProjectToLocal(loaded);
    } catch (err) {
      if (err instanceof Error && err.message === '已取消选择') return;
      setBooleanFeedback({
        ok: false,
        message: `打开工程失败：${err instanceof Error ? err.message : '未知错误'}`,
      });
    }
  }, []);

  const handleDxfFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('DXF 文件超过 5 MB，请先精简轮廓。');
      setDxfFile({ name: file.name, text: await file.text() });
    } catch (error) {
      setBooleanFeedback({ ok: false, message: error instanceof Error ? error.message : '无法读取 DXF 文件。' });
    }
  };

  const handleImportDxf = useCallback((imported: CadShape[]) => {
    const usedNames = new Set(historyRef.current.present.map((shape) => shape.name));
    const additions = imported.map((shape) => {
      let name = shape.name;
      let suffix = 2;
      while (usedNames.has(name)) name = `${shape.name} (${suffix++})`;
      usedNames.add(name);
      return { ...shape, id: `shape-dxf-${crypto.randomUUID()}`, name };
    });
    if (!additions.length) return;
    setHistory((previous) => pushHistoryState(previous, [...previous.present, ...additions]));
    setSelectedIds(additions.map((shape) => shape.id));
    setActiveTool('select');
    setLayoutMode('2d-only');
    setBooleanPreview(null);
    setFitRequest((value) => value + 1);
    setBooleanFeedback({ ok: true, message: `已追加 ${additions.length} 个 DXF 对象，可用 Ctrl + Z 撤销本次导入。` });
  }, []);

  const handleBooleanPreview = useCallback(
    (op: BooleanOperationType, targetId: string, toolId: string) => {
      const shapeA = shapes.find((s) => s.id === targetId);
      const shapeB = shapes.find((s) => s.id === toolId);
      if (!shapeA || !shapeB || shapeA.id === shapeB.id) {
        setBooleanFeedback({
          ok: false,
          message: '请先选择 2 个不同的图形再预览布尔运算。',
        });
        return false;
      }
      if (shapeA.locked || shapeB.locked) {
        setBooleanFeedback({ ok: false, message: '请先解锁两个源对象，再预览布尔运算。' });
        return false;
      }
      const res = computeBooleanShapes(shapeA, shapeB, op);
      if (res.ok && res.resultShape) {
        setBooleanPreview({
          op,
          targetId,
          toolId,
          sourceA: shapeA,
          sourceB: shapeB,
          resultShape: res.resultShape,
          message: res.message,
        });
        setBooleanFeedback(null);
        setLayoutMode('2d-only');
        setActiveTool('select');
        return true;
      } else {
        setBooleanPreview(null);
        setBooleanFeedback({ ok: false, message: res.message });
        return false;
      }
    },
    [shapes],
  );

  const handleCommitBooleanPreview = useCallback(() => {
    if (!booleanPreview) return;
    if (!isSameHistoryItem(shapes.find((s) => s.id === booleanPreview.targetId), booleanPreview.sourceA) ||
        !isSameHistoryItem(shapes.find((s) => s.id === booleanPreview.toolId), booleanPreview.sourceB)) {
      setBooleanPreview(null);
      setBooleanFeedback({ ok: false, message: '源对象已改变，请重新预览布尔结果。' });
      return;
    }
    const { resultShape, targetId, toolId, message } = booleanPreview;
    setHistory((prev) => {
      const nextShapes = prev.present
        .map((s) =>
          s.id === targetId || s.id === toolId ? { ...s, visible: false } : s,
        )
        .concat(resultShape);
      return pushHistoryState(prev, nextShapes);
    });
    setSelectedIds([resultShape.id]);
    setActiveTool('select');
    setBooleanPreview(null);
    setBooleanFeedback({ ok: true, message });
  }, [booleanPreview, shapes]);

  const handleCancelBooleanPreview = useCallback(() => {
    setBooleanPreview(null);
  }, []);

  // 源对象的尺寸、位置或可见性改变后，旧预览不能继续应用。
  useEffect(() => {
    if (!booleanPreview) return;
    const sourceA = shapes.find((s) => s.id === booleanPreview.targetId);
    const sourceB = shapes.find((s) => s.id === booleanPreview.toolId);
    if (!isSameHistoryItem(sourceA, booleanPreview.sourceA) || !isSameHistoryItem(sourceB, booleanPreview.sourceB)) {
      setBooleanPreview(null);
      setBooleanFeedback({ ok: false, message: '源对象已改变，请重新预览布尔结果。' });
    }
  }, [shapes, booleanPreview]);

  // 还原布尔：删除结果图形，恢复两个操作数的可见性
  const handleRestoreBoolean = useCallback(
    (resultId: string) => {
      const resultShape = shapes.find((s) => s.id === resultId);
      const meta = resultShape?.booleanMeta;
      if (!meta) return;
      if (resultShape.locked) {
        setBooleanFeedback({ ok: false, message: '请先解锁布尔结果，再还原源对象。' });
        return;
      }
      setHistory((prev) => {
        const nextShapes = prev.present
          .filter((s) => s.id !== resultId)
          .map((s) =>
            s.id === meta.targetId || s.id === meta.toolId
              ? { ...s, visible: true }
              : s,
          );
        return pushHistoryState(prev, nextShapes);
      });
      setSelectedIds([meta.targetId]);
      setBooleanFeedback({
        ok: true,
        message: `已还原：删除布尔结果并恢复显示「${meta.targetName}」与「${meta.toolName}」。`,
      });
    },
    [shapes],
  );

  // 镜像：原地绕自身中心翻转，或绕原点轴线生成镜像副本
  const handleMirrorShapes = useCallback(
    (axis: 'x' | 'y', asCopy: boolean) => {
      const targets = shapes.filter(
        (s) => selectedIds.includes(s.id) && s.visible && !s.locked,
      );
      if (targets.length === 0) {
        setBooleanFeedback({
          ok: false,
          message: '请先选中至少 1 个未锁定图形再执行镜像。',
        });
        return;
      }
      setHistory((prev) => {
        if (asCopy) {
          const copies = cloneSketchSelection(prev.present, targets.map((s) => s.id), (s) => {
            const mirrored = mirrorShape2D(s, axis, 0);
            return {
              ...mirrored,
              name: `${s.name.replace(/\s*\(.*\)/, '')} (镜像)`,
              booleanMeta: undefined,
              locked: false,
            };
          });
          setSelectedIds(copies.map((c) => c.id));
          return pushHistoryState(prev, [...prev.present, ...copies]);
        }
        const idSet = new Set(targets.map((t) => t.id));
        const sharedBounds = targets.some((shape) => shape.endpointIds) ? computeBounds2D(targets.flatMap((shape) => shape.points)) : null;
        const next = prev.present.map((s) => {
          if (!idSet.has(s.id)) return s;
          const b = sharedBounds ?? computeBounds2D(s.points);
          // 以包围盒中心为轴，镜像后包围盒位置严格不变
          const pivot =
            axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2;
          return mirrorShape2D(s, axis, pivot);
        });
        return commitScene(prev, next);
      });
      setBooleanFeedback({
        ok: true,
        message: asCopy
          ? `已生成 ${targets.length} 个镜像副本（绕原点${axis === 'x' ? '竖直轴 X=0' : '水平轴 Y=0'}翻转）。`
          : `已原地${axis === 'x' ? '左右' : '上下'}镜像 ${targets.length} 个图形。`,
      });
    },
    [shapes, selectedIds, commitScene],
  );

  // 矩形阵列
  const handleRectArray = useCallback(
    (rows: number, cols: number, gapX: number, gapY: number) => {
      const targets = shapes.filter(
        (s) => selectedIds.includes(s.id) && s.visible && !s.locked,
      );
      if (![rows, cols, gapX, gapY].every(Number.isFinite)) return;
      const bounds = computeBounds2D(targets.flatMap((shape) => shape.points));
      const copies: CadShape[] = [];
      const rowCount = Math.min(20, Math.max(1, Math.round(rows)));
      const colCount = Math.min(20, Math.max(1, Math.round(cols)));
      array: for (let row = 0; row < rowCount; row++) {
        for (let col = 0; col < colCount; col++) {
          if (!row && !col) continue;
          const group = cloneSketchSelection(shapes, targets.map((shape) => shape.id), (shape) => ({
            ...translateShape2D(shape, col * (bounds.widthX + Math.max(0, gapX)), row * (bounds.depthY + Math.max(0, gapY))),
            name: `${shape.name} 阵列${row * colCount + col + 1}`,
          }));
          if (copies.length + group.length > 200) break array;
          copies.push(...group);
        }
      }
      if (copies.length === 0) {
        setBooleanFeedback({
          ok: false,
          message: '阵列未生效：请先选中图形，并确保行×列大于 1×1。',
        });
        return;
      }
      setHistory((prev) => pushHistoryState(prev, [...prev.present, ...copies]));
      setSelectedIds(copies.map((c) => c.id));
      setBooleanFeedback({
        ok: true,
        message: `已生成矩形阵列 ${cols}列×${rows}行（间距 X:${gapX} / Y:${gapY}mm），新增 ${copies.length} 个副本并已选中。`,
      });
    },
    [shapes, selectedIds],
  );

  // 环形阵列
  const handlePolarArray = useCallback(
    (count: number, totalAngleDeg: number, centerX: number, centerY: number) => {
      const targets = shapes.filter(
        (s) => selectedIds.includes(s.id) && s.visible && !s.locked,
      );
      if (![count, totalAngleDeg, centerX, centerY].every(Number.isFinite)) return;
      const copyCount = Math.min(60, Math.max(2, Math.round(count)));
      const fullCircle = Math.abs(Math.abs(totalAngleDeg) - 360) < 0.001;
      const step = totalAngleDeg / (fullCircle ? copyCount : copyCount - 1);
      const copies: CadShape[] = [];
      for (let index = 1; index < copyCount; index++) {
        const group = cloneSketchSelection(shapes, targets.map((shape) => shape.id), (shape) => ({
          ...rotateShape2D(shape, { x: centerX, y: centerY }, step * index),
          name: `${shape.name} 环阵${index + 1}`,
        }));
        if (copies.length + group.length > 200) break;
        copies.push(...group);
      }
      if (copies.length === 0) {
        setBooleanFeedback({
          ok: false,
          message: '环形阵列未生效：请先选中图形，数量需 ≥ 2。',
        });
        return;
      }
      setHistory((prev) => pushHistoryState(prev, [...prev.present, ...copies]));
      setSelectedIds(copies.map((c) => c.id));
      setBooleanFeedback({
        ok: true,
        message: `已生成环形阵列 ×${count}（总角 ${totalAngleDeg}°，中心 ${centerX},${centerY}），新增 ${copies.length} 个副本并已选中。`,
      });
    },
    [shapes, selectedIds],
  );

  const handleObjectVisibility = useCallback((id: string, visible: boolean) => {
    setHistory((prev) => pushHistoryState(prev, prev.present.map((shape) => shape.id === id ? { ...shape, visible } : shape)));
  }, []);

  const handleLockObjects = useCallback((ids: string[], locked: boolean) => {
    setHistory((prev) => pushHistoryState(prev, prev.present.map((shape) => ids.includes(shape.id) ? { ...shape, locked } : shape)));
  }, []);

  const handleVisibilityCommand = useCallback((mode: 'hide-selected' | 'isolate' | 'show-all') => {
    setHistory((prev) => pushHistoryState(prev, prev.present.map((shape) => ({ ...shape, visible: mode === 'show-all' ? true : mode === 'isolate' ? selectedIds.includes(shape.id) : selectedIds.includes(shape.id) ? false : shape.visible }))));
  }, [selectedIds]);

  const handleTransformSelection = useCallback((operation: PrecisionTransform) => {
    try {
      const result = transformSelectedShapes(shapes, selectedIds, operation);
      if (!result.changed) {
        setBooleanFeedback({ ok: false, message: '没有产生变化：请选择可见、未锁定的对象，并输入有效变换。' });
        return false;
      }
      setHistory((prev) => pushHistoryState(prev, result.shapes));
      setSelectedIds(result.selectedIds);
      const skipped = shapes.filter((shape) => selectedIds.includes(shape.id) && shape.locked).length;
      setBooleanFeedback({ ok: true, message: `已${operation.copy ? '复制并' : ''}${operation.kind === 'move' ? '移动' : operation.kind === 'rotate' ? '旋转' : '缩放'} ${result.changed} 个对象${skipped ? `，跳过 ${skipped} 个锁定对象` : ''}，可用 Ctrl + Z 撤销。` });
      return true;
    } catch (error) {
      setBooleanFeedback({ ok: false, message: error instanceof Error ? error.message : '变换未完成，请检查参数。' });
      return false;
    }
  }, [shapes, selectedIds]);

  const handleCreatePrecisionPrimitive = useCallback((spec: PrecisionPrimitiveSpec) => {
    try {
      const shape = createPrecisionPrimitive(spec);
      const baseName = shape.name;
      let suffix = 2;
      while (shapes.some((existing) => existing.name === shape.name)) shape.name = `${baseName} (${suffix++})`;
      handleCreateShape(shape);
      setActiveTool('select');
      setBooleanFeedback({ ok: true, message: `已按尺寸创建${spec.kind === 'box' ? '长方体' : '圆柱体'}。` });
      setFitRequest((value) => value + 1);
      return true;
    } catch (error) {
      setBooleanFeedback({ ok: false, message: error instanceof Error ? error.message : '创建失败，请检查尺寸。' });
      return false;
    }
  }, [handleCreateShape, shapes]);

  const handleChangeTool = useCallback((tool: DrawTool2D) => {
    const drawing = tool !== 'select' && tool !== 'measure';
    drawingCommandRef.current = drawing;
    setDrawingActive(drawing);
    if (drawing) {
      lastDrawingToolRef.current = tool;
      setBooleanFeedback((feedback) => feedback?.ok ? null : feedback);
      setBooleanPreview(null);
      setShowRestoreNotice(false);
      setSelectedIds([]);
    }
    setActiveTool(tool);
    if (tool !== 'select') {
      setLayoutMode('2d-only');
      requestAnimationFrame(() => document.querySelector<HTMLCanvasElement>('[data-testid="cad-2d-canvas"]')?.focus({ preventScroll: true }));
    }
  }, []);

  const openToolPanel = useCallback((panel: 'create' | 'properties' | 'boolean' | 'transform', mode?: 'move' | 'rotate' | 'scale') => {
    setCleanScreen(false);
    setPanelRequest((previous) => ({ panel, mode, nonce: (previous?.nonce ?? 0) + 1 }));
  }, []);

  const selectedPointPair = selectedIds.length === 2
    ? selectedIds.map((id) => shapes.find((shape) => shape.id === id))
    : [];
  const canConnectPoints = !drawingActive && selectedPointPair.length === 2 &&
    selectedPointPair.every((shape) => shape?.visible && shape.type === 'point' && shape.points.length === 1);
  const handleConnectPoints = useCallback(() => {
    const currentShapes = historyRef.current.present;
    const points = selectedIds.map((id) => currentShapes.find((shape) => shape.id === id));
    if (points.length !== 2 || points.some((shape) => !shape?.visible || shape.type !== 'point' || shape.points.length !== 1)) {
      setBooleanFeedback({ ok: false, message: '请先选择两个可见定位点，再连接两点。' });
      return;
    }
    const [first, second] = points as [CadShape, CadShape];
    if (currentShapes.some((shape) => shape.endpointIds?.includes(first.id) && shape.endpointIds.includes(second.id))) {
      setBooleanFeedback({ ok: false, message: '这两个点已经连接，无需重复创建直线。' });
      return;
    }
    if (Math.abs(first.zOffset - second.zOffset) > 1e-8) {
      setBooleanFeedback({ ok: false, message: '两点的 Z 坐标不同；请先调整到同一 XY 平面再连接。' });
      return;
    }
    if (Math.hypot(second.points[0].x - first.points[0].x, second.points[0].y - first.points[0].y) <= 1e-8) {
      setBooleanFeedback({ ok: false, message: '两点位置重合，无法生成有效直线。' });
      return;
    }
    try {
      const usedNames = new Set(currentShapes.map((shape) => shape.name));
      const baseName = `连线 (${first.name} → ${second.name})`;
      let name = baseName;
      for (let suffix = 2; usedNames.has(name); suffix++) name = `${baseName} (${suffix})`;
      const segment: CadShape = { ...createSketchLineShape(first.points[0], second.points[0], name), zOffset: first.zOffset, endpointIds: [first.id, second.id] };
      handleCreateShape(segment);
      handleChangeTool('select');
      setBooleanFeedback({ ok: true, message: '已连接两点。移动端点会同步更新相连直线，可整体撤销。' });
    } catch (error) {
      setBooleanFeedback({ ok: false, message: error instanceof Error ? error.message : '无法连接这两个点。' });
    }
  }, [selectedIds, handleCreateShape, handleChangeTool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"]'));
      if (modifier && key === 'k' && !canvasInteractionRef.current && !drawingCommandRef.current && !helpOpen && !isExportModalOpen && !dxfFile) {
        event.preventDefault(); setCommandOpen((open) => !open); return;
      }
      if (helpOpen || isExportModalOpen || commandOpen || optionsOpen || dxfFile) return;
      if (modifier && ['0', '1', '9'].includes(key)) {
        event.preventDefault();
        if (canvasInteractionRef.current || event.repeat) return;
        if (key === '0') setCleanScreen(value => !value);
        else if (key === '1') { setCleanScreen(false); setInspectorOpen(value => !value); }
        else setCommandLineOpen(value => !value);
        return;
      }
      if (key === 'f1') { event.preventDefault(); if (!canvasInteractionRef.current) setHelpOpen(true); return; }
      if (modifier && key === 's') {
        event.preventDefault();
        if (editing) target?.blur();
        requestAnimationFrame(() => {
          downloadProject(historyRef.current.present);
          setBooleanFeedback({ ok: true, message: '工程文件已生成，请查看浏览器下载。' });
        });
        return;
      }
      if (modifier && key === 'o') { event.preventDefault(); if (!canvasInteractionRef.current && !drawingCommandRef.current) void handleOpenProject(); return; }
      if (editing || event.altKey) return;
      if (canvasInteractionRef.current && key !== 'escape') { event.preventDefault(); return; }
      // The drawing command handles its keys in the canvas capture phase.
      // Do not let an unhandled command key edit unrelated existing objects.
      if (drawingCommandRef.current) {
        if ((modifier && ['z', 'y', 'a', 'd', 'k'].includes(key)) || key === 'delete' || key === 'backspace') event.preventDefault();
        return;
      }
      if (modifier) {
        if (key === 'z') { event.preventDefault(); event.shiftKey ? handleRedo() : handleUndo(); }
        else if (key === 'y') { event.preventDefault(); handleRedo(); }
        else if (key === 'a') { event.preventDefault(); handleSelectAllShapes(); }
        else if (key === 'd') { event.preventDefault(); handleDuplicateShape(); }
        return;
      }
      if ((key === 'enter' || key === ' ') && activeTool === 'select' && lastDrawingToolRef.current && !target?.closest('button, a, [role="button"], [role="menuitem"]')) {
        event.preventDefault();
        if (!event.repeat) handleChangeTool(lastDrawingToolRef.current);
      }
      else if (/^[a-z_]$/.test(key)) {
        event.preventDefault();
        if (!event.repeat) { setCommandDraft(value => value + event.key); setCommandError(''); setCommandLineOpen(true); requestAnimationFrame(() => commandInputRef.current?.focus()); }
      }
      else if (key === 'delete' || key === 'backspace') { event.preventDefault(); handleDeleteShape(); }
      else if (key === 'escape') { event.preventDefault(); setBooleanPreview(null); setSelectedIds([]); setActiveTool('select'); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTool, commandOpen, optionsOpen, helpOpen, isExportModalOpen, dxfFile, handleUndo, handleRedo, handleSelectAllShapes, handleDuplicateShape, handleDeleteShape, handleChangeTool, handleOpenProject]);

  const selectedEditableCount = shapes.filter((shape) => selectedIds.includes(shape.id) && !shape.locked).length;
  const commands: CadCommand[] = [
    { id: 'create', label: '按尺寸创建长方体 / 圆柱', group: '创建', keywords: 'box cylinder 坐标 精确 参数', run: () => openToolPanel('create') },
    { id: 'point', label: '创建定位点', group: '草图', keywords: 'POINT 点 坐标 reference', run: () => handleChangeTool('point') },
    { id: 'connect-points', label: '连接所选两点', group: '草图', keywords: 'LINE 两点连线 草图线', disabled: !canConnectPoints, run: handleConnectPoints },
    ...([{ id: 'select', label: '选择对象', key: 'V ↵' }, { id: 'rect', label: '绘制矩形', key: 'REC ↵' }, { id: 'circle', label: '绘制圆形', key: 'C ↵' }, { id: 'line', label: '点线一体绘制', key: 'L ↵' }, { id: 'polyline', label: '绘制多边形', key: 'PL ↵' }, { id: 'measure', label: 'XY 两点测量', key: 'DI ↵' }] as const).map((tool) => ({ id: tool.id, label: tool.label, group: '草图', shortcut: tool.key, run: () => handleChangeTool(tool.id) })),
    { id: 'transform', label: '精确移动 / 旋转 / 等比缩放', group: '修改', keywords: 'move rotate scale 复制 变换', disabled: selectedEditableCount === 0, run: () => openToolPanel('transform') },
    ...(['move', 'rotate', 'scale'] as const).map((mode, index) => ({ id: mode, label: ['移动', '旋转', '缩放'][index], group: '修改', shortcut: ['M ↵', 'RO ↵', 'SC ↵'][index], disabled: selectedEditableCount === 0, run: () => openToolPanel('transform', mode) })),
    { id: 'inspector', label: '显示 / 隐藏属性面板', group: '视图', shortcut: 'Ctrl 1', run: () => { setCleanScreen(false); setInspectorOpen(value => !value); } },
    { id: 'clean', label: '清屏编辑', group: '视图', shortcut: 'Ctrl 0', run: () => setCleanScreen(value => !value) },
    { id: 'help', label: '快捷键与操作指南', group: '帮助', shortcut: 'F1', run: () => setHelpOpen(true) },
    { id: 'properties', label: '编辑尺寸与对齐', group: '修改', disabled: selectedIds.length === 0, run: () => openToolPanel('properties') },
    { id: 'boolean', label: '布尔并集 / 交集 / 差集', group: '修改', run: () => openToolPanel('boolean') },
    { id: 'duplicate', label: '复制所选对象', group: '修改', shortcut: 'Ctrl D', disabled: selectedIds.length === 0, run: () => handleDuplicateShape() },
    { id: 'delete', label: '删除未锁定的所选对象', group: '修改', shortcut: 'Delete', disabled: selectedEditableCount === 0, run: () => handleDeleteShape() },
    { id: 'undo', label: '撤销', group: '编辑', shortcut: 'Ctrl Z', disabled: drawingActive || !canUndo(history), run: handleUndo },
    { id: 'redo', label: '重做', group: '编辑', shortcut: 'Ctrl Y', disabled: drawingActive || !canRedo(history), run: handleRedo },
    { id: 'lock', label: '锁定所选对象', group: '对象', disabled: selectedIds.length === 0, run: () => handleLockObjects(selectedIds, true) },
    { id: 'unlock', label: '解锁所选对象', group: '对象', disabled: selectedIds.length === 0, run: () => handleLockObjects(selectedIds, false) },
    { id: 'isolate', label: '仅显示所选对象', group: '对象', keywords: '隔离 isolate', disabled: selectedIds.length === 0, run: () => handleVisibilityCommand('isolate') },
    { id: 'hide', label: '隐藏所选对象', group: '对象', disabled: selectedIds.length === 0, run: () => handleVisibilityCommand('hide-selected') },
    { id: 'show', label: '显示全部对象', group: '对象', run: () => handleVisibilityCommand('show-all') },
    { id: 'fit', label: '适合当前视图', group: '视图', shortcut: 'F', run: () => setFitRequest((value) => value + 1) },
    { id: 'model', label: '切换三维模型', group: '视图', run: () => setLayoutMode('3d-only') },
    { id: 'sketch', label: '切换二维草图', group: '视图', run: () => setLayoutMode('2d-only') },
    { id: 'split', label: '切换双视图', group: '视图', run: () => setLayoutMode('split') },
    { id: 'save', label: '保存工程文件', group: '文件', shortcut: 'Ctrl S', run: handleSaveProject },
    { id: 'open', label: '打开工程文件', group: '文件', run: handleOpenProject },
    { id: 'import-dxf', label: '导入 DXF 点、直线与轮廓', group: '文件', keywords: 'import CAD 图纸 拉伸 POINT LINE', run: () => dxfInputRef.current?.click() },
    { id: 'export', label: '导出 STL / OBJ / DXF / SVG / 图纸', group: '文件', run: () => setIsExportModalOpen(true) },
  ];
  const visibleCount = shapes.filter((shape) => shape.visible).length;
  const executeCommand = () => {
    if (!commandDraft.trim()) {
      setCommandDraft(''); setCommandError('');
      if (lastDrawingToolRef.current) handleChangeTool(lastDrawingToolRef.current);
      return;
    }
    const command = commands.find(item => item.id === resolveCommandAlias(commandDraft));
    if (!command) { setCommandError('未知命令，请按 F1 查看快捷键。'); return; }
    if (command.disabled) { setCommandError('此命令当前不可用，请先选择可编辑对象。'); return; }
    setCommandDraft(''); setCommandError(''); commandInputRef.current?.blur(); command.run();
    requestAnimationFrame(() => document.querySelector<HTMLCanvasElement>('[data-testid="cad-2d-canvas"]')?.focus({ preventScroll: true }));
  };
  const filteredShapes = shapes.filter((shape) => shape.name.toLowerCase().includes(objectQuery.trim().toLowerCase()));

  return (
    <div className={`cad-app ${cleanScreen ? 'clean-screen' : ''}`} data-panel-layout={panelLayout}>
      <header className="app-header">
        <a className="brand" href="#workspace" onClick={(event) => { event.preventDefault(); setLayoutMode('3d-only'); }} aria-label={t("ExtrudeCAD 工作台")}>
          <span className="brand-mark"><Box size={20} strokeWidth={1.6} /></span>
          <span>Extrude<span className="brand-light">CAD</span></span><small>STUDIO</small>
        </a>
        <div className="header-divider" />
        <span className="document-label">{t("设计工作区")}</span>
        <nav className="view-switch" aria-label={t("工作区视图")}>
          <button aria-pressed={layoutMode === '3d-only'} onClick={() => setLayoutMode('3d-only')}><Box size={14} /><span>{t("模型")}</span></button>
          <button aria-pressed={layoutMode === '2d-only'} onClick={() => setLayoutMode('2d-only')}><Square size={14} /><span>{t("草图")}</span></button>
          <button aria-pressed={layoutMode === 'split'} onClick={() => setLayoutMode('split')} title={t("同时查看二维草图与三维模型")}><SplitSquareHorizontal size={14} /><span>{t("双视图")}</span></button>
        </nav>
        <div className="header-actions">
          <button className="quiet-button options-trigger" aria-label={t("打开工作区选项")} onClick={() => setOptionsOpen(true)}>{t("选项")}</button>
          <button className="icon-button clean-trigger" aria-label={t("清屏编辑")} title={t("清屏编辑 · Ctrl+0")} onClick={() => setCleanScreen(true)}><Maximize2 size={16} /></button>
          <button className="quiet-button command-trigger" title={t("搜索命令 Ctrl+K")} aria-label={t("打开命令搜索")} onClick={() => setCommandOpen(true)}><Search size={15} /><span>{t("命令")}</span><kbd>Ctrl K</kbd></button>
          <button className="icon-button help-button" title={t("操作指南")} aria-label={t("打开操作指南")} onClick={() => setHelpOpen(true)}><HelpCircle size={17} /></button>
          <FileOpenMenu onOpenProject={handleOpenProject} onImportDxf={() => dxfInputRef.current?.click()} />
          <button className="quiet-button" onClick={handleSaveProject} title={t("下载可继续编辑的工程文件")}><Save size={15} /><span>{t("保存")}</span></button>
          <button className="primary-button" onClick={() => setIsExportModalOpen(true)}><Download size={15} /><span>{t("导出")}</span></button>
        </div>
      </header>
      <div className={`workbench-shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
        <aside className="model-sidebar" aria-label={t("模型浏览器")}>
          <div className="sidebar-heading"><span>{t("模型浏览器")}</span><button className="icon-button" aria-label={t("收起模型浏览器")} title={t("收起模型浏览器")} onClick={() => setSidebarOpen(false)}><PanelLeftClose size={15} /></button></div>
          <div className="scene-heading"><span><Layers3 size={14} />{" " + t("构件")}</span><span className="count-badge">{t(objectQuery ? `${filteredShapes.length} / ` : '')}{t(shapes.length)}</span></div>
          <div className="object-search"><Search size={13} /><input aria-label={t("搜索构件")} placeholder={t("搜索构件…")} value={objectQuery} onChange={(event) => setObjectQuery(event.target.value)} />{t(objectQuery && <button aria-label={t("清空构件搜索")} onClick={() => setObjectQuery('')}><X size={12} /></button>)}</div>
          <div className="object-actions">
            <button title={t("隐藏所选对象")} aria-label={t("隐藏所选对象")} disabled={!selectedIds.length} onClick={() => handleVisibilityCommand('hide-selected')}><EyeOff size={13} />{t("隐藏")}</button>
            <button title={t("仅显示所选对象")} aria-label={t("仅显示所选对象")} disabled={!selectedIds.length} onClick={() => handleVisibilityCommand('isolate')}><Focus size={13} />{t("隔离")}</button>
            <button title={t("显示全部对象")} aria-label={t("显示全部对象")} onClick={() => handleVisibilityCommand('show-all')}><Eye size={13} />{t("全部")}</button>
          </div>
          <div className="object-list">
            {t(shapes.length === 0 && <div className="empty-tree"><Box size={28} strokeWidth={1} /><p>{t("开始你的设计")}</p><small>{t("绘制轮廓，或添加一个基本体。")}</small></div>)}
            {t(shapes.length > 0 && filteredShapes.length === 0 && <p className="empty-search">{t("没有匹配的构件")}</p>)}
            {filteredShapes.map((shape) => <div key={shape.id} className={`object-row ${selectedIds.includes(shape.id) ? 'is-selected' : ''} ${shape.visible ? '' : 'is-hidden'}`}>
              <button className="object-select" aria-pressed={selectedIds.includes(shape.id)} onClick={(event) => handleSelectShape(shape.id, event.ctrlKey || event.metaKey, event.shiftKey)} title={shape.name}>
                <Box size={15} strokeWidth={1.5} /><span>{shape.name}</span>
              </button>
              <button className={`object-visibility object-lock ${shape.locked ? 'is-locked' : ''}`} aria-label={`${t(shape.locked ? '解锁' : '锁定')} ${shape.name}`} aria-pressed={!!shape.locked} title={t(shape.locked ? '解锁对象' : '锁定对象，防止编辑与删除')} onClick={() => handleLockObjects([shape.id], !shape.locked)}>{t(shape.locked ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />)}</button>
              <button className="object-visibility" aria-label={`${t(shape.visible ? '隐藏' : '显示')} ${shape.name}`} title={t(shape.visible ? '隐藏对象' : '显示对象')} onClick={() => handleObjectVisibility(shape.id, !shape.visible)}>{t(shape.visible ? <Eye size={13} /> : <EyeOff size={13} />)}</button>
            </div>)}
          </div>
          <div className="sidebar-add-actions"><button onClick={() => handleAddPrimitive('box')}><Plus size={13} />{" " + t("长方体")}</button><button onClick={() => handleAddPrimitive('cylinder')}><Plus size={13} />{" " + t("圆柱体")}</button></div>
          <div className="tree-note"><MousePointer2 size={13} /><span>{t("Ctrl 单击多选 · Shift 减选")}</span></div>
          <div className="sidebar-bottom"><button onClick={handleNewEmptyModel}><Plus size={14} />{" " + t("新建工程")}</button><button onClick={handleResetDemo}><RotateCcw size={14} />{" " + t("载入结构示例")}</button></div>
          <div className="sidebar-signature"><span>EXTRUDECAD</span><small>SKETCH · EXTRUDE · CREATE</small></div>
        </aside>
        <main id="workspace" className={`viewport-grid layout-${layoutMode}`}>
          {t(cleanScreen && <button className="exit-clean-screen quiet-button" aria-label={t("退出清屏编辑")} title={t("退出清屏编辑 · Ctrl+0")} onClick={() => setCleanScreen(false)}>{t("退出清屏 · Ctrl+0")}</button>)}
          {t(!cleanScreen && !inspectorOpen && <button className="reopen-inspector icon-button" aria-label={t("展开属性面板")} title={t("展开属性面板 · Ctrl+1")} onClick={() => setInspectorOpen(true)}><ChevronRight size={18} className="rotate-180" /></button>)}
          {t(!sidebarOpen && <button className="reopen-sidebar icon-button" aria-label={t("展开模型浏览器")} title={t("展开模型浏览器")} onClick={() => setSidebarOpen(true)}><PanelLeftOpen size={18} /></button>)}
          {t(showRestoreNotice && <div className="restore-toast" role="status"><Check size={15} /><span>{t("已恢复上次的本地工程")}</span><button aria-label={t("关闭恢复提示")} onClick={() => setShowRestoreNotice(false)}><X size={14} /></button></div>)}
          {t(!drawingActive && selectedIds.length > 1 && <div className="selection-summary" role="status"><Layers3 size={14} /><span>{t("已选") + " "}{t(selectedIds.length)}{" " + t("个对象")}</span><button onClick={() => setSelectedIds([])} aria-label={t("清除当前选择")}>{t("清除") + " "}<X size={12} /></button></div>)}
          {t(booleanFeedback && !booleanFeedback.ok && <div className="drawing-feedback" role="status"><span>{t(booleanFeedback.message)}</span><button type="button" className="icon-button" aria-label={t("关闭操作提示")} onClick={() => setBooleanFeedback(null)}><X size={14} /></button></div>)}
          <section aria-label={t("XY平面二维CAD草图编辑区")} className={`viewport-pane sketch-pane ${layoutMode === '3d-only' ? 'pane-hidden' : ''}`}>
          <Cad2DCanvas
            shapes={shapes}
            isActive={layoutMode !== '3d-only'}
            keyboardBlocked={helpOpen || isExportModalOpen || commandOpen || optionsOpen || Boolean(dxfFile)}
            fitRequest={fitRequest}
            onBeginGeometryDrag={handleBeginGeometryDrag}
            onCancelGeometryDrag={handleCancelGeometryDrag}
            onEndGeometryDrag={handleEndGeometryDrag}
            onInteractionChange={handleCanvasInteractionChange}
            onDrawingStateChange={handleDrawingStateChange}
            onUndoDrawingSegment={handleUndoDrawingSegment}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelectShape={handleSelectSingleShape}
            onSelectMultipleShapes={setSelectedIds}
            onSelectAll={handleSelectAllShapes}
            onUpdateShape={handleUpdateShape}
            onUpdateMultipleShapes={handleUpdateMultipleShapes}
            onCreateShape={handleCreateShape}
            onCreateShapes={handleCreateShapes}
            activeTool={activeTool}
            onChangeTool={handleChangeTool}
            defaultZHeight={defaultZHeight}
            snapEnabled={snapEnabled}
            gridStep={gridStep}
            onToggleSnap={() => setSnapEnabled((s) => !s)}
            onChangeGridStep={setGridStep}
            booleanPreview={booleanPreview?.resultShape ?? null}
          />
          </section>
          <section aria-label={t("三维Z轴拉伸实时预览区")} className={`viewport-pane model-pane ${layoutMode === '2d-only' ? 'pane-offscreen' : ''}`}>
          <Cad3DViewport
            shapes={shapes}
            fitRequest={fitRequest}
            selectedIds={selectedIds}
            onSelectShape={handleSelectShape}
            activeView={activeCameraView}
            onChangeView={setActiveCameraView}
            explodedFactor={0}
            wireframeOverlay={wireframeOverlay}
            onToggleWireframe={() => setWireframeOverlay((w) => !w)}
            onRegisterExporter={setExporterApi}
            gridStep={gridStep}
          />
          </section>
<div className="floating-tool-area"><BottomControlDock
        shapes={shapes}
        selectedId={selectedId}
        selectedIds={selectedIds}
        onSelectShape={handleSelectSingleShape}
        onSelectMultipleShapes={setSelectedIds}
        onSelectAll={handleSelectAllShapes}
        onClearSelection={() => setSelectedIds([])}
        onUpdateShape={handleUpdateShape}
        onUpdateMultipleShapes={handleUpdateMultipleShapes}
        onDeleteShape={handleDeleteShape}
        onDuplicateShape={handleDuplicateShape}
        onAddPrimitive={handleAddPrimitive}
        onCreatePrecisionPrimitive={handleCreatePrecisionPrimitive}
        onTransformSelection={handleTransformSelection}
        panelRequest={panelRequest}
        onBooleanOperation={handleBooleanOperation}
        onBooleanPreview={handleBooleanPreview}
        booleanPreviewActive={booleanPreview !== null}
        onCommitBooleanPreview={handleCommitBooleanPreview}
        onCancelBooleanPreview={handleCancelBooleanPreview}
        onRestoreBoolean={handleRestoreBoolean}
        onMirrorShapes={handleMirrorShapes}
        onRectArray={handleRectArray}
        onPolarArray={handlePolarArray}
        booleanFeedback={drawingActive ? null : booleanFeedback}
        onClearBooleanFeedback={() => setBooleanFeedback(null)}
        onNewEmptyModel={handleNewEmptyModel}
        onResetDemo={handleResetDemo}
        activeTool={activeTool}
        drawingActive={drawingActive}
        canConnectPoints={canConnectPoints}
        onConnectPoints={handleConnectPoints}
        onChangeTool={handleChangeTool}
        defaultZHeight={defaultZHeight}
        onChangeDefaultZHeight={setDefaultZHeight}
        canUndo={!drawingActive && canUndo(history)}
        canRedo={!drawingActive && canRedo(history)}
        undoCount={history.past.length}
        redoCount={history.future.length}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
</div>
          {t(!drawingActive && commandLineOpen && <form className="cad-command-line" onSubmit={event => { event.preventDefault(); executeCommand(); }}>
            <label htmlFor="cad-command-input">{t("命令：")}</label><input id="cad-command-input" ref={commandInputRef} aria-label={t("CAD命令输入")} placeholder={t("L / REC / C / M / CO / RO / SC / DI，回车执行")} autoComplete="off" value={commandDraft} onChange={event => { setCommandDraft(event.target.value); setCommandError(''); }} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); setCommandDraft(''); setCommandError(''); event.currentTarget.blur(); document.querySelector<HTMLCanvasElement>('[data-testid="cad-2d-canvas"]')?.focus(); } if (event.key === ' ') { event.preventDefault(); executeCommand(); } }} />
            <button type="submit" title={t("执行命令")}>↵</button>{t(commandError && <span role="alert">{t(commandError)}</span>)}
          </form>)}
        </main>
        <Inspector shapes={shapes} selectedIds={selectedIds} onUpdateShape={handleUpdateShape} onUpdateMultipleShapes={handleUpdateMultipleShapes} onDuplicate={() => handleDuplicateShape()} onDelete={() => handleDeleteShape()} onCollapse={() => setInspectorOpen(false)} />
      </div>
      <footer className="app-statusbar">
        <span className={`save-state ${saveStatus === 'failed' ? 'save-failed' : ''}`}><span className="status-dot" />{t(saveStatus === 'pending' ? '正在保存…' : saveStatus === 'saved' ? '已自动保存' : '自动保存不可用，请下载工程')}</span>
        <span className="footer-hint">{t(activeTool === 'point' ? '定位点 · 单击或输入 x,y · U↵撤点' : activeTool === 'line' ? '点线一体 · 首击落点 → 连续连线 · Enter结束' : activeTool === 'rect' ? '矩形 · 单击两个对角点' : activeTool === 'circle' ? '圆心 → 半径点 · D↵切换直径' : activeTool === 'triangle' ? '三角形 · 两角点定义宽高' : activeTool === 'polyline' ? '逐点绘制闭合面 · C↵闭合' : activeTool === 'measure' ? 'XY 两点测量 · Esc 结束' : drawingActive ? '选择/夹点编辑 · Esc取消当前操作' : layoutMode === '2d-only' ? '单击空白取消选择 · 拖动框选 · 滚轮缩放' : '左键旋转 · 右键平移 · 滚轮缩放')}<span>│</span>{t("Z↵ 适合视图")}</span>
        <span className="scene-stats">{t(visibleCount)} / {t(shapes.length)}{" " + t("构件可见")}<span className="units-pill">mm</span></span>
      </footer>
      <ExportViewsModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} shapes={shapes} exporterApi={exporterApi} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} commands={commands} />
      <WorkspaceOptions open={optionsOpen} onClose={() => setOptionsOpen(false)} layout={panelLayout} onLayoutChange={setPanelLayout} onFit={() => setFitRequest(v => v + 1)} />
      <input ref={dxfInputRef} type="file" accept=".dxf" aria-label={t("选择 DXF 文件")} hidden onChange={handleDxfFile} />
      <DxfImportDialog file={dxfFile} onClose={() => setDxfFile(null)} onImport={handleImportDxf} />
      {t(helpOpen && <div className="help-backdrop" onClick={() => setHelpOpen(false)} onKeyDown={(event) => { if (event.key === 'Escape') setHelpOpen(false); }}>
        <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}>
          <button className="icon-button help-close" aria-label={t("关闭操作指南")} autoFocus onClick={() => setHelpOpen(false)}><X size={19} /></button>
          <span className="section-eyebrow">QUICK START</span><h2 id="help-title">{t("从草图，到立体。")}</h2><p className="help-intro">{t("点击落点，输入尺寸，沿 Z 轴拉伸。")}</p>
          <ol className="help-steps"><li><b>01</b><div><strong>{t("点选绘制")}</strong><p>{t("点击“点”可放置或输入坐标创建独立定位点。Ctrl 单击选中两个点，再点“连接两点”。L / 点线：首击落点，随后每次单击连续连线；已有点自动复用。移动点或拖直线端点时，相连直线同步更新。R：两个对角点创建矩形。C：圆心与半径点；圆心确定后输入 D 并回车切换直径。P：至少三个有效顶点创建闭合多边形面。")}</p></div></li><li><b>02</b><div><strong>{t("完成、撤回与重复")}</strong><p>{t("定位点或连续线输入 U 并回车撤回；连续线输入 C 并回车闭合，首末线共用起点。P 中 U 撤顶点、C 闭合为面。空输入时 Enter / 空格或右键完成，Esc 取消未提交预览并保留已提交线段。结束后，Enter / 空格重复上次绘图工具；LINE 等待起点时再按一次空 Enter / 空格，从最近存活直线的末端续画。在空闲画布输入命令别名并按回车执行，例如 L、REC、C、PO；M 移动，DI 测量。中键或 Alt + 左键拖动平移，编辑视图内滚轮缩放，也可使用上方按钮或百分比。")}</p></div></li><li><b>03</b><div><strong>{t("精确输入与保存")}</strong><p>{t("绘图时直接输入坐标 x,y、相对位移 @dx,dy，或长度与角度 @长度<角度，再回车；矩形可输入宽×高。选中对象后可调整尺寸与拉伸高度。保存工程便于继续编辑；导出支持 STL、OBJ、DXF、SVG 与工程视图。")}</p></div></li><li><b>04</b><div><strong>{t("选择与夹点编辑")}</strong><p>{t("单击空白处取消选择；按住左键拖动才出现选框，松手完成。白色实线为左→右包含选，白色虚线为右→左交叉选。普通框选替换选择，Ctrl框选追加，Shift点选或框选减选。拖框时Esc或右键取消本次框选并保留原选择；空闲时Esc清空选择。先选中点或草图直线，再单击蓝色夹点并松开，激活红色夹点。移动鼠标看虚线预览，点目标或输入数值回车确认。端点默认拉伸、中点默认移动；空 Enter / 空格依次切换拉伸、移动、旋转、缩放、镜像。旋转输入角度，缩放输入倍率，镜像输入轴角度。Esc 或 Ctrl+Z 取消当前夹点并保留选择；再次 Ctrl+Z 才撤销已提交操作。按住夹点直接拖动也可编辑。")}</p></div></li></ol>
          <div className="shortcut-list"><span>{t("清屏编辑")}<kbd>Ctrl 0</kbd></span><span>{t("属性面板")}<kbd>Ctrl 1</kbd></span><span>{t("命令输入栏")}<kbd>Ctrl 9</kbd></span><span>{t("移动 / 旋转 / 缩放")}<kbd>M / RO / SC ↵</kbd></span><span>{t("复制 / 删除")}<kbd>CO / E ↵</kbd></span><span>{t("网格显示")}<kbd>F7</kbd></span><span>{t("点线 / 矩形") + " "}<kbd>L / REC ↵</kbd></span><span>{t("启动圆 / 多边形") + " "}<kbd>C / PL ↵</kbd></span><span>{t("选择 / 测量") + " "}<kbd>V / DI ↵</kbd></span><span>{t("完成 / 重复绘图") + " "}<kbd>{t("Enter / 空格")}</kbd></span><span>{t("撤绘图最近一步") + " "}<kbd>U↵ / Ctrl Z</kbd></span><span>{t("闭合线 / 多边形") + " "}<kbd>C↵</kbd></span><span>{t("切换圆直径模式") + " "}<kbd>D↵</kbd></span><span>{t("取消未提交预览") + " "}<kbd>Esc</kbd></span><span>{t("对象捕捉") + " "}<kbd>F3</kbd></span><span>{t("正交 / 临时反转") + " "}<kbd>F8 / Shift</kbd></span><span>{t("网格吸附") + " "}<kbd>F9</kbd></span><span>{t("适合视图") + " "}<kbd>Z ↵</kbd></span><span>{t("命令搜索") + " "}<kbd>Ctrl K</kbd></span><span>{t("保存工程") + " "}<kbd>Ctrl S</kbd></span><span>{t("模型撤销 / 重做") + " "}<kbd>Ctrl Z / Y</kbd></span><span>{t("复制 / 全选") + " "}<kbd>Ctrl D / A</kbd></span><span>{t("删除未锁对象") + " "}<kbd>Delete</kbd></span></div>
          <p className="help-note">{t("点线工具与“连接两点”建立端点关联，移动点联动相连直线；复制线会复制独立端点，删除点会同时删除相连直线。已有独立草图线保持独立。点线仍在同一 XY 平面，无实体厚度。闭合面用于 Z 轴拉伸；已有直线墙仍为实体。点线可保存工程或导出 DXF / SVG；STL / OBJ 仅包含实体。圆以多段轮廓近似。↵ 表示按回车；普通输入框保留文本编辑操作，夹点输入框中的 Ctrl+Z 优先取消夹点。裸距离沿当前鼠标方向；@长度<角度 固定方向。夹点目前用于点和草图直线，尚不支持多热夹点、临时基点和夹点复制。工程保存在当前浏览器中，换设备前请下载工程文件。")}</p><button className="primary-button help-done" onClick={() => setHelpOpen(false)}>{t("开始建模") + " "}<ChevronRight size={16} /></button>
        </section>
      </div>)}
    </div>
  );
}
