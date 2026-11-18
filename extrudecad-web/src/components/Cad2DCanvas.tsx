import { t, useLocale } from '../i18n';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { measureXY } from '../utils/measurement';
import { parseDrawingPoint } from '../utils/drawingInput';
import { isSameHistoryItem } from '../utils/historyManager';
import { sketchDragAffectedIds } from '../utils/sketchGraph';
import { SelectionOperation, selectionOperation, updateSelection } from '../utils/selectionSet';
import { GRIP_MODES, GRIP_LABELS, GripSession, gripReferenceLength, previewGrip, lineContinuation } from '../utils/gripEditing';
import { ViewZoomControls } from './ViewZoomControls';
import { wheelZoom, zoomPanAt } from '../utils/viewZoom';
import {
  CadShape,
  Point2D,
  SmartSnapGuide,
  snapToGrid,
  findGeometrySnap,
  GeometrySnapResult,
  computeBounds2D,
  computeShapeDimensions,
  findClosestShapeEdge,
  computeMoveSnapGuides,
  computePointSnapGuides,
  computeBoxSelectedShapeIds,
  createRectanglePoints,
  createTrianglePoints,
  createRegularPolygonPoints,
  createPointShape,
  createSketchLineShape,
  validateClosedPolygonPoints,
  resizeShapeEdge2D,
  resizeLineWall2D,
  resizeCircleDiameter2D,
} from '../utils/cadEngine';
import {
  Grid,
  Maximize2,
  Check,
  X,
  Ruler,
  Magnet,
  HelpCircle,
  BoxSelect,
} from 'lucide-react';

export type DrawTool2D =
  | 'select'
  | 'point'
  | 'line'
  | 'rect'
  | 'triangle'
  | 'circle'
  | 'measure'
  | 'polyline';

type ResizeEdgeSide = 'left' | 'right' | 'top' | 'bottom';
interface DrawingStep {
  pointId: string;
  point: Point2D;
  zOffset: number;
  createdIds: string[];
  segmentId?: string;
}

interface Cad2DCanvasProps {
  shapes: CadShape[];
  selectedId: string | null;
  selectedIds?: string[];
  onSelectShape: (id: string | null) => void;
  onSelectMultipleShapes?: (ids: string[]) => void;
  onSelectAll?: () => void;
  onUpdateShape: (updated: CadShape, transient?: boolean) => void;
  onUpdateMultipleShapes?: (nextShapes: CadShape[], transient?: boolean) => void;
  onCreateShape: (newShape: CadShape) => void;
  onCreateShapes: (newShapes: CadShape[]) => void;
  /** Boolean preview outline (dashed, not committed) */
  booleanPreview?: CadShape | null;
  activeTool: DrawTool2D;
  onChangeTool: (tool: DrawTool2D) => void;
  defaultZHeight: number;
  snapEnabled: boolean;
  gridStep: number;
  onToggleSnap: () => void;
  onChangeGridStep: (step: number) => void;
  fitRequest?: number;
  isActive?: boolean;
  keyboardBlocked?: boolean;
  onBeginGeometryDrag?: () => void;
  onCancelGeometryDrag?: () => void;
  onEndGeometryDrag?: () => void;
  onInteractionChange?: (active: boolean) => void;
  onUndoDrawingSegment?: (createdIds: string[]) => boolean;
  onDrawingStateChange?: (active: boolean) => void;
}

