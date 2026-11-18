/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Layers3, FolderOpen, Save, Download, PanelLeftClose, PanelLeftOpen, Eye, EyeOff, LockKeyhole, Plus, HelpCircle, X, SplitSquareHorizontal, Square, RotateCcw, ChevronRight, MousePointer2, Check } from 'lucide-react';
import {
  CadShape,
  CameraViewId,
  PrimitivePresetType,
  BooleanOperationType,
  BooleanOperationResult,
  createPrecisionDemoScene,
  createPrimitiveShape,
  createCleanTBeamPoints,
  translateShape2D,
  computeBooleanShapes,
  computeBounds2D,
  mirrorShape2D,
  createRectArrayCopies,
  createPolarArrayCopies,
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
} from './utils/historyManager';
import { Cad2DCanvas, DrawTool2D } from './components/Cad2DCanvas';
import { Cad3DViewport, Cad3DExporterApi } from './components/Cad3DViewport';
import { BottomControlDock } from './components/BottomControlDock';
import { ExportViewsModal } from './components/ExportViewsModal';
import { Inspector } from './components/Inspector';
import {
  downloadProject,
  pickProjectFile,
  saveProjectToLocal,
  loadProjectFromLocal,
} from './utils/projectFile';

export type WorkspaceLayoutMode = 'split' | '2d-only' | '3d-only';