export const Cad2DCanvas: React.FC<Cad2DCanvasProps> = ({
  shapes,
  selectedId,
  selectedIds: propSelectedIds,
  onSelectShape,
  onSelectMultipleShapes,
  onSelectAll,
  onUpdateShape,
  onUpdateMultipleShapes,
  onCreateShape,
  onCreateShapes,
  booleanPreview = null,
  activeTool,
  onChangeTool,
  defaultZHeight,
  snapEnabled,
  gridStep,
  onToggleSnap,
  fitRequest,
  isActive = true,
  keyboardBlocked = false,
  onBeginGeometryDrag,
  onCancelGeometryDrag,
  onEndGeometryDrag,
  onInteractionChange,
  onUndoDrawingSegment,
  onDrawingStateChange,
}) => {
  const locale = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [display, setDisplay] = useState(() => {
    const defaults = { pointStyle: 'cross', pointSize: 7, lineWidth: 1, nodes: false, names: false };
    try {
      const saved = JSON.parse(localStorage.getItem('extrudecad.sketch-display.v1') || '{}');
      return { pointStyle: ['dot', 'cross', 'circle'].includes(saved.pointStyle) ? saved.pointStyle : defaults.pointStyle,
        pointSize: [4, 7, 10, 12].includes(saved.pointSize) ? saved.pointSize : defaults.pointSize,
        lineWidth: [1, 1.5, 2, 3].includes(saved.lineWidth) ? saved.lineWidth : defaults.lineWidth,
        nodes: saved.nodes === true, names: saved.names === true };
    } catch { return defaults; }
  });
  useEffect(() => { try { localStorage.setItem('extrudecad.sketch-display.v1', JSON.stringify(display)); } catch { /* Session preference still works. */ } }, [display]);
  const linkedPointIds = useMemo(() => new Set(shapes.filter((s) => s.visible).flatMap((s) => s.endpointIds ?? [])), [shapes]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const dragHistoryPushedRef = useRef<boolean>(false);
  const activePointerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<Point2D>({ x: 0, y: 0 });
  const pointerCurrentRef = useRef({ clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, metaKey: false });
  const [dragStarted, setDragStarted] = useState(false);
  const dragSnapshotRef = useRef<{ shapes: CadShape[]; pan: Point2D } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const selectedIds = useMemo(
    () => propSelectedIds ?? (selectedId ? [selectedId] : []),
    [propSelectedIds, selectedId],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [zoom, setZoom] = useState<number>(2.8);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);
  const changeZoomPercent = (percent: number) => {
    const nextZoom = Math.min(2800, Math.max(0.00028, percent * 2.8 / 100));
    setPan(p => ({ x: p.x * nextZoom / zoom, y: p.y * nextZoom / zoom }));
    setZoom(nextZoom);
  };
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [cursorMm, setCursorMm] = useState<Point2D>({ x: 0, y: 0 });
  const [measurementPoints, setMeasurementPoints] = useState<Point2D[]>([]);
  const measurementEnd = measurementPoints[1] ?? cursorMm;
  const measurement = measurementPoints.length ? measureXY(measurementPoints[0], measurementEnd) : null;

  // CAD Dimension Annotation ('adaptive' = 隐性自适应, 'all' = 全显, 'hidden' = 关), Smart Snap & Mouse Guide states
  const [annotationMode, setAnnotationMode] = useState<'adaptive' | 'all' | 'hidden'>('adaptive');
  const showDimensions = annotationMode !== 'hidden';
  const [smartGuidesEnabled, setSmartGuidesEnabled] = useState<boolean>(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [showMouseGuide, setShowMouseGuide] = useState<boolean>(false);
  const [showEdgeListHud, setShowEdgeListHud] = useState<boolean>(false);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState<number | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<{
    shapeId: string | null;
    edgeIndex: number | null;
  }>({ shapeId: null, edgeIndex: null });
  const [activeSnapGuides, setActiveSnapGuides] = useState<SmartSnapGuide[]>([]);
  const [selectionModeLabel, setSelectionModeLabel] = useState<string>(
    '选整体图形 (点击内部选整体 / 空白拖拽框选)',
  );

  // Interactive states for drawing, moving, edge-pushing, vertex-resizing & marquee box selection
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [dragStartMm, setDragStartMm] = useState<Point2D | null>(null);
  // 几何捕捉（端点/中点/圆心）与拖画精确尺寸输入状态
  const [geometrySnap, setGeometrySnap] = useState<GeometrySnapResult | null>(null);
  const [sizeInput, setSizeInput] = useState<string>('');
  const drawingInputRef = useRef<HTMLInputElement | null>(null);
  const rawDrawingCursorRef = useRef<Point2D>({ x: 0, y: 0 });
  const drawingShiftRef = useRef(false);
  const [drawingError, setDrawingError] = useState('');
  const [objectSnapEnabled, setObjectSnapEnabled] = useState(true);
  const [orthoEnabled, setOrthoEnabled] = useState(false);
  const [diameterMode, setDiameterMode] = useState(false);
  const [drawingSteps, setDrawingSteps] = useState<DrawingStep[]>([]);
  const [hotGrip, setHotGrip] = useState<GripSession | null>(null);
  const hotGripRef = useRef<GripSession | null>(null);
  hotGripRef.current = hotGrip;
  const pendingGripRef = useRef<GripSession | null>(null);
  const [gripInput, setGripInput] = useState('');
  const [gripError, setGripError] = useState('');
  const gripInputRef = useRef<HTMLInputElement | null>(null);
  const gripPreview = useMemo(() => {
    if (!hotGrip) return { shapes: null, error: '' };
    try { return { shapes: previewGrip(hotGrip, cursorMm, gripInput), error: '' }; }
    catch (error) { return { shapes: null, error: error instanceof Error ? error.message : '无法变换夹点。' }; }
  }, [hotGrip, cursorMm, gripInput]);
  const gripGuide = useMemo(() => {
    if (!hotGrip || !gripPreview.shapes) return { target: cursorMm, label: '' };
    const { base, mode } = hotGrip;
    if (mode === 'move' || mode === 'stretch') {
      const before = hotGrip.snapshot.find(s => s.id === hotGrip.shapeId)!;
      const after = gripPreview.shapes.find(s => s.id === hotGrip.shapeId)!;
      const index = hotGrip.vertexIndex ?? 0;
      const dx = after.points[index].x - before.points[index].x, dy = after.points[index].y - before.points[index].y;
      return { target: { x: base.x + dx, y: base.y + dy }, label: `ΔX ${dx.toFixed(2)} · ΔY ${dy.toFixed(2)} · L ${Math.hypot(dx, dy).toFixed(2)} mm` };
    }
    const angle = Math.atan2(cursorMm.y - base.y, cursorMm.x - base.x);
    if (mode === 'scale') {
      const reference = gripReferenceLength(hotGrip);
      const factor = gripInput.trim() ? Number(gripInput) : Math.hypot(cursorMm.x - base.x, cursorMm.y - base.y) / reference;
      return { target: { x: base.x + Math.cos(angle) * reference * factor, y: base.y + Math.sin(angle) * reference * factor }, label: `倍率 ×${Number(factor.toFixed(4))}` };
    }
    const degrees = gripInput.trim() ? Number(gripInput) : angle * 180 / Math.PI;
    return { target: { x: base.x + Math.cos(degrees * Math.PI / 180) * 80 / zoom, y: base.y + Math.sin(degrees * Math.PI / 180) * 80 / zoom }, label: `${mode === 'mirror' ? '镜像轴' : '旋转'} ${degrees.toFixed(2)}°` };
  }, [hotGrip, gripPreview, cursorMm, gripInput, zoom]);
  const clearGrip = useCallback(() => {
    setHotGrip(null); pendingGripRef.current = null;
    setGripInput(''); setGripError(''); setGeometrySnap(null);
  }, []);
  const isDrawingTool = activeTool === 'point' || activeTool === 'line' || activeTool === 'rect' || activeTool === 'triangle' || activeTool === 'circle' || activeTool === 'polyline';
  const [draggingVertexIdx, setDraggingVertexIdx] = useState<number | null>(null);
  const [draggingHoleVertexIdx, setDraggingHoleVertexIdx] = useState<number | null>(null);
  const [draggingSingleEdge, setDraggingSingleEdge] = useState<{
    shapeId: string;
    edgeIndex: number;
    startMm: Point2D;
    origPoints: Point2D[];
  } | null>(null);
  const [draggingResizeEdge, setDraggingResizeEdge] = useState<{
    shapeId: string;
    side: ResizeEdgeSide;
    origPoints: Point2D[];
    origHolePoints?: Point2D[];
    origBounds: ReturnType<typeof computeBounds2D>;
  } | null>(null);
  const [draggingWholeShape, setDraggingWholeShape] = useState<{
    primaryShapeId: string;
    movingIds: string[];
    startMm: Point2D;
    origShapesMap: Record<
      string,
      { points: Point2D[]; holePoints?: Point2D[] }
    >;
  } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{
    startMm: Point2D;
    currentMm: Point2D;
    operation: SelectionOperation;
    phase: 'pending' | 'drag';
    initialIds: string[];
  } | null>(null);
  const marqueeBoxRef = useRef(marqueeBox);
  marqueeBoxRef.current = marqueeBox;
  const [isPanning, setIsPanning] = useState<{
    startX: number;
    startY: number;
    origPan: Point2D;
  } | null>(null);

  const commitSelectedIds = useCallback(
    (ids: string[]) => {
      if (onSelectMultipleShapes) {
        onSelectMultipleShapes(ids);
      } else {
        onSelectShape(ids[0] ?? null);
      }
    },
    [onSelectMultipleShapes, onSelectShape],
  );

  const cancelInteraction = useCallback(() => {
    clearGrip();
    const snapshot = dragSnapshotRef.current;
    if (dragHistoryPushedRef.current && snapshot) {
      if (onCancelGeometryDrag) onCancelGeometryDrag();
      else if (onUpdateMultipleShapes) onUpdateMultipleShapes(snapshot.shapes, true);
      else snapshot.shapes.forEach((shape) => onUpdateShape(shape, true));
    }
    if (snapshot) setPan(snapshot.pan);
    dragHistoryPushedRef.current = false;
    setDragStarted(false);
    dragSnapshotRef.current = null;
    const pointerId = activePointerRef.current;
    activePointerRef.current = null;
    onInteractionChange?.(false);
    if (pointerId !== null && canvasRef.current?.hasPointerCapture(pointerId)) canvasRef.current.releasePointerCapture(pointerId);
    setDraggingVertexIdx(null);
    setDraggingHoleVertexIdx(null);
    setDraggingSingleEdge(null);
    setDraggingResizeEdge(null);
    setDraggingWholeShape(null);
    setIsPanning(null);
    setMarqueeBox(null);
    setDraftPoints([]);
    setDragStartMm(null);
    setActiveSnapGuides([]);
    setGeometrySnap(null);
    setSelectedEdgeIndex(null);
    setSizeInput('');
    setMeasurementPoints([]);
    setDrawingSteps([]);
    setDrawingError('');
  }, [onCancelGeometryDrag, onUpdateMultipleShapes, onUpdateShape, onInteractionChange, clearGrip]);

  const updateDraggedShape = (next: CadShape) => {
    if (isSameHistoryItem(shapes.find((shape) => shape.id === next.id), next)) return;
    const transient = dragHistoryPushedRef.current;
    if (!transient) onBeginGeometryDrag?.();
    dragHistoryPushedRef.current = true;
    onUpdateShape(next, transient);
  };

  const updateDraggedShapes = (next: CadShape[]) => {
    if (!onUpdateMultipleShapes || isSameHistoryItem(shapes, next)) return;
    const transient = dragHistoryPushedRef.current;
    if (!transient) onBeginGeometryDrag?.();
    dragHistoryPushedRef.current = true;
    onUpdateMultipleShapes(next, transient);
  };

  // Clear draft state when switching tools
  useEffect(() => {
    if (activePointerRef.current !== null) cancelInteraction();
    clearGrip();
    setDraftPoints([]);
    setDragStartMm(null);
    setActiveSnapGuides([]);
    setMarqueeBox(null);
    setGeometrySnap(null);
    setSizeInput('');
    setMeasurementPoints([]);
    setDrawingSteps([]);
    setDiameterMode(false);
    setDrawingError('');
  }, [activeTool, cancelInteraction, clearGrip]);

  useEffect(() => {
    if ((!isActive || keyboardBlocked) && (activePointerRef.current !== null || hotGripRef.current || marqueeBoxRef.current)) cancelInteraction();
  }, [isActive, keyboardBlocked, cancelInteraction]);

  useEffect(() => {
    if (!isActive && isDrawingTool) { cancelInteraction(); onChangeTool('select'); }
  }, [isActive, isDrawingTool, cancelInteraction, onChangeTool]);

  useEffect(() => {
    const onBlur = () => { if (activePointerRef.current !== null || hotGripRef.current || marqueeBoxRef.current) cancelInteraction(); };
    let visibilityTimer: number | undefined;
    let hiddenSince: number | null = null;
    const onVisibilityChange = () => {
      window.clearTimeout(visibilityTimer);
      // Ego can briefly hide and restore the page within one operation; cancel only if it stays hidden.
      if (document.hidden) {
        hiddenSince = performance.now();
        visibilityTimer = window.setTimeout(() => { if (document.hidden) onBlur(); }, 50);
      } else {
        // Background tabs can throttle the timer; still cancel on return after a real tab switch.
        if (hiddenSince !== null && performance.now() - hiddenSince >= 50) onBlur();
        hiddenSince = null;
      }
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => { window.clearTimeout(visibilityTimer); window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [cancelInteraction]);

  useEffect(() => {
    if (hotGrip && (hotGrip.snapshot !== shapes || hotGrip.selectedIds.join('|') !== selectedIds.join('|'))) clearGrip();
  }, [shapes, selectedIds, hotGrip, clearGrip]);

  useEffect(() => {
    const cancelForPanelAction = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if ((!hotGripRef.current && !marqueeBoxRef.current) || target.closest('button:disabled')) return;
      if (target.closest('.header-actions, .view-switch, .model-sidebar, .inspector, .floating-tool-area')) {
        if (marqueeBoxRef.current) cancelInteraction(); else clearGrip();
      }
    };
    document.addEventListener('pointerdown', cancelForPanelAction, true);
    return () => document.removeEventListener('pointerdown', cancelForPanelAction, true);
  }, [clearGrip, cancelInteraction]);

  // Reset highlighted edge when primary selected shape changes
  useEffect(() => {
    setSelectedEdgeIndex(null);
  }, [selectedId]);

  const selectedShape = useMemo(
    () => shapes.find((s) => s.id === selectedId && s.visible) ?? null,
    [shapes, selectedId],
  );

  const selectedDimensions = useMemo(
    () => (!isDrawingTool && selectedShape && selectedShape.type !== 'point' && selectedShape.type !== 'segment' ? computeShapeDimensions(selectedShape) : null),
    [selectedShape, isDrawingTool],
  );

  const dragAffectedIds = useMemo(() => sketchDragAffectedIds(shapes,
    draggingWholeShape?.movingIds ?? (draggingVertexIdx !== null && selectedShape ? [selectedShape.id] : []),
    draggingWholeShape ? undefined : draggingVertexIdx ?? undefined),
  [shapes, draggingWholeShape, draggingVertexIdx, selectedShape]);
  const linkedDragLines = shapes.filter(shape => shape.type === 'segment' && shape.endpointIds && dragAffectedIds.has(shape.id));
  const dragLockedShape = shapes.find(shape => shape.locked && dragAffectedIds.has(shape.id));

  const hitPoint = (raw: Point2D) => {
    let hit: CadShape | null = null;
    let distance = 8 / zoom;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      if (!shape.visible || shape.type !== 'point') continue;
      const nextDistance = Math.hypot(raw.x - shape.points[0].x, raw.y - shape.points[0].y);
      if (nextDistance <= 8 / zoom && (!hit || nextDistance < distance - 1e-8 ||
        (Math.abs(nextDistance - distance) <= 1e-8 && shape.id === selectedId))) {
        hit = shape; distance = nextDistance;
      }
    }
    return hit;
  };

  // Live preview of shapes hit by active marquee box
  const marqueePreview = useMemo(() => {
    if (!marqueeBox || marqueeBox.phase !== 'drag') return null;
    return computeBoxSelectedShapeIds(
      marqueeBox.startMm,
      marqueeBox.currentMm,
      shapes,
    );
  }, [marqueeBox, shapes]);

  const completeMarquee = (point: Point2D, operation = marqueeBox?.operation) => {
    if (!marqueeBox || !operation) return;
    const distance = Math.hypot(point.x - marqueeBox.startMm.x, point.y - marqueeBox.startMm.y) * zoom;
    const result = computeBoxSelectedShapeIds(marqueeBox.startMm, point, shapes);
    const nextIds = updateSelection(marqueeBox.initialIds, distance >= 3 ? result.selectedIds : [], operation);
    commitSelectedIds(nextIds);
    setSelectionModeLabel(`${result.mode === 'window' ? '包含选' : '交叉选'}${operation === 'remove' ? '减选' : ''}完成：已选 ${nextIds.length} 个对象`);
    setMarqueeBox(null); setGeometrySnap(null);
  };

  // Only display smart alignment guides while actively dragging, resizing, or drawing
  const displayedSnapGuides = useMemo(() => {
    if (!smartGuidesEnabled) return [];
    return activeSnapGuides;
  }, [smartGuidesEnabled, activeSnapGuides]);

  const screenToMm = useCallback(
    (px: number, py: number, width: number, height: number, applySnap = true): Point2D => {
      const cx = width / 2 + pan.x;
      const cy = height / 2 + pan.y;
      const rawX = (px - cx) / zoom;
      const rawY = -(py - cy) / zoom;
      return {
        x: snapToGrid(rawX, gridStep, applySnap && snapEnabled),
        y: snapToGrid(rawY, gridStep, applySnap && snapEnabled),
      };
    },
    [pan, zoom, gridStep, snapEnabled],
  );

  const mmToScreen = useCallback(
    (x: number, y: number, width: number, height: number): Point2D => {
      const cx = width / 2 + pan.x;
      const cy = height / 2 + pan.y;
      return {
        x: cx + x * zoom,
        y: cy - y * zoom,
      };
    },
    [pan, zoom],
  );

  const fitView = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    const points = shapes.filter((shape) => shape.visible).flatMap((shape) => shape.points);
    if (!points.length) { setZoom(2.8); setPan({ x: 0, y: 0 }); return; }
    const bounds = computeBounds2D(points);
    const top = Math.min(40, rect.height * 0.15);
    const bottom = Math.min(125, rect.height * 0.35);
    const nextZoom = Math.min(10, Math.max(0.001, Math.min(
      Math.max(1, rect.width - 80) / Math.max(bounds.widthX, 1),
      Math.max(1, rect.height - top - bottom) / Math.max(bounds.depthY, 1),
    )));
    setZoom(nextZoom);
    setPan({ x: -(bounds.minX + bounds.maxX) / 2 * nextZoom, y: (bounds.minY + bounds.maxY) / 2 * nextZoom + (top - bottom) / 2 });
  }, [shapes]);
  const lastFitRequestRef = useRef(fitRequest);
  useEffect(() => {
    if (isActive && fitRequest !== lastFitRequestRef.current && canvasSize.width > 0 && canvasSize.height > 0) {
      lastFitRequestRef.current = fitRequest;
      fitView();
    }
  }, [fitRequest, isActive, canvasSize, fitView]);

  const isPointInPolygon = (pt: Point2D, poly: Point2D[]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;
      const intersect =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const drawingStart = activeTool === 'polyline' ? draftPoints[draftPoints.length - 1] ?? null : dragStartMm;
  const drawingPreviewPoint = useMemo(() => {
    if (!isDrawingTool || !sizeInput.trim()) return cursorMm;
    try { return parseDrawingPoint(sizeInput, { tool: activeTool as 'point' | 'line' | 'rect' | 'circle' | 'triangle' | 'polyline', start: drawingStart, cursor: cursorMm }); }
    catch { return cursorMm; }
  }, [activeTool, isDrawingTool, sizeInput, drawingStart, cursorMm]);

  const finishDrawing = () => {
    cancelInteraction();
    onChangeTool('select');
  };

  const commitPolyline = () => {
    const error = validateClosedPolygonPoints(draftPoints);
    if (error) { setDrawingError(error); return false; }
    onCreateShape({ id: `cad-poly-${crypto.randomUUID()}`, name: `闭合面 #${shapes.length + 1}`, type: 'polyline',
      points: draftPoints.map((point) => ({ ...point })), zHeight: defaultZHeight, zOffset: 0, bevel: 0,
      color: '#A5ADB8', materialPreset: 'aluminum', visible: true });
    finishDrawing();
    return true;
  };

  const resolveDrawingPoint = (raw: Point2D, shiftKey = false) => {
    let snap: GeometrySnapResult | null = objectSnapEnabled ? findGeometrySnap(raw, shapes, 8 / zoom) : null;
    if (objectSnapEnabled && activeTool === 'polyline' && draftPoints.length >= 3 && Math.hypot(raw.x - draftPoints[0].x, raw.y - draftPoints[0].y) <= 8 / zoom) {
      snap = { point: draftPoints[0], kind: 'endpoint', shapeName: '当前闭合面起点' };
    }
    let point = snap ? { ...snap.point } : {
      x: snapToGrid(raw.x, gridStep, snapEnabled), y: snapToGrid(raw.y, gridStep, snapEnabled),
    };
    if (!snap && drawingStart && (activeTool === 'line' || activeTool === 'polyline') && orthoEnabled !== shiftKey) {
      point = Math.abs(point.x - drawingStart.x) >= Math.abs(point.y - drawingStart.y)
        ? { x: point.x, y: drawingStart.y } : { x: drawingStart.x, y: point.y };
    }
    return { point, snap };
  };

  useEffect(() => {
    if (!isDrawingTool && activeTool !== 'measure') return;
    const resolved = resolveDrawingPoint(rawDrawingCursorRef.current, drawingShiftRef.current);
    setCursorMm(resolved.point);
    setGeometrySnap(resolved.snap);
  }, [objectSnapEnabled, orthoEnabled, snapEnabled, gridStep, activeTool, dragStartMm, draftPoints]);

  const uniqueDrawingName = (prefix: string) => {
    const usedNames = new Set(shapes.map((shape) => shape.name));
    let suffix = 1;
    while (usedNames.has(`${prefix} #${suffix}`)) suffix++;
    return `${prefix} #${suffix}`;
  };

  const commitDrawingPoint = (point: Point2D, reusePointId?: string, planeZ?: number) => {
    if (![point.x, point.y].every(Number.isFinite)) { setDrawingError('请输入有限坐标。'); return false; }
    if (activeTool === 'point') {
      const newPoint = createPointShape(point, uniqueDrawingName('定位点'));
      onCreateShape(newPoint);
      setDrawingSteps((previous) => [...previous, { pointId: newPoint.id, point, zOffset: newPoint.zOffset, createdIds: [newPoint.id] }]);
      setCursorMm(point); setSizeInput(''); setDrawingError('');
      return true;
    }
    if (activeTool === 'line') {
      const previous = drawingSteps[drawingSteps.length - 1];
      if (previous) {
        const currentAnchor = shapes.find((shape) => shape.id === previous.pointId);
        if (!currentAnchor?.visible || currentAnchor.type !== 'point' || currentAnchor.points.length !== 1 ||
          Math.hypot(currentAnchor.points[0].x - previous.point.x, currentAnchor.points[0].y - previous.point.y) >= 1e-8 ||
          Math.abs(currentAnchor.zOffset - previous.zOffset) >= 1e-8) {
          setDrawingError('当前起点已被修改、隐藏或删除，请结束命令后重新指定起点。'); return false;
        }
      }
      if (previous && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 1e-8) {
        setDrawingError('该点与上一点重合，请指定不同的点。'); return false;
      }
      const matchingPoints = shapes.filter((shape) => shape.visible && shape.type === 'point' && shape.points.length === 1 &&
        Math.hypot(shape.points[0].x - point.x, shape.points[0].y - point.y) < 1e-8);
      const existingPoint = reusePointId ? matchingPoints.find((shape) => shape.id === reusePointId)
        : previous ? matchingPoints.find((shape) => Math.abs(shape.zOffset - previous.zOffset) < 1e-8)
          : planeZ !== undefined ? matchingPoints.find((shape) => Math.abs(shape.zOffset - planeZ) < 1e-8)
            : matchingPoints.find((shape) => Math.abs(shape.zOffset) < 1e-8) ?? matchingPoints[0];
      if (reusePointId && !existingPoint) {
        setDrawingError('原起点已被修改或隐藏，请结束命令后重新指定起点。'); return false;
      }
      if (previous && matchingPoints.length && (!existingPoint || Math.abs(existingPoint.zOffset - previous.zOffset) >= 1e-8)) {
        setDrawingError('该点与起点不在同一 Z 平面，请选择共面的点。'); return false;
      }
      const node = existingPoint ?? { ...createPointShape(point, uniqueDrawingName('定位点')), zOffset: previous?.zOffset ?? planeZ ?? 0 };
      if (previous && shapes.some((shape) => shape.endpointIds?.includes(previous.pointId) && shape.endpointIds.includes(node.id))) {
        setDrawingError('这两个点已连接，请指定其他点。'); return false;
      }
      const additions: CadShape[] = existingPoint ? [] : [node];
      let segmentId: string | undefined;
      if (previous) {
        const segment: CadShape = { ...createSketchLineShape(previous.point, node.points[0], uniqueDrawingName('两点直线')),
          zOffset: previous.zOffset, endpointIds: [previous.pointId, node.id] };
        additions.push(segment);
        segmentId = segment.id;
      }
      if (additions.length) onCreateShapes(additions);
      else onSelectShape(node.id);
      const nextPoint = { ...node.points[0] };
      setDrawingSteps((steps) => [...steps, { pointId: node.id, point: nextPoint, zOffset: node.zOffset,
        createdIds: additions.map((shape) => shape.id), segmentId }]);
      setDragStartMm(nextPoint); setCursorMm(nextPoint); setSizeInput(''); setDrawingError('');
      return true;
    }
    if (activeTool === 'polyline') {
      if (draftPoints.length >= 3 && Math.hypot(point.x - draftPoints[0].x, point.y - draftPoints[0].y) < 1e-8) return commitPolyline();
      if (drawingStart && Math.hypot(point.x - drawingStart.x, point.y - drawingStart.y) < 1e-8) {
        setDrawingError('该点与上一点重合，请指定不同的点。'); return false;
      }
      setDraftPoints((points) => [...points, point]);
      setCursorMm(point); setSizeInput(''); setDrawingError('');
      return true;
    }
    if (!dragStartMm) {
      setDragStartMm(point); setCursorMm(point); setSizeInput(''); setDrawingError('');
      return true;
    }
    const dx = point.x - dragStartMm.x;
    const dy = point.y - dragStartMm.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-8 || ((activeTool === 'rect' || activeTool === 'triangle') && (Math.abs(dx) < 1e-8 || Math.abs(dy) < 1e-8))) {
      setDrawingError('两点须不同；矩形和三角形的宽、高均须大于 0。'); return false;
    }
    if (!['rect', 'triangle', 'circle'].includes(activeTool)) return false;
    const type = activeTool as 'rect' | 'triangle' | 'circle';
    const id = `cad-${type}-${crypto.randomUUID()}`;
    const points = type === 'circle' ? createRegularPolygonPoints(dragStartMm.x, dragStartMm.y, distance / (diameterMode ? 2 : 1), 32)
      : type === 'rect' ? createRectanglePoints((point.x + dragStartMm.x) / 2, (point.y + dragStartMm.y) / 2, Math.abs(dx), Math.abs(dy))
      : createTrianglePoints((point.x + dragStartMm.x) / 2, (point.y + dragStartMm.y) / 2, Math.abs(dx), Math.abs(dy));
    onCreateShape({ id, name: `${type === 'rect' ? '矩形' : type === 'circle' ? '圆柱' : '三角柱'} #${shapes.length + 1}`,
      type, points, zHeight: defaultZHeight, zOffset: 0, bevel: 0,
      color: '#A5ADB8', materialPreset: type === 'circle' ? 'brass' : 'aluminum', visible: true });
    setSizeInput(''); setDrawingError(''); setCursorMm(point);
    finishDrawing();
    return true;
  };

  const undoDrawingPoint = () => {
    setSizeInput('');
    if (activeTool === 'polyline') {
      setDraftPoints((points) => points.slice(0, -1)); setSizeInput(''); setDrawingError(''); return;
    }
    const step = drawingSteps[drawingSteps.length - 1];
    if ((activeTool !== 'line' && activeTool !== 'point') || !step) { setDrawingError('本次命令没有可撤回的点线。'); return; }
    if (step.createdIds.length && !onUndoDrawingSegment?.(step.createdIds)) {
      setDrawingError('模型已被其他操作修改，请结束命令后使用全局撤销。'); return;
    }
    setDrawingSteps((steps) => steps.slice(0, -1));
    if (activeTool === 'point') {
      setDrawingError('');
      return;
    }
    const previous = drawingSteps[drawingSteps.length - 2]?.point ?? null;
    setDragStartMm(previous); if (previous) setCursorMm(previous);
    setSizeInput(''); setDrawingError('');
  };

  const submitDrawingInput = (cursor = cursorMm) => {
    const command = sizeInput.trim().toUpperCase();
    if (!command) {
      if (!drawingStart && activeTool === 'line') {
        try {
          const end = lineContinuation(shapes);
          commitDrawingPoint(end.point, end.pointId, end.zOffset);
        } catch (error) { setDrawingError(error instanceof Error ? error.message : '无法续画直线。'); }
        return;
      }
      if (!drawingStart && ['line', 'rect', 'circle', 'triangle'].includes(activeTool)) {
        setDrawingError(activeTool === 'line' ? '请指定起点：单击画布或输入 x,y。' : '请指定第一点：单击画布或输入 x,y。');
        return;
      }
      if (activeTool === 'polyline' && draftPoints.length) commitPolyline();
      else finishDrawing();
      return;
    }
    if (command === 'U') { undoDrawingPoint(); return; }
    if (command === 'C' && activeTool === 'polyline') { commitPolyline(); return; }
    if (command === 'C' && activeTool === 'line') {
      if (drawingSteps.filter((step) => step.segmentId).length < 2) { setDrawingError('至少绘制两段后才能闭合。'); return; }
      const first = drawingSteps[0];
      if (dragStartMm && Math.hypot(first.point.x - dragStartMm.x, first.point.y - dragStartMm.y) < 1e-8) finishDrawing();
      else if (commitDrawingPoint(first.point, first.pointId)) finishDrawing();
      return;
    }
    if (command === 'D' && activeTool === 'circle' && dragStartMm) { setDiameterMode((value) => !value); setSizeInput(''); setDrawingError(''); return; }
    try {
      commitDrawingPoint(parseDrawingPoint(sizeInput, { tool: activeTool as 'point' | 'line' | 'rect' | 'circle' | 'triangle' | 'polyline', start: drawingStart, cursor }));
    } catch (error) { setDrawingError(error instanceof Error ? error.message : '无法解析输入。'); }
  };

  const resolveGripPoint = (raw: Point2D, shiftKey: boolean) => {
    if (!hotGrip) return { point: raw, snap: null };
    const affected = sketchDragAffectedIds(shapes, hotGrip.mode === 'stretch' ? [hotGrip.shapeId] : hotGrip.selectedIds,
      hotGrip.mode === 'stretch' ? hotGrip.vertexIndex : undefined);
    const snap = objectSnapEnabled ? findGeometrySnap(raw, shapes.filter(s => !affected.has(s.id)), 8 / zoom) : null;
    let point = snap?.point ?? { x: snapToGrid(raw.x, gridStep, snapEnabled), y: snapToGrid(raw.y, gridStep, snapEnabled) };
    if (!snap && orthoEnabled !== shiftKey) {
      point = Math.abs(point.x - hotGrip.base.x) >= Math.abs(point.y - hotGrip.base.y)
        ? { x: point.x, y: hotGrip.base.y } : { x: hotGrip.base.x, y: point.y };
    }
    return { point, snap };
  };
  const commitGrip = (point = cursorMm) => {
    if (!hotGrip) return;
    try {
      const next = previewGrip(hotGrip, point, gripInput);
      onUpdateMultipleShapes?.(next);
      clearGrip();
      canvasRef.current?.focus({ preventScroll: true });
    } catch (error) { setGripError(error instanceof Error ? error.message : '无法变换夹点。'); }
  };
  const cycleGripMode = () => {
    setHotGrip(g => g && { ...g, mode: GRIP_MODES[(GRIP_MODES.indexOf(g.mode) + 1) % GRIP_MODES.length] });
    setGripInput(''); setGripError('');
  };
  useEffect(() => {
    if (!hotGrip) return;
    const resolved = resolveGripPoint(rawDrawingCursorRef.current, drawingShiftRef.current);
    setCursorMm(resolved.point); setGeometrySnap(resolved.snap);
  }, [hotGrip, objectSnapEnabled, orthoEnabled, snapEnabled, gridStep]);

  useEffect(() => {
    onDrawingStateChange?.((isDrawingTool || Boolean(hotGrip) || Boolean(marqueeBox)) && isActive);
    return () => onDrawingStateChange?.(false);
  }, [isDrawingTool, hotGrip, Boolean(marqueeBox), isActive, onDrawingStateChange]);

  useEffect(() => {
    if (!isActive || keyboardBlocked) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const ownInput = target === drawingInputRef.current || target === gripInputRef.current || target?.id === "cad-command-input";
      if (event.defaultPrevented || event.isComposing || (!ownInput && (target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"]')))) return;
      if (event.key === 'F3' || event.key === 'F7' || event.key === 'F8' || event.key === 'F9') {
        event.preventDefault();
        if (event.repeat) return;
        if (event.key === 'F3') setObjectSnapEnabled((value) => !value);
        else if (event.key === 'F7') setGridVisible(value => !value);
        else if (event.key === 'F8') setOrthoEnabled((value) => !value);
        else onToggleSnap();
        return;
      }
      if (marqueeBox) {
        if (['Shift', 'Control', 'Meta'].includes(event.key)) {
          drawingShiftRef.current = event.shiftKey;
          pointerCurrentRef.current = { ...pointerCurrentRef.current, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
          setMarqueeBox(box => box && { ...box, operation: selectionOperation(event) }); return;
        }
        if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) {
          event.preventDefault(); cancelInteraction(); return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { cancelInteraction(); return; }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); completeMarquee(marqueeBox.currentMm, selectionOperation(event)); return; }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
          const tools: Record<string, DrawTool2D> = { v: 'select', l: 'line', r: 'rect', c: 'circle', p: 'polyline', m: 'measure' };
          const tool = tools[event.key.toLowerCase()];
          if (tool) { event.preventDefault(); cancelInteraction(); onChangeTool(tool); return; }
        }
        if (event.key === 'Delete' || event.key === 'Backspace') event.preventDefault();
        return;
      }
      if (hotGrip) {
        if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) {
          event.preventDefault(); clearGrip(); canvasRef.current?.focus({ preventScroll: true }); return;
        }
        if (event.key === 'Shift') {
          drawingShiftRef.current = true;
          const resolved = resolveGripPoint(rawDrawingCursorRef.current, true);
          setCursorMm(resolved.point); setGeometrySnap(resolved.snap); return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') clearGrip();
          return;
        }
        if (target?.closest('button, a, [role="button"], [role="menuitem"]')) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); if (gripInput.trim()) commitGrip(); else cycleGripMode(); return;
        }
        if (ownInput) return;
        if (event.key === 'Backspace') { event.preventDefault(); setGripInput(v => v.slice(0, -1)); return; }
        if (event.key === 'Delete') { event.preventDefault(); return; }
        if (/^[0-9.+\-@,，<]$/.test(event.key)) { event.preventDefault(); setGripInput(v => v + event.key); setGripError(''); }
        return;
      }
      if (event.key === 'Shift' && isDrawingTool) {
        drawingShiftRef.current = true;
        const resolved = resolveDrawingPoint(rawDrawingCursorRef.current, true);
        setCursorMm(resolved.point); setGeometrySnap(resolved.snap);
      }
      if (event.key === 'Shift' && activePointerRef.current !== null && !isDrawingTool) {
        handleMouseMove({ ...pointerCurrentRef.current, shiftKey: true });
      }
      if (event.key === 'Escape') {
        if (activePointerRef.current !== null || draftPoints.length || dragStartMm || activeTool !== 'select') event.preventDefault();
        finishDrawing(); return;
      }
      if (ownInput && (event.ctrlKey || event.metaKey)) return;
      if (target?.closest('button, a, [role="button"], [role="menuitem"]')) return;
      if (!isDrawingTool) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (!event.shiftKey) undoDrawingPoint(); return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); submitDrawingInput(); return; }
      if (ownInput) return;
      if (event.key === 'Backspace') { event.preventDefault(); setSizeInput((value) => value.slice(0, -1)); return; }
      if (event.key === 'Delete') { event.preventDefault(); return; }
      if (/^[0-9.+\-@,，<xX×*uUcCdD]$/.test(event.key)) {
        event.preventDefault(); setSizeInput((value) => value + event.key); setDrawingError('');
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (marqueeBox && ['Shift', 'Control', 'Meta'].includes(event.key)) {
        drawingShiftRef.current = event.shiftKey;
        pointerCurrentRef.current = { ...pointerCurrentRef.current, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
        setMarqueeBox(box => box && { ...box, operation: selectionOperation(event) }); return;
      }
      if (event.key !== 'Shift') return;
      drawingShiftRef.current = false;
      if (hotGrip) {
        const resolved = resolveGripPoint(rawDrawingCursorRef.current, false);
        setCursorMm(resolved.point); setGeometrySnap(resolved.snap);
      }
      if (isDrawingTool) {
        const resolved = resolveDrawingPoint(rawDrawingCursorRef.current, false);
        setCursorMm(resolved.point); setGeometrySnap(resolved.snap);
      }
      if (activePointerRef.current !== null && !isDrawingTool) handleMouseMove({ ...pointerCurrentRef.current, shiftKey: false });
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => { window.removeEventListener('keydown', handleKeyDown, true); window.removeEventListener('keyup', handleKeyUp, true); };
  });

  useEffect(() => {
    if (activePointerRef.current !== null && activeTool === 'select') handleMouseMove(pointerCurrentRef.current);
  }, [objectSnapEnabled, orthoEnabled, snapEnabled, gridStep, smartGuidesEnabled]);

  // Draw the 2D CAD Blueprint Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = rect.width;
    const height = rect.height;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    const adaptiveFontPx = 11;

    // Helper: Crisp CAD Halo Text (no bulky opaque background rectangle)
    const drawHaloText = (
      text: string,
      x: number,
      y: number,
      fillColor: string,
      fontSizePx = adaptiveFontPx,
      fontWeight = 600,
      haloWidth = 3.2,
    ) => {
      ctx.save();
      ctx.font = `${fontWeight} ${fontSizePx}px "JetBrains Mono", "Noto Sans SC", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = haloWidth;
      ctx.strokeStyle = 'rgba(27, 29, 33, 0.97)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fillColor;
      ctx.fillText(t(text), x, y);
      ctx.restore();
    };

    // Helper: Draw adaptive CAD-style Linear Dimension Annotation (box-free halo text)
    const drawCadLinearDimension = (
      p1Mm: Point2D,
      p2Mm: Point2D,
      outwardNormalMm: Point2D,
      offsetPx: number,
      label: string,
      color = 'rgba(76, 154, 255, 0.78)',
      isHighlighted = false,
    ) => {
      const s1 = mmToScreen(p1Mm.x, p1Mm.y, width, height);
      const s2 = mmToScreen(p2Mm.x, p2Mm.y, width, height);
      const segPx = Math.hypot(s2.x - s1.x, s2.y - s1.y);
      if (!isHighlighted && segPx < 28) return;
      if (segPx < 10) return;

      const fontSize = isHighlighted
        ? Math.max(9.5, adaptiveFontPx + 0.5)
        : Math.max(8, adaptiveFontPx - 0.5);
      ctx.font = `${isHighlighted ? 700 : 500} ${fontSize}px "JetBrains Mono", "Noto Sans SC", monospace`;
      const textW = ctx.measureText(t(label)).width;
      // Adaptive anti-crowding: skip non-highlighted dimension if segment is narrower than text
      if (!isHighlighted && segPx < textW * 0.78) return;

      const nLen = Math.hypot(outwardNormalMm.x, outwardNormalMm.y) || 1;
      const nx = outwardNormalMm.x / nLen;
      const ny = -outwardNormalMm.y / nLen;

      const effectiveOffset = isHighlighted
        ? Math.max(14, offsetPx * 0.78)
        : Math.max(10, Math.min(15, offsetPx * 0.62));
      const gapPx = 3;
      const extOvershootPx = 4;
      const d1 = { x: s1.x + nx * effectiveOffset, y: s1.y + ny * effectiveOffset };
      const d2 = { x: s2.x + nx * effectiveOffset, y: s2.y + ny * effectiveOffset };

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = isHighlighted ? 1.35 : 0.85;

      // 1. Subtle extension lines
      ctx.beginPath();
      ctx.moveTo(s1.x + nx * gapPx, s1.y + ny * gapPx);
      ctx.lineTo(
        s1.x + nx * (effectiveOffset + extOvershootPx),
        s1.y + ny * (effectiveOffset + extOvershootPx),
      );
      ctx.moveTo(s2.x + nx * gapPx, s2.y + ny * gapPx);
      ctx.lineTo(
        s2.x + nx * (effectiveOffset + extOvershootPx),
        s2.y + ny * (effectiveOffset + extOvershootPx),
      );
      ctx.stroke();

      // 2. Dimension line
      ctx.beginPath();
      ctx.moveTo(d1.x, d1.y);
      ctx.lineTo(d2.x, d2.y);
      ctx.stroke();

      // 3. Compact CAD 45° architectural ticks
      const ux = (d2.x - d1.x) / segPx;
      const uy = (d2.y - d1.y) / segPx;
      const px = -uy;
      const py = ux;
      const tickSize = isHighlighted ? 3.2 : 2.4;
      ctx.beginPath();
      ctx.moveTo(d1.x - (ux + px) * tickSize, d1.y - (uy + py) * tickSize);
      ctx.lineTo(d1.x + (ux + px) * tickSize, d1.y + (uy + py) * tickSize);
      ctx.moveTo(d2.x - (ux + px) * tickSize, d2.y - (uy + py) * tickSize);
      ctx.lineTo(d2.x + (ux + px) * tickSize, d2.y + (uy + py) * tickSize);
      ctx.stroke();
      ctx.restore();

      // 4. Adaptive Halo Text (zero opaque border box)
      const midX = (d1.x + d2.x) / 2;
      const midY = (d1.y + d2.y) / 2;
      const textOffset = isHighlighted ? 7 : 5;
      const labelX = midX + nx * (Math.abs(nx) > 0.4 ? textW * 0.35 + 4 : textOffset * nx);
      const labelY = midY + ny * textOffset;

      drawHaloText(
        label,
        labelX,
        labelY,
        isHighlighted ? '#4c9aff' : '#d0d7e1',
        fontSize,
        isHighlighted ? 700 : 500,
        3.5,
      );
    };

    // 1. Background fill
    ctx.fillStyle = '#08090b';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2 + pan.x;
    const cy = height / 2 + pan.y;

    // 2. Grid lines
    const minorStep = Math.max(gridStep, Math.pow(2, Math.ceil(Math.log2(18 / zoom / gridStep))) * gridStep);
    const majorStep = minorStep * 5;

    const minXMm = Math.floor(-cx / zoom / minorStep) * minorStep;
    const maxXMm = Math.ceil((width - cx) / zoom / minorStep) * minorStep;
    const minYMm = Math.floor(-(height - cy) / zoom / minorStep) * minorStep;
    const maxYMm = Math.ceil(cy / zoom / minorStep) * minorStep;

    ctx.lineWidth = 1;
    for (let x = minXMm; gridVisible && x <= maxXMm; x += minorStep) {
      const sx = cx + x * zoom;
      const isMajor = Math.abs(x % majorStep) < 0.001;
      ctx.strokeStyle = isMajor ? '#20242a' : '#14171b';
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }

    for (let y = minYMm; gridVisible && y <= maxYMm; y += minorStep) {
      const sy = cy - y * zoom;
      const isMajor = Math.abs(y % majorStep) < 0.001;
      ctx.strokeStyle = isMajor ? '#20242a' : '#14171b';
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }

    // 3. Coordinate Origin Axes (+X Red, +Y Green)
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#49272c';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();

    ctx.strokeStyle = '#234333';
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();

    ctx.fillStyle = '#a3abb8';
    ctx.font = '500 10px "JetBrains Mono", "Noto Sans SC", monospace';
    ctx.strokeStyle = '#6f7987';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();
    ctx.strokeStyle = '#a7626c'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 14, cy); ctx.stroke();
    ctx.strokeStyle = '#629a78'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 14); ctx.stroke();
    ctx.fillStyle = '#ac737b'; ctx.fillText(t('X'), width - 16, cy - 6);
    ctx.fillStyle = '#7ba68c'; ctx.fillText(t('Y'), cx + 6, 16);

    // 3b. Render Dynamic Smart Snap Alignment Guides
    const isActivelyInteracting =
      draggingWholeShape !== null ||
      draggingVertexIdx !== null ||
      draggingSingleEdge !== null ||
      draggingHoleVertexIdx !== null ||
      draggingResizeEdge !== null ||
      dragStartMm !== null;

    if (smartGuidesEnabled && displayedSnapGuides.length > 0) {
      displayedSnapGuides.forEach((guide) => {
        const sStart = mmToScreen(guide.startMm.x, guide.startMm.y, width, height);
        const sEnd = mmToScreen(guide.endMm.x, guide.endMm.y, width, height);
        const sAct = mmToScreen(guide.activeAnchorPt.x, guide.activeAnchorPt.y, width, height);
        const sRef = mmToScreen(guide.targetAnchorPt.x, guide.targetAnchorPt.y, width, height);

        const guideColor = guide.axis === 'x' ? '#4c9aff' : '#4c9aff';
        const subtleLaserColor =
          guide.axis === 'x' ? 'rgba(76, 154, 255, 0.18)' : 'rgba(76, 154, 255, 0.18)';

        ctx.save();
        ctx.strokeStyle = subtleLaserColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (guide.axis === 'x') {
          ctx.moveTo(sStart.x, 0);
          ctx.lineTo(sStart.x, height);
        } else {
          ctx.moveTo(0, sStart.y);
          ctx.lineTo(width, sStart.y);
        }
        ctx.stroke();

        ctx.strokeStyle = guideColor;
        ctx.lineWidth = isActivelyInteracting ? 1.8 : 1.3;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(sStart.x, sStart.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const drawDiamond = (x: number, y: number) => {
          const r = 4.2;
          ctx.fillStyle = '#272a2f';
          ctx.strokeStyle = guideColor;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(x, y - r);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r);
          ctx.lineTo(x - r, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        };
        drawDiamond(sAct.x, sAct.y);
        drawDiamond(sRef.x, sRef.y);

        const badgeX = guide.axis === 'x' ? sAct.x : (sAct.x + sRef.x) / 2;
        const badgeY = guide.axis === 'x' ? (sAct.y + sRef.y) / 2 : sAct.y - 14;

        const shortBadge =
          guide.axis === 'x'
            ? `对齐 X=${guide.valueMm}mm (${guide.activeAnchorLabel})`
            : `对齐 Y=${guide.valueMm}mm (${guide.activeAnchorLabel})`;
        ctx.font = '600 9.5px "JetBrains Mono", "Noto Sans SC", monospace';
        const tw = ctx.measureText(t(shortBadge)).width;
        const pw = tw + 10;
        const ph = 16;

        ctx.fillStyle = 'rgba(39, 42, 47, 0.97)';
        ctx.fillRect(badgeX - pw / 2, badgeY - ph / 2, pw, ph);
        ctx.strokeStyle = guideColor;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(badgeX - pw / 2, badgeY - ph / 2, pw, ph);
        ctx.fillStyle = guide.axis === 'x' ? '#4c9aff' : '#4c9aff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t(shortBadge), badgeX, badgeY);

        ctx.restore();
      });
    }

    // 4. Render all visible CAD shapes on XY plane
    const marqueeHitSet = new Set(marqueePreview?.selectedIds ?? []);
    const previewSelection = marqueeBox && marqueePreview
      ? new Set(updateSelection(marqueeBox.initialIds, marqueePreview.selectedIds, marqueeBox.operation)) : selectedIdSet;

    shapes.forEach((shape) => {
      if (!shape.visible || !shape.points.length) return;
      const isSelected = previewSelection.has(shape.id);
      const isPrimarySelected = shape.id === selectedId && !marqueeBox;
      const isMarqueeHit = marqueeHitSet.has(shape.id) && marqueeBox?.operation !== 'remove';

      if (shape.type === 'point' || shape.type === 'segment') {
        const affectedByDrag = dragStarted && dragAffectedIds.has(shape.id);
        const highlighted = isSelected || isMarqueeHit || hoveredTarget.shapeId === shape.id || affectedByDrag;
        const color = highlighted ? '#69adff' : shape.color;
        const a = mmToScreen(shape.points[0].x, shape.points[0].y, width, height);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = '#08090b';
        ctx.lineWidth = display.lineWidth;
        if (shape.type === 'point') {
          if (linkedPointIds.has(shape.id) && !highlighted && !display.nodes && !display.names) { ctx.restore(); return; }
          const radius = display.pointSize / 2;
          ctx.lineWidth = 1;
          if (isSelected && !isDrawingTool && !marqueeBox) {
            ctx.fillStyle = '#4c9aff'; ctx.strokeStyle = '#c9def8';
            ctx.fillRect(a.x - 3, a.y - 3, 6, 6); ctx.strokeRect(a.x - 3, a.y - 3, 6, 6);
          } else if (display.pointStyle === 'dot') {
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(a.x, a.y, radius, 0, Math.PI * 2); ctx.fill();
          } else {
          ctx.beginPath();
          if (display.pointStyle === 'circle') { ctx.arc(a.x, a.y, radius * 0.65, 0, Math.PI * 2); ctx.stroke(); }
          ctx.beginPath();
          ctx.moveTo(a.x - radius, a.y); ctx.lineTo(a.x + radius, a.y);
          ctx.moveTo(a.x, a.y - radius); ctx.lineTo(a.x, a.y + radius);
          ctx.stroke();
          }
          if (display.names || (highlighted && selectedIds.length < 2 && !marqueeBox)) {
          ctx.font = '500 10px "JetBrains Mono", "Noto Sans SC", monospace';
          ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = color;
          ctx.fillText(shape.name, a.x + 9, a.y - 7);
          }
        } else if (shape.points[1]) {
          const b = mmToScreen(shape.points[1].x, shape.points[1].y, width, height);
          if (highlighted) {
            ctx.save(); ctx.strokeStyle = 'rgba(76,154,255,0.22)'; ctx.lineWidth = display.lineWidth + 3;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
          }
          if (affectedByDrag && !isSelected) ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.setLineDash([]);
          if (!isDrawingTool && !marqueeBox && isSelected && !shape.locked) {
            [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }].forEach((endpoint) => {
              ctx.fillStyle = '#4c9aff'; ctx.strokeStyle = '#c9def8'; ctx.lineWidth = 1;
              ctx.fillRect(endpoint.x - 3, endpoint.y - 3, 6, 6); ctx.strokeRect(endpoint.x - 3, endpoint.y - 3, 6, 6);
            });
          }
          if (!isDrawingTool && !marqueeBox && highlighted && showDimensions) {
            const measured = measureXY(shape.points[0], shape.points[1]);
            drawHaloText(`L=${measured.distance.toFixed(2)} mm · ${measured.angleDeg.toFixed(1)}°`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, color, 10);
          }
        }
        ctx.restore();
        return;
      }
      if (shape.points.length < 2) return;
      ctx.save();
      ctx.beginPath();
      shape.points.forEach((pt, idx) => {
        const s = mmToScreen(pt.x, pt.y, width, height);
        if (idx === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();

      if (shape.holePoints && shape.holePoints.length >= 3) {
        shape.holePoints.forEach((pt, idx) => {
          const s = mmToScreen(pt.x, pt.y, width, height);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      }

      ctx.fillStyle = isSelected || isMarqueeHit ? 'rgba(76, 154, 255, 0.08)' : 'rgba(189, 199, 212, 0.035)';
      ctx.fill('evenodd');

      ctx.lineWidth = isSelected || isMarqueeHit ? display.lineWidth + 0.5 : display.lineWidth;
      ctx.strokeStyle = isMarqueeHit
        ? '#4c9aff'
        : isSelected
          ? '#4c9aff'
          : '#bdc7d4';
      ctx.stroke();

      // Geometry dimensions are placed outside the selected outline.
      const bounds = computeBounds2D(shape.points);
      const screenW = bounds.widthX * zoom;
      const screenH = bounds.depthY * zoom;
      const isHoveredShape = hoveredTarget.shapeId === shape.id;
      const hoveredEdgeForShape = isHoveredShape ? hoveredTarget.edgeIndex : null;

      // 4a. Implicit hover edge length on unselected shapes
      if (
        !isDrawingTool && isPrimarySelected &&
        isHoveredShape &&
        hoveredEdgeForShape !== null &&
        showDimensions
      ) {
        const hoverDim = computeShapeDimensions(shape);
        const hEdge = hoverDim.edges[hoveredEdgeForShape];
        if (hEdge) {
          const s1 = mmToScreen(hEdge.start.x, hEdge.start.y, width, height);
          const s2 = mmToScreen(hEdge.end.x, hEdge.end.y, width, height);
          ctx.save();
          ctx.strokeStyle = 'rgba(76, 154, 255, 0.85)';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.stroke();
          ctx.restore();

          drawCadLinearDimension(
            hEdge.start,
            hEdge.end,
            hEdge.outwardNormal,
            16,
            `${hEdge.lengthMm}mm`,
            '#4c9aff',
            true,
          );
        }
      }

      // 4b. Adaptive & Implicit CAD Dimension Annotations for the primary selected shape
      if (!isDrawingTool && isPrimarySelected && selectedIds.length === 1 && showDimensions) {
        const dim = computeShapeDimensions(shape);
        const activeEdgeIdx =
          hoveredEdgeForShape !== null ? hoveredEdgeForShape : selectedEdgeIndex;

        if (dim.isLineFeature && dim.lineStart && dim.lineEnd) {
          const ls = mmToScreen(dim.lineStart.x, dim.lineStart.y, width, height);
          const le = mmToScreen(dim.lineEnd.x, dim.lineEnd.y, width, height);
          ctx.save();
          ctx.strokeStyle = 'rgba(76, 154, 255, 0.75)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(ls.x, ls.y);
          ctx.lineTo(le.x, le.y);
          ctx.stroke();
          ctx.restore();

          const dx = dim.lineEnd.x - dim.lineStart.x;
          const dy = dim.lineEnd.y - dim.lineStart.y;
          const len = Math.hypot(dx, dy) || 1;
          let normalMm = { x: -dy / len, y: dx / len };
          if (normalMm.y < 0) {
            normalMm = { x: -normalMm.x, y: -normalMm.y };
          }
          drawCadLinearDimension(
            dim.lineStart,
            dim.lineEnd,
            normalMm,
            18,
            `L=${dim.primaryLengthMm}mm`,
            '#4c9aff',
            true,
          );
        } else if (shape.type === 'circle' && dim.radiusMm && dim.diameterMm) {
          const cMm = dim.centroid;
          const rMm = dim.radiusMm;
          const placeOnTop = cMm.y >= 0;
          if (screenW >= 36 || isHoveredShape || annotationMode === 'all') {
            drawCadLinearDimension(
              { x: cMm.x - rMm, y: placeOnTop ? cMm.y + rMm : cMm.y - rMm },
              { x: cMm.x + rMm, y: placeOnTop ? cMm.y + rMm : cMm.y - rMm },
              { x: 0, y: placeOnTop ? 1 : -1 },
              14,
              `Ø${dim.diameterMm}mm`,
              'rgba(76, 154, 255, 0.85)',
              isHoveredShape,
            );
          }
        } else {
          // Polygon / Rect / Triangle / Boolean shape:
          // 1) In 'adaptive' mode, show subtle overall W & D only when shape is large enough on screen
          const placeTop = bounds.centroid.y >= 0;
          const placeRight = bounds.centroid.x >= 0;
          const showOverallBounds =
            annotationMode === 'all' || (screenW >= 48 && screenH >= 48);

          if (showOverallBounds && (shape.type === 'rect' || annotationMode === 'adaptive')) {
            const hStart = { x: bounds.minX, y: placeTop ? bounds.maxY : bounds.minY };
            const hEnd = { x: bounds.maxX, y: placeTop ? bounds.maxY : bounds.minY };
            const vStart = { x: placeRight ? bounds.maxX : bounds.minX, y: bounds.minY };
            const vEnd = { x: placeRight ? bounds.maxX : bounds.minX, y: bounds.maxY };

            drawCadLinearDimension(
              hStart,
              hEnd,
              { x: 0, y: placeTop ? 1 : -1 },
              14,
              `宽${bounds.widthX.toFixed(0)}`,
              'rgba(76, 154, 255, 0.68)',
              false,
            );
            drawCadLinearDimension(
              vStart,
              vEnd,
              { x: placeRight ? 1 : -1, y: 0 },
              14,
              `深${bounds.depthY.toFixed(0)}`,
              'rgba(76, 154, 255, 0.68)',
              false,
            );
          }

          // 2) Individual edges:
          // - In 'adaptive' mode (隐性注释): ONLY show the edge that is currently hovered or clicked!
          // - In 'all' mode (全显): show all edges that fit on screen.
          if (annotationMode === 'all' && shape.type !== 'rect') {
            dim.edges.forEach((edge) => {
              const isEdgeActive = activeEdgeIdx === edge.edgeIndex;
              if (isEdgeActive) {
                const s1 = mmToScreen(edge.start.x, edge.start.y, width, height);
                const s2 = mmToScreen(edge.end.x, edge.end.y, width, height);
                ctx.save();
                ctx.strokeStyle = '#4c9aff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(s1.x, s1.y);
                ctx.lineTo(s2.x, s2.y);
                ctx.stroke();
                ctx.restore();
              }
              drawCadLinearDimension(
                edge.start,
                edge.end,
                edge.outwardNormal,
                isEdgeActive ? 20 : 14,
                isEdgeActive
                  ? `边${edge.edgeIndex + 1}:${edge.lengthMm}mm`
                  : `${edge.lengthMm}`,
                isEdgeActive ? '#4c9aff' : 'rgba(76, 154, 255, 0.72)',
                isEdgeActive,
              );
            });
          } else if (activeEdgeIdx !== null && dim.edges[activeEdgeIdx]) {
            const selEdge = dim.edges[activeEdgeIdx];
            const s1 = mmToScreen(selEdge.start.x, selEdge.start.y, width, height);
            const s2 = mmToScreen(selEdge.end.x, selEdge.end.y, width, height);
            ctx.save();
            ctx.strokeStyle = '#4c9aff';
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.stroke();
            ctx.restore();

            drawCadLinearDimension(
              selEdge.start,
              selEdge.end,
              selEdge.outwardNormal,
              20,
              `边${activeEdgeIdx + 1}: ${selEdge.lengthMm}mm (∠${selEdge.angleDeg}°)`,
              '#4c9aff',
              true,
            );
          }
        }
      }

      if (!isDrawingTool && isPrimarySelected && selectedIds.length === 1) {
        // Vertex handles (■ 方形顶点控点)
        if (!shape.locked && shape.points.length <= 16) {
          shape.points.forEach((pt, idx) => {
            const s = mmToScreen(pt.x, pt.y, width, height);
            ctx.fillStyle = draggingVertexIdx === idx ? '#4c9aff' : '#272a2f';
            ctx.strokeStyle = '#4c9aff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(s.x - 4.5, s.y - 4.5, 9, 9);
            ctx.fill();
            ctx.stroke();
          });
        }

        // Bounding-Box Midpoint Resize Handles (● 圆形缩放控点)
        if (!shape.locked && bounds.widthX >= 4 && bounds.depthY >= 4) {
          const edgeHandles: { side: ResizeEdgeSide; pt: Point2D }[] = [
            { side: 'left', pt: { x: bounds.minX, y: bounds.centroid.y } },
            { side: 'right', pt: { x: bounds.maxX, y: bounds.centroid.y } },
            { side: 'top', pt: { x: bounds.centroid.x, y: bounds.maxY } },
            { side: 'bottom', pt: { x: bounds.centroid.x, y: bounds.minY } },
          ];
          edgeHandles.forEach((h) => {
            const hs = mmToScreen(h.pt.x, h.pt.y, width, height);
            const isDraggingThis = draggingResizeEdge?.side === h.side;
            ctx.fillStyle = isDraggingThis ? '#4c9aff' : '#4c9aff';
            ctx.strokeStyle = '#272a2f';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(hs.x, hs.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
        }
      }

      ctx.restore();
    });

    // 4c. Render Group Bounding Box when multiple shapes are batch-selected
    if (!isDrawingTool && !marqueeBox && selectedIds.length > 1) {
      const batchShapes = shapes.filter((s) => selectedIdSet.has(s.id) && s.visible);
      const allPts = batchShapes.flatMap((s) => s.points);
      if (allPts.length > 0) {
        const groupBounds = computeBounds2D(allPts);
        const totalArea = batchShapes.reduce(
          (acc, s) => acc + computeShapeDimensions(s).areaMm2,
          0,
        );
        const tl = mmToScreen(groupBounds.minX, groupBounds.maxY, width, height);
        const br = mmToScreen(groupBounds.maxX, groupBounds.minY, width, height);

        ctx.save();
        ctx.strokeStyle = '#4c9aff';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(
          tl.x - 8,
          tl.y - 8,
          br.x - tl.x + 16,
          br.y - tl.y + 16,
        );
        ctx.setLineDash([]);

        const referencesOnly = batchShapes.every((shape) => shape.type === 'point' || shape.type === 'segment');
        const groupLabel = `已选中 ${batchShapes.length} 个对象${referencesOnly ? '' : ` · 面积 ${totalArea.toFixed(0)}mm²`} · 拖动可整体移动`;
        ctx.font = '600 10.5px "JetBrains Mono", "Noto Sans SC", monospace';
        const gw = ctx.measureText(t(groupLabel)).width + 14;
        const gx = (tl.x + br.x) / 2;
        const gy = Math.max(20, tl.y - 20);

        ctx.fillStyle = 'rgba(39, 42, 47, 0.97)';
        ctx.fillRect(gx - gw / 2, gy - 10, gw, 20);
        ctx.strokeStyle = '#4c9aff';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(gx - gw / 2, gy - 10, gw, 20);
        ctx.fillStyle = '#4c9aff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t(groupLabel), gx, gy);
        ctx.restore();
      }
    }

    // Neutral selection windows: solid containment, dashed crossing.
    if (marqueeBox && marqueePreview) {
      const s0 = mmToScreen(marqueeBox.startMm.x, marqueeBox.startMm.y, width, height);
      const s1 = mmToScreen(marqueeBox.currentMm.x, marqueeBox.currentMm.y, width, height);
      const rx = Math.min(s0.x, s1.x);
      const ry = Math.min(s0.y, s1.y);
      const rw = Math.abs(s1.x - s0.x);
      const rh = Math.abs(s1.y - s0.y);

      const isWindowMode = marqueePreview.mode === 'window';

      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.strokeStyle = '#eeeeee';
      ctx.lineWidth = 1;
      if (!isWindowMode) {
        ctx.setLineDash([4, 3]);
      }
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);

      const changedCount = marqueePreview.selectedIds.filter(id => marqueeBox.operation === 'remove'
        ? marqueeBox.initialIds.includes(id) : marqueeBox.operation === 'add' ? !marqueeBox.initialIds.includes(id) : true).length;
      const boxLabel = `${isWindowMode ? '包含 →' : '← 交叉'} · ${marqueeBox.operation === 'remove' ? '减选' : marqueeBox.operation === 'add' ? '追加' : '选中'} ${changedCount}`;
      ctx.font = '500 10px "JetBrains Mono", "Noto Sans SC", monospace';
      const lw = ctx.measureText(t(boxLabel)).width + 12;
      const lx = Math.max(lw / 2 + 4, Math.min(width - lw / 2 - 4, s1.x + lw / 2 + 10));
      const ly = Math.max(14, Math.min(height - 14, s1.y + 20));

      ctx.fillStyle = 'rgba(17, 19, 22, 0.94)';
      ctx.fillRect(lx - lw / 2, ly - 9, lw, 18);
      ctx.fillStyle = '#eeeeee';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t(boxLabel), lx, ly);
      ctx.restore();
    }

    // 5. Render active drawing preview with live CAD dimension annotations
    if (activeTool === 'polyline' && draftPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#4c9aff';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      draftPoints.forEach((pt, i) => {
        const s = mmToScreen(pt.x, pt.y, width, height);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      const curScreen = mmToScreen(drawingPreviewPoint.x, drawingPreviewPoint.y, width, height);
      ctx.lineTo(curScreen.x, curScreen.y);
      ctx.stroke();

      draftPoints.forEach((pt, i) => {
        const s = mmToScreen(pt.x, pt.y, width, height);
        ctx.fillStyle = i === 0 ? '#a3abb8' : '#4c9aff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, i === 0 ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    } else if (
      dragStartMm &&
      (activeTool === 'line' ||
        activeTool === 'rect' ||
        activeTool === 'triangle' ||
        activeTool === 'circle')
    ) {
      ctx.save();
      ctx.strokeStyle = '#4c9aff';
      ctx.fillStyle = 'rgba(76, 154, 255, 0.22)';
      ctx.lineWidth = 2.2;

      if (activeTool === 'line') {
        const startScreen = mmToScreen(dragStartMm.x, dragStartMm.y, width, height);
        const curScreen = mmToScreen(drawingPreviewPoint.x, drawingPreviewPoint.y, width, height);
        ctx.beginPath();
        ctx.moveTo(startScreen.x, startScreen.y);
        ctx.lineTo(curScreen.x, curScreen.y);
        ctx.stroke();
        [startScreen, curScreen].forEach((endpoint) => {
          ctx.beginPath(); ctx.arc(endpoint.x, endpoint.y, 3.5, 0, Math.PI * 2); ctx.stroke();
        });

        const lenMm = Math.hypot(drawingPreviewPoint.x - dragStartMm.x, drawingPreviewPoint.y - dragStartMm.y);
        ctx.fillStyle = '#4c9aff';
        ctx.font = '600 11px "JetBrains Mono", "Noto Sans SC", monospace';
        ctx.fillText(
          t(`长度 L=${lenMm.toFixed(2)} mm`),
          curScreen.x + 10,
          curScreen.y - 10,
        );
      } else if (activeTool === 'rect') {
        const s0 = mmToScreen(dragStartMm.x, dragStartMm.y, width, height);
        const s1 = mmToScreen(drawingPreviewPoint.x, drawingPreviewPoint.y, width, height);
        const rx = Math.min(s0.x, s1.x);
        const ry = Math.min(s0.y, s1.y);
        const rw = Math.abs(s1.x - s0.x);
        const rh = Math.abs(s1.y - s0.y);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (activeTool === 'triangle') {
        const w = Math.abs(drawingPreviewPoint.x - dragStartMm.x);
        const d = Math.abs(drawingPreviewPoint.y - dragStartMm.y);
        const cxMm = (drawingPreviewPoint.x + dragStartMm.x) / 2;
        const cyMm = (drawingPreviewPoint.y + dragStartMm.y) / 2;
        const triPts = createTrianglePoints(cxMm, cyMm, w, d);
        ctx.beginPath();
        triPts.forEach((pt, idx) => {
          const s = mmToScreen(pt.x, pt.y, width, height);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (activeTool === 'circle') {
        const radiusMm = Math.hypot(drawingPreviewPoint.x - dragStartMm.x, drawingPreviewPoint.y - dragStartMm.y) / (diameterMode ? 2 : 1);
        const previewPts = createRegularPolygonPoints(
          dragStartMm.x,
          dragStartMm.y,
          radiusMm,
          32,
        );
        ctx.beginPath();
        previewPts.forEach((pt, idx) => {
          const s = mmToScreen(pt.x, pt.y, width, height);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5b. Boolean operation preview (blue dashed outline, not yet committed)
    if (booleanPreview && booleanPreview.points.length >= 3) {
      ctx.save();
      ctx.beginPath();
      booleanPreview.points.forEach((pt, idx) => {
        const s = mmToScreen(pt.x, pt.y, width, height);
        if (idx === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      if (booleanPreview.holePoints && booleanPreview.holePoints.length >= 3) {
        booleanPreview.holePoints.forEach((pt, idx) => {
          const s = mmToScreen(pt.x, pt.y, width, height);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(76, 154, 255, 0.16)';
      ctx.fill('evenodd');
      ctx.setLineDash([7, 4]);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#4c9aff';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (activeTool === 'measure' && measurementPoints.length && measurement) {
      const a = mmToScreen(measurementPoints[0].x, measurementPoints[0].y, width, height);
      const b = mmToScreen(measurementEnd.x, measurementEnd.y, width, height);
      ctx.save();
      ctx.strokeStyle = '#f0c577';
      ctx.fillStyle = '#f0c577';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      [a, b].forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill(); });
      drawHaloText(`${measurement.distance.toFixed(2)} mm`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 15, '#f0c577', 12);
      ctx.restore();
    }

    // 5c. Geometry snap indicator (端点□ / 中点△ / 圆心◎)
    if (geometrySnap && !(isDrawingTool && sizeInput.trim()) && !(hotGrip && gripInput.trim())) {
      const gs = mmToScreen(geometrySnap.point.x, geometrySnap.point.y, width, height);
      ctx.save();
      ctx.strokeStyle = '#59d98e';
      ctx.fillStyle = 'rgba(89, 217, 142, 0.25)';
      ctx.lineWidth = 2;
      if (geometrySnap.kind === 'endpoint') {
        ctx.beginPath();
        ctx.rect(gs.x - 5, gs.y - 5, 10, 10);
        ctx.fill();
        ctx.stroke();
      } else if (geometrySnap.kind === 'midpoint') {
        ctx.beginPath();
        ctx.moveTo(gs.x, gs.y - 6);
        ctx.lineTo(gs.x + 6, gs.y + 5);
        ctx.lineTo(gs.x - 6, gs.y + 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(gs.x, gs.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gs.x - 9, gs.y);
        ctx.lineTo(gs.x + 9, gs.y);
        ctx.moveTo(gs.x, gs.y - 9);
        ctx.lineTo(gs.x, gs.y + 9);
        ctx.stroke();
      }
      const kindLabel =
        geometrySnap.kind === 'endpoint'
          ? '端点'
          : geometrySnap.kind === 'midpoint'
            ? '中点'
            : '圆心';
      const tipX = Math.min(width - 40, Math.max(2, gs.x + 12));
      const tipY = Math.min(height - 24, Math.max(2, gs.y + 12));
      ctx.fillStyle = '#0e1712'; ctx.fillRect(tipX, tipY, 36, 20);
      ctx.strokeStyle = '#2b4e39'; ctx.lineWidth = 1; ctx.strokeRect(tipX, tipY, 36, 20);
      ctx.fillStyle = '#76dfa1'; ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t(kindLabel), tipX + 6, tipY + 10);
      ctx.restore();
    }

    if (hotGrip) {
      ctx.save(); ctx.strokeStyle = '#89bcff'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      for (const shape of gripPreview.shapes ?? []) {
        const old = hotGrip.snapshot.find(s => s.id === shape.id);
        if (!shape.visible || isSameHistoryItem(old, shape)) continue;
        const pts = shape.points.map(p => mmToScreen(p.x, p.y, width, height));
        ctx.beginPath();
        if (shape.type === 'point') {
          ctx.moveTo(pts[0].x - 5, pts[0].y); ctx.lineTo(pts[0].x + 5, pts[0].y);
          ctx.moveTo(pts[0].x, pts[0].y - 5); ctx.lineTo(pts[0].x, pts[0].y + 5);
        } else pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
      }
      const base = mmToScreen(hotGrip.base.x, hotGrip.base.y, width, height);
      const target = mmToScreen(gripGuide.target.x, gripGuide.target.y, width, height);
      ctx.strokeStyle = '#edb870'; ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(target.x, target.y); ctx.stroke();
      if (hotGrip.mode === 'rotate' || hotGrip.mode === 'mirror') {
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(base.x + 65, base.y); ctx.stroke();
        drawHaloText('+X · 0°', base.x + 65, base.y - 10, '#edb870', 10);
      }
      ctx.setLineDash([]); ctx.fillStyle = '#ed6262'; ctx.strokeStyle = '#ffd6d6';
      ctx.fillRect(base.x - 4, base.y - 4, 8, 8); ctx.strokeRect(base.x - 4, base.y - 4, 8, 8);
      ctx.restore();
    }

    // 6. Snap cursor crosshair
    const curScreen = mmToScreen(cursorMm.x, cursorMm.y, width, height);
    ctx.strokeStyle = marqueeBox ? '#eeeeee' : 'rgba(76, 154, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(curScreen.x - 8, curScreen.y);
    ctx.lineTo(curScreen.x + 8, curScreen.y);
    ctx.moveTo(curScreen.x, curScreen.y - 8);
    ctx.lineTo(curScreen.x, curScreen.y + 8);
    ctx.stroke();

    ctx.restore();
  }, [
    canvasSize,
    locale,
    gridVisible,
    hotGrip,
    gripPreview,
    gripGuide,
    drawingPreviewPoint,
    display,
    linkedPointIds,
    dragAffectedIds,
    dragStarted,
    hoveredTarget,
    shapes,
    selectedId,
    selectedIds,
    selectedIdSet,
    selectedEdgeIndex,
    showDimensions,
    smartGuidesEnabled,
    displayedSnapGuides,
    marqueeBox,
    marqueePreview,
    zoom,
    pan,
    gridStep,
    activeTool,
    draftPoints,
    dragStartMm,
    cursorMm,
    draggingVertexIdx,
    draggingSingleEdge,
    draggingHoleVertexIdx,
    draggingResizeEdge,
    draggingWholeShape,
    defaultZHeight,
    booleanPreview,
    geometrySnap,
    sizeInput,
    gripInput,
    diameterMode,
    measurementPoints,
    measurementEnd,
    measurement,
    mmToScreen,
  ]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (e.button === 2 && marqueeBox) { cancelInteraction(); return; }
    if (e.button === 2 && isDrawingTool) {
      if (activeTool === 'polyline' && draftPoints.length) commitPolyline();
      else finishDrawing();
      return;
    }
    // Middle / Alt+left pans in every mode; right pans only outside drawing commands.
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
      setIsPanning({ startX: e.clientX, startY: e.clientY, origPan: { ...pan } });
      return;
    }
    if (e.button !== 0) return;

    const rawMm = screenToMm(px, py, rect.width, rect.height, false);
    if (hotGrip) {
      const resolvedGrip = resolveGripPoint(rawMm, e.shiftKey);
      commitGrip(resolvedGrip.point);
      return;
    }
    rawDrawingCursorRef.current = rawMm;
    drawingShiftRef.current = e.shiftKey;
    const resolved = resolveDrawingPoint(rawMm, e.shiftKey);
    const geoOnDown = resolved.snap;
    const ptMm = resolved.point;
    const isAdditive = e.ctrlKey || e.metaKey || e.shiftKey;

    if (activeTool === 'measure') {
      setMeasurementPoints((points) => points.length === 1 ? [...points, ptMm] : [ptMm]);
      setCursorMm(ptMm);
      setGeometrySnap(geoOnDown);
      return;
    }

    if (activeTool === 'polyline') {
      if (sizeInput.trim()) submitDrawingInput(ptMm); else commitDrawingPoint(ptMm);
      return;
    }

    if (
      activeTool === 'point' ||
      activeTool === 'line' ||
      activeTool === 'rect' ||
      activeTool === 'triangle' ||
      activeTool === 'circle'
    ) {
      if (sizeInput.trim()) submitDrawingInput(ptMm); else commitDrawingPoint(ptMm);
      return;
    }

    const selectWholeShape = (shape: CadShape) => {
      setSelectedEdgeIndex(null);
      if (isAdditive) {
        const nextIds = updateSelection(selectedIds, [shape.id], e.shiftKey ? 'remove' : 'toggle');
        commitSelectedIds(nextIds);
        setSelectionModeLabel(`多选模式：已选中 ${nextIds.length} 个对象`);
        return;
      }
      const nextIds = selectedIdSet.has(shape.id) && selectedIds.length > 1 ? selectedIds : [shape.id];
      commitSelectedIds(nextIds);
      setSelectionModeLabel(nextIds.length > 1 ? `批量移动：已选中 ${nextIds.length} 个对象` : `选整体对象：${shape.name}`);
      const origShapesMap: Record<string, { points: Point2D[]; holePoints?: Point2D[] }> = {};
      shapes.forEach((candidate) => {
        if (nextIds.includes(candidate.id) && candidate.visible && !candidate.locked) {
          origShapesMap[candidate.id] = {
            points: candidate.points.map((point) => ({ ...point })),
            holePoints: candidate.holePoints?.map((point) => ({ ...point })),
          };
        }
      });
      if (origShapesMap[shape.id]) setDraggingWholeShape({ primaryShapeId: shape.id,
        movingIds: nextIds.filter((id) => Boolean(origShapesMap[id])), startMm: rawMm, origShapesMap });
    };

    // Cold sketch grips: a click activates a hot grip; a held drag keeps the direct-drag workflow.
    if (!isAdditive) {
      setGripError('');
      for (const shape of shapes.filter(s => selectedIdSet.has(s.id) && s.visible && !s.locked && (s.type === 'point' || s.type === 'segment'))) {
        const grips = shape.points.map((base, vertexIndex) => ({ base, vertexIndex: vertexIndex as number | undefined }));
        if (shape.type === 'segment') grips.push({ base: { x: (shape.points[0].x + shape.points[1].x) / 2, y: (shape.points[0].y + shape.points[1].y) / 2 }, vertexIndex: undefined });
        const grip = grips.find(g => Math.hypot(rawMm.x - g.base.x, rawMm.y - g.base.y) * zoom <= 8);
        if (!grip) continue;
        const affected = sketchDragAffectedIds(shapes, grip.vertexIndex === undefined ? selectedIds : [shape.id], grip.vertexIndex);
        const locked = shapes.find(s => s.locked && affected.has(s.id));
        if (locked) { setGripError(`「${locked.name}」已锁定，请先解锁相连对象。`); return; }
        pendingGripRef.current = { ...grip, shapeId: shape.id, snapshot: shapes, selectedIds: [...selectedIds], mode: grip.vertexIndex === undefined ? 'move' : 'stretch' };
        if (shape.type === 'segment' && grip.vertexIndex !== undefined && selectedIds.length === 1) setDraggingVertexIdx(grip.vertexIndex);
        else selectWholeShape(shape);
        return;
      }
    }

    // Tool === 'select'
    // 1. LEVEL 1 — 选点 (Vertex Handle ■ or Edge Resize Handle ● of the selected shape)
    if (selectedShape && selectedShape.type !== 'point' && selectedIds.length === 1 && !selectedShape.locked && !isAdditive) {
      if (selectedShape.points.length <= 16) {
        for (let i = 0; i < selectedShape.points.length; i++) {
          const vScreen = mmToScreen(
            selectedShape.points[i].x,
            selectedShape.points[i].y,
            rect.width,
            rect.height,
          );
          if (Math.hypot(px - vScreen.x, py - vScreen.y) <= 10) {
            setDraggingVertexIdx(i);
            setSelectionModeLabel(selectedShape.type === 'segment' ? `两点直线：正在拖拽${i === 0 ? '起点' : '终点'}` : `选点模式：正在拖拽顶点 #${i + 1}`);
            return;
          }
        }
      }

      const bounds = computeBounds2D(selectedShape.points);
      if (selectedShape.type !== 'segment' && bounds.widthX >= 4 && bounds.depthY >= 4) {
        const edgeHandles: { side: ResizeEdgeSide; pt: Point2D }[] = [
          { side: 'left', pt: { x: bounds.minX, y: bounds.centroid.y } },
          { side: 'right', pt: { x: bounds.maxX, y: bounds.centroid.y } },
          { side: 'top', pt: { x: bounds.centroid.x, y: bounds.maxY } },
          { side: 'bottom', pt: { x: bounds.centroid.x, y: bounds.minY } },
        ];
        for (const h of edgeHandles) {
          const hs = mmToScreen(h.pt.x, h.pt.y, rect.width, rect.height);
          if (Math.hypot(px - hs.x, py - hs.y) <= 9) {
            setDraggingResizeEdge({
              shapeId: selectedShape.id,
              side: h.side,
              origPoints: selectedShape.points.map((p) => ({ ...p })),
              origHolePoints: selectedShape.holePoints?.map((p) => ({ ...p })),
              origBounds: bounds,
            });
            setSelectionModeLabel(`选边缩放：正在拖拽 ${h.side} 边缘控点`);
            return;
          }
        }
      }
    }

    // A standalone point is selected/moved as an object, never as a polygon vertex.
    const pointHit = hitPoint(rawMm);
    if (pointHit) { selectWholeShape(pointHit); return; }

    // 2. LEVEL 2 — 选线 (Click/Drag directly on a shape's border line / edge within ~7px)
    const edgeToleranceMm = 7 / zoom;
    const closestEdge = findClosestShapeEdge(rawMm, shapes, edgeToleranceMm);
    const edgeShape = closestEdge ? shapes.find((shape) => shape.id === closestEdge.shapeId) : null;
    if (edgeShape?.type === 'segment') { selectWholeShape(edgeShape); return; }
    if (edgeShape && isAdditive) { selectWholeShape(edgeShape); return; }
    if (closestEdge && !isAdditive) {
      const targetShape = shapes.find((s) => s.id === closestEdge.shapeId);
      commitSelectedIds([closestEdge.shapeId]);
      setSelectedEdgeIndex(closestEdge.edgeIndex);
      setSelectionModeLabel(
        `选线模式：已选中 边#${closestEdge.edgeIndex + 1} (${closestEdge.edge.lengthMm}mm)，拖动可推拉该边`,
      );
      if (targetShape && !targetShape.locked && targetShape.points.length <= 16) {
        setDraggingSingleEdge({
          shapeId: targetShape.id,
          edgeIndex: closestEdge.edgeIndex,
          startMm: rawMm,
          origPoints: targetShape.points.map((p) => ({ ...p })),
        });
      }
      return;
    }

    // 3. LEVEL 3 — 选整体图形 / 多选移动 (Click inside a shape's fill area)
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (!s.visible) continue;
      if (s.type !== 'point' && s.type !== 'segment' && isPointInPolygon(rawMm, s.points)) {
        selectWholeShape(s);
        return;
      }
    }

    // A blank click clears selection; only a held drag opens a selection box.
    setSelectedEdgeIndex(null);
    setActiveSnapGuides([]);
    setHoveredTarget({ shapeId: null, edgeIndex: null });
    setMarqueeBox({
      startMm: rawMm,
      currentMm: rawMm,
      operation: selectionOperation(e),
      phase: 'pending',
      initialIds: [...selectedIds],
    });
    setSelectionModeLabel('框选：左→右完全包含，右→左碰到即选；Ctrl追加，Shift减选');
  };

  const handleMouseMove = (e: Pick<React.MouseEvent<HTMLCanvasElement>, 'clientX' | 'clientY' | 'shiftKey' | 'ctrlKey' | 'metaKey'>) => {
    pointerCurrentRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (isPanning) {
      setPan({
        x: isPanning.origPan.x + (e.clientX - isPanning.startX),
        y: isPanning.origPan.y + (e.clientY - isPanning.startY),
      });
      return;
    }

    const rawMm = screenToMm(px, py, rect.width, rect.height, false);
    rawDrawingCursorRef.current = rawMm;
    drawingShiftRef.current = e.shiftKey;
    const ptMm = screenToMm(px, py, rect.width, rect.height, true);
    if (hotGrip) {
      const resolved = resolveGripPoint(rawMm, e.shiftKey);
      setCursorMm(resolved.point); setGeometrySnap(resolved.snap); setGripError('');
      return;
    }
    const snapTolMm = 7 / zoom;

    if (isDrawingTool || activeTool === 'measure') {
      const resolved = resolveDrawingPoint(rawMm, e.shiftKey);
      setGeometrySnap(resolved.snap);
      setCursorMm(resolved.point);
      setActiveSnapGuides([]);
      return;
    }

    // 0. Active CAD Marquee Selection Box drag
    if (marqueeBox) {
      const corner = screenToMm(Math.max(0, Math.min(rect.width, px)), Math.max(0, Math.min(rect.height, py)), rect.width, rect.height, false);
      const moved = Math.hypot(e.clientX - pointerStartRef.current.x, e.clientY - pointerStartRef.current.y) >= 3;
      setMarqueeBox((prev) => (prev ? { ...prev, phase: moved ? 'drag' : prev.phase, currentMm: corner, operation: selectionOperation(e) } : null));
      setCursorMm(corner); setGeometrySnap(null);
      return;
    }

    // 1. Resizing a single vertex with Smart Snap Guides
    const editing = draggingVertexIdx !== null || draggingSingleEdge || draggingResizeEdge || draggingHoleVertexIdx !== null || draggingWholeShape;
    if (editing && !dragHistoryPushedRef.current && Math.hypot(e.clientX - pointerStartRef.current.x, e.clientY - pointerStartRef.current.y) < 3) return;
    if (editing) { setDragStarted(true); pendingGripRef.current = null; }
    if (editing && dragLockedShape) { setGeometrySnap(null); setActiveSnapGuides([]); return; }
    if (draggingVertexIdx !== null && selectedShape) {
      const candidates = selectedShape.type === 'segment' ? shapes.filter(shape => !dragAffectedIds.has(shape.id)) : shapes;
      const smartSnap = computePointSnapGuides(
        rawMm,
        selectedShape.id,
        candidates,
        snapTolMm,
        smartGuidesEnabled,
        draggingVertexIdx,
      );
      const hasXGuide = smartSnap.guides.some((g) => g.axis === 'x');
      const hasYGuide = smartSnap.guides.some((g) => g.axis === 'y');
      const endpointSnap = selectedShape.type === 'segment' && objectSnapEnabled
        ? findGeometrySnap(rawMm, candidates, 8 / zoom) : null;
      let finalX = endpointSnap?.point.x ?? (hasXGuide ? smartSnap.snappedPt.x : ptMm.x);
      let finalY = endpointSnap?.point.y ?? (hasYGuide ? smartSnap.snappedPt.y : ptMm.y);
      const anchor = dragSnapshotRef.current?.shapes.find(shape => shape.id === selectedShape.id)?.points[draggingVertexIdx];
      const orthogonal = selectedShape.type === 'segment' && !endpointSnap && orthoEnabled !== e.shiftKey && anchor;
      if (orthogonal) {
        if (Math.abs(rawMm.x - anchor.x) >= Math.abs(rawMm.y - anchor.y)) finalY = anchor.y;
        else finalX = anchor.x;
      }

      setCursorMm({ x: finalX, y: finalY });
      setActiveSnapGuides(endpointSnap || orthogonal ? [] : smartSnap.guides);
      setGeometrySnap(endpointSnap);

      const nextPts = selectedShape.points.map((p, idx) =>
        idx === draggingVertexIdx ? { x: finalX, y: finalY } : p,
      );
      if (selectedShape.type === 'segment' && Math.hypot(nextPts[0].x - nextPts[1].x, nextPts[0].y - nextPts[1].y) < 1e-8) return;
      updateDraggedShape({ ...selectedShape, points: nextPts });
      return;
    }

    // 1b. Pushing/pulling a single selected edge (moves both endpoints of that edge)
    if (draggingSingleEdge) {
      const target = shapes.find((s) => s.id === draggingSingleEdge.shapeId);
      if (target) {
        const rawDx = rawMm.x - draggingSingleEdge.startMm.x;
        const rawDy = rawMm.y - draggingSingleEdge.startMm.y;
        const snappedDx = snapToGrid(rawDx, gridStep, snapEnabled);
        const snappedDy = snapToGrid(rawDy, gridStep, snapEnabled);
        const idxA = draggingSingleEdge.edgeIndex;
        const idxB = (idxA + 1) % draggingSingleEdge.origPoints.length;
        const nextPts = draggingSingleEdge.origPoints.map((p, idx) =>
          idx === idxA || idx === idxB
            ? {
                x: Math.round((p.x + snappedDx) * 100) / 100,
                y: Math.round((p.y + snappedDy) * 100) / 100,
              }
            : p,
        );
        updateDraggedShape({ ...target, points: nextPts });
      }
      setCursorMm(ptMm);
      return;
    }

    // 2. Resizing a bounding-box edge handle (left/right/top/bottom) with Smart Snap Guides
    if (draggingResizeEdge) {
      const target = shapes.find((s) => s.id === draggingResizeEdge.shapeId);
      if (target) {
        const smartSnap = computePointSnapGuides(
          rawMm,
          target.id,
          shapes,
          snapTolMm,
          smartGuidesEnabled,
        );
        const { side, origBounds, origPoints, origHolePoints } = draggingResizeEdge;
        const relevantGuides = smartSnap.guides.filter((g) =>
          side === 'left' || side === 'right' ? g.axis === 'x' : g.axis === 'y',
        );
        setActiveSnapGuides(relevantGuides);

        const snappedEdgeX = relevantGuides.some((g) => g.axis === 'x')
          ? smartSnap.snappedPt.x
          : ptMm.x;
        const snappedEdgeY = relevantGuides.some((g) => g.axis === 'y')
          ? smartSnap.snappedPt.y
          : ptMm.y;

        setCursorMm({ x: snappedEdgeX, y: snappedEdgeY });

        const scalePoint = (p: Point2D): Point2D => {
          let x = p.x;
          let y = p.y;
          if (side === 'right' && origBounds.widthX > 1) {
            const newW = Math.max(4, snappedEdgeX - origBounds.minX);
            x = origBounds.minX + ((p.x - origBounds.minX) / origBounds.widthX) * newW;
          } else if (side === 'left' && origBounds.widthX > 1) {
            const newMinX = Math.min(origBounds.maxX - 4, snappedEdgeX);
            const newW = origBounds.maxX - newMinX;
            x = origBounds.maxX - ((origBounds.maxX - p.x) / origBounds.widthX) * newW;
          } else if (side === 'top' && origBounds.depthY > 1) {
            const newD = Math.max(4, snappedEdgeY - origBounds.minY);
            y = origBounds.minY + ((p.y - origBounds.minY) / origBounds.depthY) * newD;
          } else if (side === 'bottom' && origBounds.depthY > 1) {
            const newMinY = Math.min(origBounds.maxY - 4, snappedEdgeY);
            const newD = origBounds.maxY - newMinY;
            y = origBounds.maxY - ((origBounds.maxY - p.y) / origBounds.depthY) * newD;
          }
          return {
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100,
          };
        };

        updateDraggedShape(
          {
            ...target,
            points: origPoints.map(scalePoint),
            holePoints: origHolePoints?.map(scalePoint),
          },
        );
      }
      return;
    }

    if (draggingHoleVertexIdx !== null && selectedShape && selectedShape.holePoints) {
      setCursorMm(ptMm);
      const nextHole = selectedShape.holePoints.map((p, idx) =>
        idx === draggingHoleVertexIdx ? { x: ptMm.x, y: ptMm.y } : p,
      );
      updateDraggedShape({ ...selectedShape, holePoints: nextHole });
      return;
    }

    // 3. Moving single or batch-selected shapes with Smart Snap Guides
    if (draggingWholeShape) {
      const primaryOrig =
        draggingWholeShape.origShapesMap[draggingWholeShape.primaryShapeId];
      if (primaryOrig) {
        const rawDx = rawMm.x - draggingWholeShape.startMm.x;
        const rawDy = rawMm.y - draggingWholeShape.startMm.y;

        const rawCandidatePts = primaryOrig.points.map((p) => ({
          x: p.x + rawDx,
          y: p.y + rawDy,
        }));

        const nonMovingShapes = shapes.filter(
          (s) => !dragAffectedIds.has(s.id),
        );
        const moveSnap = computeMoveSnapGuides(
          rawCandidatePts,
          draggingWholeShape.primaryShapeId,
          nonMovingShapes,
          snapTolMm,
          smartGuidesEnabled,
        );

        const hasXSnap = moveSnap.guides.some((g) => g.axis === 'x');
        const hasYSnap = moveSnap.guides.some((g) => g.axis === 'y');

        let finalDx = hasXSnap
          ? rawDx + moveSnap.snappedDelta.x
          : snapToGrid(rawDx, gridStep, snapEnabled);
        let finalDy = hasYSnap
          ? rawDy + moveSnap.snappedDelta.y
          : snapToGrid(rawDy, gridStep, snapEnabled);

        const primary = shapes.find(shape => shape.id === draggingWholeShape.primaryShapeId);
        const isSketch = primary?.type === 'point' || primary?.type === 'segment';
        // Points use their actual position as the base; lines use the user's grab position.
        const base = primary?.type === 'point' ? primaryOrig.points[0] : draggingWholeShape.startMm;
        const target = { x: base.x + rawDx, y: base.y + rawDy };
        const sources = primary?.type === 'segment' ? [target, ...rawCandidatePts,
          { x: (rawCandidatePts[0].x + rawCandidatePts[1].x) / 2, y: (rawCandidatePts[0].y + rawCandidatePts[1].y) / 2 }] : [target];
        const matches = isSketch && objectSnapEnabled ? sources.flatMap(source => {
          const snap = findGeometrySnap(source, nonMovingShapes, 8 / zoom);
          return snap ? [{ snap, source, distance: Math.hypot(snap.point.x - source.x, snap.point.y - source.y) }] : [];
        }).sort((a, b) => a.distance - b.distance) : [];
        const match = matches[0];
        const objectSnap = match?.snap ?? null;
        const orthogonal = isSketch && !objectSnap && orthoEnabled !== e.shiftKey;
        if (match) { finalDx = rawDx + match.snap.point.x - match.source.x; finalDy = rawDy + match.snap.point.y - match.source.y; }
        else if (orthogonal) {
          if (Math.abs(rawDx) >= Math.abs(rawDy)) finalDy = 0;
          else finalDx = 0;
        }
        setGeometrySnap(objectSnap);
        setActiveSnapGuides(objectSnap || orthogonal ? [] : moveSnap.guides);
        setCursorMm({
          x: Math.round((draggingWholeShape.startMm.x + finalDx) * 100) / 100,
          y: Math.round((draggingWholeShape.startMm.y + finalDy) * 100) / 100,
        });

        if (draggingWholeShape.movingIds.length > 1 && onUpdateMultipleShapes) {
          const nextShapes = shapes.map((s) => {
            const orig = draggingWholeShape.origShapesMap[s.id];
            if (!orig) return s;
            return {
              ...s,
              points: orig.points.map((p) => ({
                x: s.type === 'point' || s.type === 'segment' ? p.x + finalDx : Math.round((p.x + finalDx) * 100) / 100,
                y: s.type === 'point' || s.type === 'segment' ? p.y + finalDy : Math.round((p.y + finalDy) * 100) / 100,
              })),
              holePoints: orig.holePoints?.map((p) => ({
                x: Math.round((p.x + finalDx) * 100) / 100,
                y: Math.round((p.y + finalDy) * 100) / 100,
              })),
            };
          });
          updateDraggedShapes(nextShapes);
        } else {
          const target = shapes.find(
            (s) => s.id === draggingWholeShape.primaryShapeId,
          );
          if (target) {
            updateDraggedShape(
              {
                ...target,
                points: primaryOrig.points.map((p) => ({
                  x: target.type === 'point' || target.type === 'segment' ? p.x + finalDx : Math.round((p.x + finalDx) * 100) / 100,
                  y: target.type === 'point' || target.type === 'segment' ? p.y + finalDy : Math.round((p.y + finalDy) * 100) / 100,
                })),
                holePoints: primaryOrig.holePoints?.map((p) => ({
                  x: Math.round((p.x + finalDx) * 100) / 100,
                  y: Math.round((p.y + finalDy) * 100) / 100,
                })),
              },
            );
          }
        }
      }
      return;
    }

    // 5. Implicit Hover Detection (when idle in select mode: detect hovered edge or shape)
    if (activeTool === 'select') {
      const pointHit = hitPoint(rawMm);
      if (pointHit) { setHoveredTarget({ shapeId: pointHit.id, edgeIndex: null }); return; }
      const edgeHit = findClosestShapeEdge(rawMm, shapes, 6.5 / zoom);
      if (edgeHit) {
        setHoveredTarget((prev) =>
          prev.shapeId === edgeHit.shapeId && prev.edgeIndex === edgeHit.edgeIndex
            ? prev
            : { shapeId: edgeHit.shapeId, edgeIndex: edgeHit.edgeIndex },
        );
      } else {
        let foundShapeId: string | null = null;
        for (let i = shapes.length - 1; i >= 0; i--) {
          const s = shapes[i];
          if (!s.visible) continue;
          if (s.type !== 'point' && s.type !== 'segment' && isPointInPolygon(rawMm, s.points)) {
            foundShapeId = s.id;
            break;
          }
        }
        setHoveredTarget((prev) =>
          prev.shapeId === foundShapeId && prev.edgeIndex === null
            ? prev
            : { shapeId: foundShapeId, edgeIndex: null },
        );
      }
    }

    // Idle / select-mode: 同样计算几何捕捉指示，帮助用户找到精确落点
    setGeometrySnap(
      objectSnapEnabled ? findGeometrySnap(rawMm, shapes, snapTolMm) : null,
    );
    setCursorMm(ptMm);
  };

  const handleMouseUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    setDragStarted(false);
    dragHistoryPushedRef.current = false;
    setActiveSnapGuides([]);
    setGeometrySnap(null);
    if (isPanning) {
      setIsPanning(null);
      return;
    }
    if (marqueeBox) {
      const rect = event.currentTarget.getBoundingClientRect();
      const corner = screenToMm(Math.max(0, Math.min(rect.width, event.clientX - rect.left)), Math.max(0, Math.min(rect.height, event.clientY - rect.top)), rect.width, rect.height, false);
      completeMarquee(corner, selectionOperation(event));
      return;
    }
    if (draggingVertexIdx !== null) {
      setDraggingVertexIdx(null);
      return;
    }
    if (draggingSingleEdge !== null) {
      setDraggingSingleEdge(null);
      return;
    }
    if (draggingResizeEdge !== null) {
      setDraggingResizeEdge(null);
      return;
    }
    if (draggingHoleVertexIdx !== null) {
      setDraggingHoleVertexIdx(null);
      return;
    }
    if (draggingWholeShape) {
      setDraggingWholeShape(null);
      return;
    }

  };

  wheelHandlerRef.current = (event: WheelEvent) => {
    event.preventDefault();
    if (!isActive || keyboardBlocked || activePointerRef.current !== null) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const nextZoom = wheelZoom(zoom, event.deltaY, event.deltaMode, rect.height, 0.00028, 2800);
    setPan(zoomPanAt(pan, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, nextZoom / zoom));
    setZoom(nextZoom);
  };

  const activeEdgeIdxForHud =
    hoveredTarget.shapeId === selectedId && hoveredTarget.edgeIndex !== null
      ? hoveredTarget.edgeIndex
      : selectedEdgeIndex;

  const activeSelectedEdge =
    selectedDimensions &&
    activeEdgeIdxForHud !== null &&
    selectedDimensions.edges[activeEdgeIdxForHud]
      ? selectedDimensions.edges[activeEdgeIdxForHud]
      : null;

  const cycleAnnotationMode = () => {
    setAnnotationMode((prev) =>
      prev === 'adaptive' ? 'all' : prev === 'all' ? 'hidden' : 'adaptive',
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex flex-col bg-[#08090b] select-none overflow-hidden"
    >
      <div className="h-9 px-3 flex items-center justify-between gap-3 bg-[var(--paper)] border-b border-[var(--line)] shrink-0 z-10 overflow-x-auto">
        <div className="flex items-center gap-2 shrink-0"><span className="text-[11px] font-semibold text-[var(--ink)]">{t("二维草图")}</span><button type="button" aria-label={t("二维点线显示设置")} aria-expanded={displayOpen} onClick={() => setDisplayOpen(v => !v)} className="text-[11px] px-2 py-1 rounded border border-[var(--line)] text-[var(--muted)]">{t("显示")}</button></div>
        <div className="flex items-center gap-1 shrink-0">
          {t(activeTool === 'polyline' && draftPoints.length > 0 && <>
            <button type="button" onClick={commitPolyline} disabled={draftPoints.length < 2} className="h-6 px-2 rounded text-[11px] bg-[var(--blue)] text-[#101720] disabled:opacity-40">{t("完成")}</button>
            <button type="button" onClick={() => setDraftPoints([])} title={t("取消多边形")} aria-label={t("取消多边形")} className="p-1 text-[var(--muted)] hover:bg-[var(--surface)] rounded"><X className="w-3.5 h-3.5" /></button>
          </>)}
          <button type="button" onClick={() => { setSmartGuidesEnabled(v => !v); canvasRef.current?.focus({ preventScroll: true }); }} aria-label={t("切换智能对齐参考线")} title={t("智能对齐")} aria-pressed={smartGuidesEnabled} className={`p-1 rounded ${smartGuidesEnabled ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}><Magnet className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={cycleAnnotationMode} aria-label={t("切换CAD尺寸注释模式")} title={t("尺寸标注：自动 / 全部边 / 隐藏")} className="h-6 px-2 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)] rounded">{t("标注") + " "}{t(annotationMode === 'adaptive' ? '自动' : annotationMode === 'all' ? '全部' : '关')}</button>
          <button type="button" onClick={() => onChangeTool(activeTool === 'measure' ? 'select' : 'measure')} aria-label={t("两点测量")} aria-pressed={activeTool === 'measure'} title={t("两点测量 DI↵ · XY平面距离")} className={`p-1 rounded ${activeTool === 'measure' ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}><Ruler className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => { setObjectSnapEnabled((value) => !value); canvasRef.current?.focus({ preventScroll: true }); }} aria-label={t("切换对象捕捉")} aria-pressed={objectSnapEnabled} title={t("F3 · 端点、中点和中心捕捉")} className={`h-6 px-2 text-[11px] rounded ${objectSnapEnabled ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}>{t("捕捉 F3")}</button>
          <button type="button" onClick={() => { setOrthoEnabled((value) => !value); canvasRef.current?.focus({ preventScroll: true }); }} aria-label={t("切换正交模式")} aria-pressed={orthoEnabled} title={t("F8 · 水平或垂直；Shift临时反转")} className={`h-6 px-2 text-[11px] rounded ${orthoEnabled ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}>{t("正交 F8")}</button>
          <button type="button" onClick={() => { onToggleSnap(); canvasRef.current?.focus({ preventScroll: true }); }} aria-label={t("切换网格吸附")} aria-pressed={snapEnabled} title={t("F9 · 网格吸附，与对象捕捉独立")} className={`h-6 px-2 text-[11px] rounded ${snapEnabled ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}>{t("网格 F9") + " "}{t(snapEnabled ? `${gridStep} mm` : '关')}</button>
          <button type="button" onClick={() => { setGridVisible(value => !value); canvasRef.current?.focus({ preventScroll: true }); }} aria-label={t('切换网格显示')} aria-pressed={gridVisible} title={t('F7 · 网格显示')} className={`h-6 px-2 text-[11px] rounded ${gridVisible ? 'text-[var(--blue)] bg-[var(--selection)]' : 'text-[var(--muted)]'}`}>{t('网格 F7')}</button>
          <button type="button" onClick={() => setShowMouseGuide(v => !v)} aria-label={t("切换鼠标选点选线框选指南")} title={t("操作提示")} className="p-1 text-[var(--muted)] hover:bg-[var(--surface)] rounded"><HelpCircle className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={fitView} aria-label={t("重置XY二维视图")} title={t("适合视图 F")} className="p-1 text-[var(--muted)] hover:bg-[var(--surface)] rounded"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* CAD Mouse Selection Guide Bar (On-Demand Toggle) */}
      <ViewZoomControls label={t("二维")} percent={zoom / 2.8 * 100} onChange={changeZoomPercent} onFit={fitView} onFocusCanvas={() => canvasRef.current?.focus({ preventScroll: true })} />
      {t(displayOpen && <div role="region" aria-label={t("二维显示设置")} className="absolute left-3 top-20 z-30 max-w-[calc(100%-24px)] w-72 border border-[var(--line)] bg-[var(--paper)] rounded-md p-3 shadow-xl text-xs text-[var(--ink)] space-y-3">
        <div className="flex justify-between items-center"><strong>{t("二维点线显示")}</strong><button type="button" aria-label={t("关闭显示设置")} onClick={() => setDisplayOpen(false)}><X size={14} /></button></div>
        <label className="flex justify-between">{t("点样式")}<select aria-label={t("点显示样式")} value={display.pointStyle} onChange={e => setDisplay({...display, pointStyle:e.target.value})} className="bg-[var(--input)] border border-[var(--line)] rounded px-2"><option value="dot">{t("· 单点")}</option><option value="cross">{t("＋ 十字")}</option><option value="circle">{t("⊕ 圆十字")}</option></select></label>
        <label className="flex justify-between">{t("点尺寸")}<select aria-label={t("点显示尺寸")} value={display.pointSize} onChange={e => setDisplay({...display, pointSize:Number(e.target.value)})} className="bg-[var(--input)] border border-[var(--line)] rounded px-2">{t([4,7,10,12].map(size=><option key={size} value={size}>{t(size)} px</option>))}</select></label>
        <label className="flex justify-between">{t("线显示宽度")}<select aria-label={t("线显示宽度")} value={display.lineWidth} onChange={e => setDisplay({...display, lineWidth:Number(e.target.value)})} className="bg-[var(--input)] border border-[var(--line)] rounded px-2">{t([1,1.5,2,3].map(size=><option key={size} value={size}>{t(size)} px</option>))}</select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={display.nodes} onChange={e => setDisplay({...display,nodes:e.target.checked})} />{t("显示连线节点")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={display.names} onChange={e => setDisplay({...display,names:e.target.checked})} />{t("显示点名")}</label>
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">{t("节点靠近鼠标时显现，仍可选中、拖动与捕捉。尺寸为屏幕像素，缩放保持可读；仅调整二维显示，不改变工程几何或导出线宽。")}</p>
      </div>)}
      {t(showMouseGuide && activeTool === 'select' && (
        <div
          data-testid="cad-mouse-guide"
          className="hidden sm:flex items-center justify-between gap-2 px-3 py-1 bg-[var(--paper)] border-b border-[var(--line)] text-[11px] font-mono text-[var(--muted)] flex-wrap shrink-0 z-10"
        >
          <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap">
            <span>
              <strong className="text-[var(--blue)]">{t("1.手柄(■):")}</strong>{" " + t("拖动修改顶点或直线端点") + " "}</span>
            <span className="text-[var(--muted)]">|</span>
            <span>
              <strong className="text-[var(--blue)]">{t("2.直线(━):")}</strong>{" " + t("拖线身整体移动；实体边可推拉") + " "}</span>
            <span className="text-[var(--muted)]">|</span>
            <span>
              <strong className="text-[var(--ink)]">{t("3.选整体:")}</strong>{" " + t("拖定位点或图形内部移动(Ctrl多选)") + " "}</span>
            <span className="text-[var(--muted)]">|</span>
            <span>
              <strong className="text-[var(--ink)]">{t("4.左→右(实线):")}</strong>{" " + t("全包选中") + " "}</span>
            <span className="text-[var(--muted)]">|</span>
            <span>
              <strong className="text-[var(--ink)]">{t("5.右→左(虚线):")}</strong>{" " + t("碰到即选") + " "}</span>
          </div>
          <span className="text-[var(--muted)] whitespace-nowrap shrink-0">{" " + t("中键拖拽:平移 · 滚轮缩放视图") + " "}</span>
        </div>
      ))}

      {/* Main 2D XY Interactive Canvas */}
      <div className="relative flex-1 min-h-0 w-full">
        <canvas
          ref={canvasRef}
          data-testid="cad-2d-canvas"
          tabIndex={0}
          aria-label={t("二维草图画布")}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (isActive && !keyboardBlocked && e.isPrimary && e.button === 2 && marqueeBox) { e.preventDefault(); cancelInteraction(); return; }
            if (!isActive || keyboardBlocked || !e.isPrimary || activePointerRef.current !== null || ![0, 1, 2].includes(e.button)) return;
            e.currentTarget.focus({ preventScroll: true });
            e.currentTarget.setPointerCapture(e.pointerId);
            activePointerRef.current = e.pointerId;
            pointerStartRef.current = { x: e.clientX, y: e.clientY };
            pointerCurrentRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
            onInteractionChange?.(true);
            dragSnapshotRef.current = { shapes, pan };
            dragHistoryPushedRef.current = false;
            handleMouseDown(e);
          }}
          onPointerMove={(e) => {
            if (isActive && !keyboardBlocked && e.isPrimary) handleMouseMove(e);
          }}
          onPointerUp={(e) => {
            if (activePointerRef.current !== e.pointerId) return;
            const hadChanges = dragHistoryPushedRef.current;
            const pending = pendingGripRef.current;
            pendingGripRef.current = null;
            handleMouseUp(e);
            activePointerRef.current = null;
            dragSnapshotRef.current = null;
            if (hadChanges) onEndGeometryDrag?.();
            onInteractionChange?.(false);
            if (pending && !hadChanges && !dragStarted && Math.hypot(e.clientX - pointerStartRef.current.x, e.clientY - pointerStartRef.current.y) < 3) {
              setHotGrip(pending); setGripInput(''); setGripError('');
              setCursorMm(pending.base); rawDrawingCursorRef.current = pending.base;
            }
          }}
          onPointerCancel={(e) => { if (activePointerRef.current === e.pointerId) cancelInteraction(); }}
          onLostPointerCapture={(e) => { if (activePointerRef.current === e.pointerId) cancelInteraction(); }}
          onMouseLeave={() => setHoveredTarget({ shapeId: null, edgeIndex: null })}
          onDoubleClick={() => { if (activeTool === 'polyline' && draftPoints.length >= 3) commitPolyline(); }}
          className={`w-full h-full block touch-none outline-none ${
            activeTool === 'select' && !hotGrip && !marqueeBox ? 'cursor-default' : 'cursor-crosshair'
          }`}
        />

        {t(activeTool === 'measure' && <div data-testid="measurement-readout" role="status" title={t("单击开始下一次测量 · Esc 退出")} className="absolute top-3 left-3 z-20 flex items-start gap-2 max-w-[calc(100%-24px)] rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-[11px] leading-4 text-[var(--ink)] shadow-sm">
          <Ruler className="mt-px h-3.5 w-3.5 shrink-0 text-[#f0c577]" /><span className="shrink-0 font-semibold">{t("XY 两点测量")}</span>
          <div className="min-w-0">
            {t(measurement && <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums text-[#f0c577]"><span className="whitespace-nowrap">L {t(measurement.distance.toFixed(2))} mm</span><span className="whitespace-nowrap">ΔX {t(measurement.dx.toFixed(2))} mm</span><span className="whitespace-nowrap">ΔY {t(measurement.dy.toFixed(2))} mm</span><span className="whitespace-nowrap">∠ {t(measurement.angleDeg.toFixed(2))}°</span></div>)}
            {t(measurementPoints.length < 2 && <p className="text-[var(--muted)]">{t(measurementPoints.length === 0 ? '单击起点 → 终点' : '单击终点完成')}{" " + t("· Esc 退出")}</p>)}
          </div>
          <button type="button" onClick={() => setMeasurementPoints([])} disabled={!measurementPoints.length} aria-label={t("清除测量")} title={t("清除测量")} className="ml-auto mt-px shrink-0 text-[var(--muted)] disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
        </div>)}

        {t(marqueeBox?.phase === 'drag' && <div data-testid="marquee-selection-status" role="status" className="absolute top-3 left-3 right-3 pointer-events-none text-[11px] text-[var(--ink)]"><span className="inline-block rounded border border-[var(--line)] bg-[var(--paper)] px-2 py-1">{t("松手完成框选 ·") + " "}{t(marqueeBox.operation === 'remove' ? '减选' : marqueeBox.operation === 'add' ? '追加' : '替换选择')}{" " + t("· Esc / 右键取消")}</span></div>)}
        {t(!hotGrip && gripError && <div role="alert" className="absolute top-10 left-3 right-3 pointer-events-none text-[11px] text-[#f0c577]">{t(gripError)}</div>)}
        {t(hotGrip && <div data-testid="grip-edit-bar" className="absolute bottom-[94px] left-3 right-3 z-20 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 shadow-lg text-[11px]">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <strong className="mr-2 text-[#ed6262]">{t("夹点 ·") + " "}{t(GRIP_LABELS[hotGrip.mode])}</strong>
            {t(GRIP_MODES.map(mode => <button key={mode} type="button" aria-label={t(`夹点${GRIP_LABELS[mode]}`)} aria-pressed={hotGrip.mode === mode}
              onClick={() => { setHotGrip(g => g && { ...g, mode }); setGripInput(''); setGripError(''); canvasRef.current?.focus({ preventScroll: true }); }}
              className={`rounded px-2 py-1 ${hotGrip.mode === mode ? 'bg-[var(--selection)] text-[var(--blue)]' : 'text-[var(--muted)] hover:bg-[var(--surface)]'}`}>{t(GRIP_LABELS[mode].split(' ')[0])}</button>))}
          </div>
          {t(gripGuide.label && <p data-testid="grip-preview-readout" className="mb-1 font-mono text-[var(--blue)]">{t(gripGuide.label)}</p>)}
          <div className="flex items-center gap-2">
            <input ref={gripInputRef} aria-label={t("夹点命令输入")} type="text" value={gripInput}
              onChange={event => { setGripInput(event.target.value); setGripError(''); }}
              placeholder={t(hotGrip.mode === 'rotate' ? '旋转角度（°，逆时针为正）' : hotGrip.mode === 'mirror' ? '镜像轴角度（°，从 +X 起算）' : hotGrip.mode === 'scale' ? '倍率，例如 2 或 0.5' : 'x,y / @dx,dy / @长度<角度 / 距离')}
              className="h-8 min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--input)] px-2 font-mono text-[12px] text-[var(--ink)] outline-none focus:border-[var(--blue)]" />
            <button type="button" onClick={() => commitGrip()} className="h-8 shrink-0 rounded bg-[var(--selection)] px-3 text-[var(--blue)]">{t("确认")}</button>
            <button type="button" onClick={() => { clearGrip(); canvasRef.current?.focus({ preventScroll: true }); }} className="h-8 shrink-0 rounded px-2 text-[var(--muted)]">{t("取消")}</button>
          </div>
          <p className="mt-1 text-[var(--muted)]">{t(hotGrip.mode === 'scale' ? `鼠标参考长度 ${gripReferenceLength(hotGrip).toFixed(2)} mm（基点到最远选中点） · ` : hotGrip.mode === 'rotate' || hotGrip.mode === 'mirror' ? '+X 为 0° · ' : '')}{t("点目标确认 · 空 Enter / 空格切换模式 · Esc 取消并保留选择 · 共享点带动相连直线")}</p>
          {t((gripError || gripPreview.error) && <p role="alert" className="mt-1 text-[#f0c577]">{t(gripError || gripPreview.error)}</p>)}
        </div>)}

        {t(isDrawingTool && <div data-testid="exact-size-input-bar" className="absolute bottom-[94px] left-3 right-3 z-20 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 shadow-lg text-[11px]">
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[var(--muted)]">
            <strong className="text-[var(--blue)]">{t(activeTool === 'point' ? 'POINT · 独立定位点' : activeTool === 'line' ? 'LINE · 点线一体' : activeTool === 'rect' ? 'RECTANGLE · 两角点矩形' : activeTool === 'circle' ? `CIRCLE · 圆心 / ${diameterMode ? '直径' : '半径'}` : activeTool === 'triangle' ? 'TRIANGLE · 两角点包围盒' : 'P · 闭合面（至少三点）')}</strong>
            <span>{t(activeTool === 'point' ? '指定点：单击或输入 x,y，回车放置' : !drawingStart ? (activeTool === 'line' ? '指定起点：单击 / x,y；空回车从最近直线末端续画' : '指定第一点：单击或 x,y') : activeTool === 'circle' ? `指定${diameterMode ? '直径' : '半径'}：点选或数值 · D↵切换` : activeTool === 'line' ? '指定下一点：自动落点并连线，也可复用已有点' : '指定下一点：单击或输入坐标')}</span>
          </div>
          {t((activeTool === 'line' || activeTool === 'point' || activeTool === 'polyline') && <p data-testid="drawing-preview-readout" className="mb-1 font-mono text-[var(--blue)]">X {t(drawingPreviewPoint.x.toFixed(2))} · Y {t(drawingPreviewPoint.y.toFixed(2))} mm{t(drawingStart && ` · L ${Math.hypot(drawingPreviewPoint.x - drawingStart.x, drawingPreviewPoint.y - drawingStart.y).toFixed(2)} mm · ∠ ${(Math.atan2(drawingPreviewPoint.y - drawingStart.y, drawingPreviewPoint.x - drawingStart.x) * 180 / Math.PI).toFixed(2)}°`)}</p>)}
          <div className="flex items-center gap-2">
            <input ref={drawingInputRef} data-testid="exact-size-input" aria-label={t("绘图命令输入")} type="text" value={sizeInput}
              onChange={(event) => { setSizeInput(event.target.value); setDrawingError(''); }}
              placeholder={t(!drawingStart ? 'x,y' : activeTool === 'rect' || activeTool === 'triangle' ? '@dx,dy / 宽×高 / x,y' : '@dx,dy / @长度<角度 / 长度')}
              className="h-8 min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--input)] px-2 font-mono text-[12px] text-[var(--ink)] outline-none focus:border-[var(--blue)]" />
            <button type="button" onClick={() => submitDrawingInput()} className="h-8 shrink-0 rounded bg-[var(--selection)] px-3 text-[var(--blue)]">{t("输入 ↵")}</button>
            <button type="button" onClick={() => activeTool === 'polyline' && draftPoints.length ? commitPolyline() : finishDrawing()} className="h-8 shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--surface)]">{t("结束")}</button>
          </div>
          {t(drawingError ? <p role="alert" className="mt-1 text-[#f0c577]">{t(drawingError)}</p> : <p className="mt-1 text-[var(--muted)]">{t(activeTool === 'point' ? '连续放置独立点 · U↵撤点 · ' : activeTool === 'line' ? '移动节点会联动相连直线 · U↵撤上一步 · C↵闭合 · ' : activeTool === 'polyline' ? 'U↵撤点 · C↵闭合 · ' : '')}{t(!drawingStart && ['line', 'rect', 'circle', 'triangle'].includes(activeTool) ? '指定第一点后可空输入 Enter 结束 · ' : '空输入 Enter / 空格结束 · ')}{t("右键 / Esc 结束，保留已创建对象")}</p>)}
        </div>)}

        {dragStarted && (linkedDragLines.length > 0 || dragLockedShape) && <div role="status" data-testid="linked-drag-status" className="absolute top-10 left-3 right-3 pointer-events-none text-[11px] text-[var(--blue)]">
          <span className="inline-block rounded border border-[var(--line)] bg-[var(--paper)] px-2 py-1">{dragLockedShape
            ? `无法移动：「${dragLockedShape.name}」已锁定，请先解锁相连对象。`
            : `联动 ${linkedDragLines.length} 条直线 · F3捕捉 / F8正交 · Esc取消${geometrySnap ? ' · 捕捉仅对齐坐标，不合并节点' : ''}`}</span>
        </div>}

        {/* Top-Left Smart Snap Status Readout (strictly transient while dragging) */}
        {t(smartGuidesEnabled && displayedSnapGuides.length > 0 && (
          <div
            data-testid="smart-snap-status"
            className="absolute top-2 left-2.5 pointer-events-none flex items-center gap-1.5 text-[10.5px] font-mono bg-[var(--paper)] border border-[var(--line)] text-[var(--blue)] px-2 py-0.5 rounded shadow max-w-[90%]"
          >
            <Magnet className="w-3 h-3 text-[var(--blue)] shrink-0" />
            <span className="truncate">{" " + t("智能对齐:") + " "}{t(displayedSnapGuides.map((g) => g.label).join(' · '))}
            </span>
          </div>
        ))}

        {/* Empty Canvas Helpful Prompt */}
        {t(shapes.length === 0 && activeTool === 'select' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-[var(--paper)] border border-[var(--line)] rounded-xl px-5 py-4 text-center max-w-sm shadow-xl">
              <div className="text-sm font-semibold text-[var(--blue)]">{" " + t("当前画布为空") + " "}</div>
              <div className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{" " + t("点击下方绘图工具开始，在画布中指定点。") + " "}</div>
            </div>
          </div>
        ))}

        {/* Bottom-Left Coordinate Readout */}
        <div className="absolute bottom-2 left-2.5 pointer-events-none text-[11px] font-mono text-[var(--muted)] bg-[var(--paper)] border border-[var(--line)] px-2 py-0.5 rounded flex items-center gap-1.5 w-fit backdrop-blur-sm">
          <span>XY:</span>
          <span className="text-[var(--blue)] tabular-nums">
            {t(cursorMm.x.toFixed(0))}, {t(cursorMm.y.toFixed(0))}mm
          </span>
        </div>

        {/* Bottom-Right Compact Implicit/Adaptive Dimension Pill (Single-line by default, expandable with editable edge inputs) */}
        {t(selectedDimensions && selectedShape && showDimensions && (
          <div
            data-testid="cad-dimension-hud"
            className="absolute bottom-2 right-2.5 z-10 bg-[var(--paper)] border border-[var(--line)] rounded-md px-2.5 py-1 shadow-sm max-w-[calc(100%-150px)] backdrop-blur-sm text-[11px] font-mono"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[var(--blue)] font-semibold truncate max-w-[120px] sm:max-w-[160px]">
                {t(selectedIds.length > 1
                  ? `已选${selectedIds.length}个`
                  : selectedDimensions.shapeName.replace(/\s*\(.*\)/, ''))}
              </span>
              <span className="text-[var(--muted)]">·</span>
              {t(selectedDimensions.isLineFeature ? (
                <label className="flex items-center gap-1 text-[var(--blue)] tabular-nums">
                  <span>L=</span>
                  <input
                    data-testid="hud-line-length-input"
                    type="number"
                    min={2}
                    max={500}
                    step={1}
                    value={selectedDimensions.primaryLengthMm}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 2) {
                        onUpdateShape(
                          resizeLineWall2D(
                            selectedShape,
                            val,
                            selectedDimensions.thicknessMm,
                          ),
                        );
                      }
                    }}
                    className="w-13 bg-[var(--paper)] border border-[var(--line)] rounded px-1 py-0.2 text-[11px] text-[var(--blue)] text-right tabular-nums focus:outline-none focus:border-[var(--line)]"
                  />
                  <span>mm</span>
                </label>
              ) : selectedDimensions.shapeType === 'circle' ? (
                <label className="flex items-center gap-1 text-[var(--blue)] tabular-nums">
                  <span>Ø=</span>
                  <input
                    data-testid="hud-circle-diameter-input"
                    type="number"
                    min={2}
                    max={500}
                    step={1}
                    value={selectedDimensions.diameterMm ?? 30}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 2) {
                        onUpdateShape(
                          resizeCircleDiameter2D(selectedShape, val),
                        );
                      }
                    }}
                    className="w-13 bg-[var(--paper)] border border-[var(--line)] rounded px-1 py-0.2 text-[11px] text-[var(--blue)] text-right tabular-nums focus:outline-none focus:border-[var(--line)]"
                  />
                  <span>mm</span>
                </label>
              ) : (
                <span className="text-[var(--muted)] tabular-nums">
                  {t(selectedDimensions.widthX.toFixed(0))}×{t(selectedDimensions.depthY.toFixed(0))}mm
                </span>
              ))}
              {/* Active Hovered or Clicked Edge Inline Customizer */}
              {t(activeSelectedEdge && !selectedDimensions.isLineFeature && selectedDimensions.shapeType !== 'circle' && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--selection)] border border-[var(--line)] text-[var(--blue)] font-semibold tabular-nums">
                  <span>{t("边")}{t(activeSelectedEdge.edgeIndex + 1)}:</span>
                  <input
                    data-testid="canvas-edge-length-input"
                    aria-label={t(`修改边${activeSelectedEdge.edgeIndex + 1}长度`)}
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={activeSelectedEdge.lengthMm}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val) && val >= 1) {
                        onUpdateShape(
                          resizeShapeEdge2D(
                            selectedShape,
                            activeSelectedEdge.edgeIndex,
                            val,
                          ),
                        );
                      }
                    }}
                    className="w-13 bg-[var(--paper)] border border-[var(--line)] rounded px-1 py-0 text-[11px] text-[var(--blue)] text-right tabular-nums focus:outline-none focus:border-[var(--line)]"
                  />
                  <span>mm</span>
                  <span className="text-[var(--blue)] text-[10px]">
                    ∠{t(activeSelectedEdge.angleDeg)}°
                  </span>
                </div>
              ))}

              {t(selectedIds.length === 1 &&
                !selectedDimensions.isLineFeature &&
                selectedDimensions.shapeType !== 'circle' &&
                selectedDimensions.edges.length <= 12 && (
                  <button
                    type="button"
                    data-testid="toggle-edge-list-hud"
                    onClick={() => setShowEdgeListHud((prev) => !prev)}
                    className={`ml-auto px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                      showEdgeListHud
                        ? 'bg-[var(--selection)] text-[var(--blue)] border-[var(--line)]'
                        : 'bg-[var(--surface)] hover:bg-[var(--surface)] text-[var(--blue)] border-[var(--line)]'
                    }`}
                    title={t("展开或收起各边数值自定义输入框")}
                  >
                    {t(showEdgeListHud
                      ? '收起各边'
                      : `各边(${selectedDimensions.edges.length})·改值`)}
                  </button>
                ))}
            </div>

            {/* Expandable Per-Edge Numeric Customization Inputs */}
            {t(showEdgeListHud &&
              selectedIds.length === 1 &&
              !selectedDimensions.isLineFeature &&
              selectedDimensions.shapeType !== 'circle' &&
              selectedDimensions.edges.length <= 12 && (
                <div
                  data-testid="hud-edge-inputs-list"
                  className="mt-1.5 pt-1.5 border-t border-[var(--line)] flex items-center gap-1.5 flex-wrap"
                >
                  <span className="text-[10px] text-[var(--muted)] mr-0.5">{" " + t("自定义各边(mm):") + " "}</span>
                  {t(selectedDimensions.edges.map((edge) => {
                    const isActive = activeEdgeIdxForHud === edge.edgeIndex;
                    return (
                      <div
                        key={edge.edgeIndex}
                        onMouseEnter={() =>
                          setHoveredTarget({
                            shapeId: selectedShape.id,
                            edgeIndex: edge.edgeIndex,
                          })
                        }
                        onMouseLeave={() =>
                          setHoveredTarget((prev) =>
                            prev.edgeIndex === edge.edgeIndex
                              ? { shapeId: null, edgeIndex: null }
                              : prev,
                          )
                        }
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                          isActive
                            ? 'bg-[var(--selection)] border-[var(--line)] text-[var(--blue)]'
                            : 'bg-[var(--paper)] border-[var(--line)] text-[var(--muted)]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedEdgeIndex(
                              selectedEdgeIndex === edge.edgeIndex
                                ? null
                                : edge.edgeIndex,
                            )
                          }
                          className="font-semibold hover:text-[var(--blue)]"
                          title={t(`点击在画布上锁定高亮 边${edge.edgeIndex + 1} (角度 ${edge.angleDeg}°)`)}
                        >{" " + t("边")}{t(edge.edgeIndex + 1)}:
                        </button>
                        <input
                          data-testid={`hud-edge-input-${edge.edgeIndex}`}
                          aria-label={t(`边${edge.edgeIndex + 1}长度数值(mm)`)}
                          type="number"
                          min={1}
                          max={1000}
                          step={1}
                          value={edge.lengthMm}
                          onFocus={() => setSelectedEdgeIndex(edge.edgeIndex)}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val >= 1) {
                              onUpdateShape(
                                resizeShapeEdge2D(
                                  selectedShape,
                                  edge.edgeIndex,
                                  val,
                                ),
                              );
                            }
                          }}
                          className="w-12 bg-[var(--paper)] border border-[var(--line)] rounded px-1 py-0 text-[10px] text-[var(--blue)] text-right tabular-nums focus:outline-none focus:border-[var(--line)]"
                        />
                      </div>
                    );
                  }))}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
};