export default function App() {
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
  const [showRestoreNotice, setShowRestoreNotice] = useState<boolean>(
    bootstrap.wasRestored,
  );

  const [selectedIds, setSelectedIds] = useState<string[]>(bootstrap.shapes[0] ? [bootstrap.shapes[0].id] : []);
  const selectedId = selectedIds[0] ?? null;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
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

  // Auto-dismiss the "restored from autosave" toast
  useEffect(() => {
    if (!showRestoreNotice) return;
    const timer = setTimeout(() => setShowRestoreNotice(false), 4500);
    return () => clearTimeout(timer);
  }, [showRestoreNotice]);

  const handleSelectSingleShape = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : []);
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
        const next = prev.present.filter((s) => !idsToRemove.has(s.id));
        setSelectedIds(next[next.length - 1] ? [next[next.length - 1].id] : []);
        return pushHistoryState(prev, next);
      });
    },
    [selectedIds],
  );

  // Keyboard shortcuts for Undo (Ctrl+Z), Redo (Ctrl+Y), Select All (Ctrl+A), and Delete (Delete/Backspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAllShapes();
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedIds.length > 0
      ) {
        e.preventDefault();
        handleDeleteShape();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleSelectAllShapes,
    handleDeleteShape,
    selectedIds,
  ]);

  const handleUpdateShape = useCallback(
    (updated: CadShape, transient = false) => {
      setHistory((prev) => {
        const nextShapes = prev.present.map((s) =>
          s.id === updated.id ? updated : s,
        );
        return transient
          ? replaceHistoryPresent(prev, nextShapes)
          : pushHistoryState(prev, nextShapes);
      });
    },
    [],
  );

  const handleUpdateMultipleShapes = useCallback(
    (nextShapes: CadShape[], transient = false) => {
      setHistory((prev) =>
        transient
          ? replaceHistoryPresent(prev, nextShapes)
          : pushHistoryState(prev, nextShapes),
      );
    },
    [],
  );

  const handleCreateShape = useCallback((newShape: CadShape) => {
    setHistory((prev) => pushHistoryState(prev, [...prev.present, newShape]));
    setSelectedIds([newShape.id]);
  }, []);

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
        const copies: CadShape[] = [];
        targetIds.forEach((tid, idx) => {
          const target = prev.present.find((s) => s.id === tid);
          if (!target) return;
          const shifted = translateShape2D(target, 14, -14);
          copies.push({
            ...shifted,
            id: `shape-copy-${Date.now()}-${idx}`,
            name: `${target.name} (副本)`,
          });
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

  const [booleanFeedback, setBooleanFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Boolean preview state: 预览结果只以虚线显示，确认后才进入历史记录
  const [booleanPreview, setBooleanPreview] = useState<{
    op: BooleanOperationType;
    targetId: string;
    toolId: string;
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

      const res = computeBooleanShapes(shapeA, shapeB, op, {
        autoAlignDisjoint: true,
      });

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

  const handleBooleanPreview = useCallback(
    (op: BooleanOperationType, targetId: string, toolId: string) => {
      const shapeA = shapes.find((s) => s.id === targetId);
      const shapeB = shapes.find((s) => s.id === toolId);
      if (!shapeA || !shapeB || shapeA.id === shapeB.id) {
        setBooleanFeedback({
          ok: false,
          message: '请先选择 2 个不同的图形再预览布尔运算。',
        });
        return;
      }
      const res = computeBooleanShapes(shapeA, shapeB, op, {
        autoAlignDisjoint: true,
      });
      if (res.ok && res.resultShape) {
        setBooleanPreview({
          op,
          targetId,
          toolId,
          resultShape: res.resultShape,
          message: res.message,
        });
        setBooleanFeedback(null);
      } else {
        setBooleanPreview(null);
        setBooleanFeedback({ ok: false, message: res.message });
      }
    },
    [shapes],
  );

  const handleCommitBooleanPreview = useCallback(() => {
    if (!booleanPreview) return;
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
  }, [booleanPreview]);

  const handleCancelBooleanPreview = useCallback(() => {
    setBooleanPreview(null);
  }, []);

  // 预览依赖的源图形被删除/撤销后，自动清理失效预览
  useEffect(() => {
    if (!booleanPreview) return;
    const aExists = shapes.some((s) => s.id === booleanPreview.targetId);
    const bExists = shapes.some((s) => s.id === booleanPreview.toolId);
    if (!aExists || !bExists) setBooleanPreview(null);
  }, [shapes, booleanPreview]);

  // 还原布尔：删除结果图形，恢复两个操作数的可见性
  const handleRestoreBoolean = useCallback(
    (resultId: string) => {
      const resultShape = shapes.find((s) => s.id === resultId);
      const meta = resultShape?.booleanMeta;
      if (!meta) return;
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
          const copies = targets.map((s, i) => {
            const mirrored = mirrorShape2D(s, axis, 0);
            return {
              ...mirrored,
              id: `shape-mirror-${Date.now()}-${i}`,
              name: `${s.name.replace(/\s*\(.*\)/, '')} (镜像)`,
              booleanMeta: undefined,
              locked: false,
            };
          });
          setSelectedIds(copies.map((c) => c.id));
          return pushHistoryState(prev, [...prev.present, ...copies]);
        }
        const idSet = new Set(targets.map((t) => t.id));
        const next = prev.present.map((s) => {
          if (!idSet.has(s.id)) return s;
          const b = computeBounds2D(s.points);
          // 以包围盒中心为轴，镜像后包围盒位置严格不变
          const pivot =
            axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2;
          return mirrorShape2D(s, axis, pivot);
        });
        return pushHistoryState(prev, next);
      });
      setBooleanFeedback({
        ok: true,
        message: asCopy
          ? `已生成 ${targets.length} 个镜像副本（绕原点${axis === 'x' ? '竖直轴 X=0' : '水平轴 Y=0'}翻转）。`
          : `已原地${axis === 'x' ? '左右' : '上下'}镜像 ${targets.length} 个图形。`,
      });
    },
    [shapes, selectedIds],
  );

  // 矩形阵列
  const handleRectArray = useCallback(
    (rows: number, cols: number, gapX: number, gapY: number) => {
      const targets = shapes.filter(
        (s) => selectedIds.includes(s.id) && s.visible,
      );
      const copies = createRectArrayCopies(targets, { rows, cols, gapX, gapY });
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
        (s) => selectedIds.includes(s.id) && s.visible,
      );
      const copies = createPolarArrayCopies(targets, {
        count,
        totalAngleDeg,
        center: { x: centerX, y: centerY },
      });
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

  const visibleCount = shapes.filter((shape) => shape.visible).length;

  return (
    <div className="cad-app">
      <header className="app-header">
        <a className="brand" href="#workspace" onClick={(event) => { event.preventDefault(); setLayoutMode('3d-only'); }} aria-label="ExtrudeCAD 工作台">
          <span className="brand-mark"><Box size={20} strokeWidth={1.6} /></span>
          <span>Extrude<span className="brand-light">CAD</span></span><small>STUDIO</small>
        </a>
        <div className="header-divider" />
        <span className="document-label">设计工作区</span>
        <nav className="view-switch" aria-label="工作区视图">
          <button aria-pressed={layoutMode === '3d-only'} onClick={() => setLayoutMode('3d-only')}><Box size={14} /><span>模型</span></button>
          <button aria-pressed={layoutMode === '2d-only'} onClick={() => setLayoutMode('2d-only')}><Square size={14} /><span>草图</span></button>
          <button aria-pressed={layoutMode === 'split'} onClick={() => setLayoutMode('split')} title="同时查看二维草图与三维模型"><SplitSquareHorizontal size={14} /><span>双视图</span></button>
        </nav>
        <div className="header-actions">
          <button className="icon-button help-button" title="操作指南" aria-label="打开操作指南" onClick={() => setHelpOpen(true)}><HelpCircle size={17} /></button>
          <button className="quiet-button" onClick={handleOpenProject} title="打开 .extrudecad.json 文件"><FolderOpen size={15} /><span>打开</span></button>
          <button className="quiet-button" onClick={handleSaveProject} title="下载可继续编辑的工程文件"><Save size={15} /><span>保存</span></button>
          <button className="primary-button" onClick={() => setIsExportModalOpen(true)}><Download size={15} /><span>导出</span></button>
        </div>
      </header>
      <div className={`workbench-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <aside className="model-sidebar" aria-label="模型浏览器">
          <div className="sidebar-heading"><span>模型浏览器</span><button className="icon-button" aria-label="收起模型浏览器" title="收起模型浏览器" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={15} /></button></div>
          <div className="scene-heading"><span><Layers3 size={14} /> 构件</span><span className="count-badge">{shapes.length}</span></div>
          <div className="object-list">
            {shapes.length === 0 && <div className="empty-tree"><Box size={28} strokeWidth={1} /><p>开始你的设计</p><small>绘制轮廓，或添加一个基本体。</small></div>}
            {shapes.map((shape) => <div key={shape.id} className={`object-row ${selectedIds.includes(shape.id) ? 'is-selected' : ''} ${shape.visible ? '' : 'is-hidden'}`}>
              <button className="object-select" aria-pressed={selectedIds.includes(shape.id)} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey) setSelectedIds((ids) => ids.includes(shape.id) ? ids.filter((id) => id !== shape.id) : [...ids, shape.id]); else handleSelectSingleShape(shape.id); }} title={shape.name}>
                <Box size={15} strokeWidth={1.5} /><span>{shape.name}</span>{shape.locked && <LockKeyhole size={11} />}
              </button>
              <button className="object-visibility" aria-label={`${shape.visible ? '隐藏' : '显示'} ${shape.name}`} title={shape.visible ? '隐藏对象' : '显示对象'} onClick={() => handleUpdateShape({ ...shape, visible: !shape.visible })}>{shape.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            </div>)}
          </div>
          <div className="sidebar-add-actions"><button onClick={() => handleAddPrimitive('box')}><Plus size={13} /> 长方体</button><button onClick={() => handleAddPrimitive('cylinder')}><Plus size={13} /> 圆柱体</button></div>
          <div className="tree-note"><MousePointer2 size={13} /><span>Ctrl / Shift + 单击多选</span></div>
          <div className="sidebar-bottom"><button onClick={handleNewEmptyModel}><Plus size={14} /> 新建工程</button><button onClick={handleResetDemo}><RotateCcw size={14} /> 载入结构示例</button></div>
          <div className="sidebar-signature"><span>EXTRUDECAD</span><small>SKETCH · EXTRUDE · CREATE</small></div>
        </aside>
        <main id="workspace" className={`viewport-grid layout-${layoutMode}`}>
          {!sidebarOpen && <button className="reopen-sidebar icon-button" aria-label="展开模型浏览器" title="展开模型浏览器" onClick={() => setSidebarOpen(true)}><PanelLeftOpen size={18} /></button>}
          {showRestoreNotice && <div className="restore-toast" role="status"><Check size={15} /><span>已恢复上次的本地工程</span><button aria-label="关闭恢复提示" onClick={() => setShowRestoreNotice(false)}><X size={14} /></button></div>}
          <section aria-label="XY平面二维CAD草图编辑区" className={`viewport-pane sketch-pane ${layoutMode === '3d-only' ? 'pane-hidden' : ''}`}>
          <Cad2DCanvas
            shapes={shapes}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelectShape={handleSelectSingleShape}
            onSelectMultipleShapes={setSelectedIds}
            onSelectAll={handleSelectAllShapes}
            onUpdateShape={handleUpdateShape}
            onUpdateMultipleShapes={handleUpdateMultipleShapes}
            onCreateShape={handleCreateShape}
            activeTool={activeTool}
            onChangeTool={setActiveTool}
            defaultZHeight={defaultZHeight}
            snapEnabled={snapEnabled}
            gridStep={gridStep}
            onToggleSnap={() => setSnapEnabled((s) => !s)}
            onChangeGridStep={setGridStep}
            booleanPreview={booleanPreview?.resultShape ?? null}
          />
          </section>
          <section aria-label="三维Z轴拉伸实时预览区" className={`viewport-pane model-pane ${layoutMode === '2d-only' ? 'pane-offscreen' : ''}`}>
          <Cad3DViewport
            shapes={shapes}
            selectedId={selectedId}
            onSelectShape={handleSelectSingleShape}
            activeView={activeCameraView}
            onChangeView={setActiveCameraView}
            explodedFactor={0}
            wireframeOverlay={wireframeOverlay}
            onToggleWireframe={() => setWireframeOverlay((w) => !w)}
            onRegisterExporter={setExporterApi}
            gridStep={gridStep}
          />
          </section>
<div className="floating-tool-area">      <BottomControlDock
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
        onBooleanOperation={handleBooleanOperation}
        onBooleanPreview={handleBooleanPreview}
        booleanPreviewActive={booleanPreview !== null}
        onCommitBooleanPreview={handleCommitBooleanPreview}
        onCancelBooleanPreview={handleCancelBooleanPreview}
        onRestoreBoolean={handleRestoreBoolean}
        onMirrorShapes={handleMirrorShapes}
        onRectArray={handleRectArray}
        onPolarArray={handlePolarArray}
        booleanFeedback={booleanFeedback}
        onClearBooleanFeedback={() => setBooleanFeedback(null)}
        onNewEmptyModel={handleNewEmptyModel}
        onResetDemo={handleResetDemo}
        activeTool={activeTool}
        onChangeTool={(tool) => { setActiveTool(tool); if (tool !== 'select') setLayoutMode('2d-only'); }}
        defaultZHeight={defaultZHeight}
        onChangeDefaultZHeight={setDefaultZHeight}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        undoCount={history.past.length}
        redoCount={history.future.length}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
</div>
        </main>
        <Inspector shapes={shapes} selectedIds={selectedIds} onUpdateShape={handleUpdateShape} onUpdateMultipleShapes={handleUpdateMultipleShapes} onDuplicate={() => handleDuplicateShape()} onDelete={() => handleDeleteShape()} />
      </div>
      <footer className="app-statusbar">
        <span className={`save-state ${saveStatus === 'failed' ? 'save-failed' : ''}`}><span className="status-dot" />{saveStatus === 'pending' ? '正在保存…' : saveStatus === 'saved' ? '已自动保存' : '自动保存不可用，请下载工程'}</span>
        <span className="footer-hint">{layoutMode === '2d-only' ? '拖动绘制 · 滚轮缩放' : '左键旋转 · 右键平移 · 滚轮缩放'}<span>│</span>Ctrl + Z 撤销</span>
        <span className="scene-stats">{visibleCount} / {shapes.length} 构件可见<span className="units-pill">mm</span></span>
      </footer>
      <ExportViewsModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} shapes={shapes} exporterApi={exporterApi} />
      {helpOpen && <div className="help-backdrop" onClick={() => setHelpOpen(false)} onKeyDown={(event) => { if (event.key === 'Escape') setHelpOpen(false); }}>
        <section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}>
          <button className="icon-button help-close" aria-label="关闭操作指南" autoFocus onClick={() => setHelpOpen(false)}><X size={19} /></button>
          <span className="section-eyebrow">QUICK START</span><h2 id="help-title">从草图，到立体。</h2><p className="help-intro">在同一个工作台完成绘制、拉伸与导出。</p>
          <ol className="help-steps"><li><b>01</b><div><strong>绘制或添加形体</strong><p>选择矩形、圆形等工具，在二维画布拖动绘制；也可以一键添加基本体。</p></div></li><li><b>02</b><div><strong>调整尺寸，查看三维</strong><p>选中对象，在右侧属性栏调整高度与尺寸。三维视图可拖动旋转、滚轮缩放。</p></div></li><li><b>03</b><div><strong>保存与导出</strong><p>保存工程可继续编辑；导出支持 STL、OBJ、DXF、SVG 与工程视图。</p></div></li></ol>
          <div className="shortcut-list"><span>撤销 <kbd>Ctrl Z</kbd></span><span>重做 <kbd>Ctrl Y</kbd></span><span>全选 <kbd>Ctrl A</kbd></span><span>删除 <kbd>Delete</kbd></span></div>
          <p className="help-note">适用于 XY 草图沿 Z 轴拉伸的轻量建模。工程保存在当前浏览器中；换设备或重要修改后，请下载工程文件。</p><button className="primary-button help-done" onClick={() => setHelpOpen(false)}>开始建模 <ChevronRight size={16} /></button>
        </section>
      </div>}
    </div>
  );
}
