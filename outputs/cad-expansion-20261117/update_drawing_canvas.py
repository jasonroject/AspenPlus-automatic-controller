from pathlib import Path

p = Path(r'C:\Users\Administrator\Documents\Codex\2026-09-16\project1jason\automatic\extrudecad-web\src\components\Cad2DCanvas.tsx')
s = p.read_text(encoding='utf-8')
start = s.index('  // Commit a newly drawn polyline polygon')
end = s.index('  // Draw the 2D CAD Blueprint Canvas', start)
s = s[:start] + r'''  const drawingStart = activeTool === 'polyline' ? draftPoints[draftPoints.length - 1] ?? null : dragStartMm;

  const finishDrawing = () => {
    cancelInteraction();
    setLinePoints([]);
    setLineSegmentIds([]);
    setDrawingError('');
    onChangeTool('select');
  };

  const commitPolyline = () => {
    const error = validateClosedPolygonPoints(draftPoints);
    if (error) { setDrawingError(error); return false; }
    onCreateShape({ id: `cad-poly-${crypto.randomUUID()}`, name: `闭合面 #${shapes.length + 1}`, type: 'polyline',
      points: draftPoints.map((point) => ({ ...point })), zHeight: defaultZHeight, zOffset: 0, bevel: 0.6,
      color: '#A5ADB8', materialPreset: 'aluminum', visible: true });
    finishDrawing();
    return true;
  };

  const resolveDrawingPoint = (raw: Point2D, shiftKey = false) => {
    const snap = objectSnapEnabled ? findGeometrySnap(raw, shapes, 8 / zoom) : null;
    let point = snap ? { ...snap.point } : {
      x: snapToGrid(raw.x, gridStep, snapEnabled), y: snapToGrid(raw.y, gridStep, snapEnabled),
    };
    if (!snap && drawingStart && (activeTool === 'line' || activeTool === 'polyline') && orthoEnabled !== shiftKey) {
      point = Math.abs(point.x - drawingStart.x) >= Math.abs(point.y - drawingStart.y)
        ? { x: point.x, y: drawingStart.y } : { x: drawingStart.x, y: point.y };
    }
    return { point, snap };
  };

  const commitDrawingPoint = (point: Point2D) => {
    if (![point.x, point.y].every(Number.isFinite)) { setDrawingError('请输入有限坐标。'); return false; }
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
      if (activeTool === 'line') setLinePoints([point]);
      return true;
    }
    const dx = point.x - dragStartMm.x;
    const dy = point.y - dragStartMm.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-8 || ((activeTool === 'rect' || activeTool === 'triangle') && (Math.abs(dx) < 1e-8 || Math.abs(dy) < 1e-8))) {
      setDrawingError('两点须不同；矩形和三角形的宽、高均须大于 0。'); return false;
    }
    if (!['line', 'rect', 'triangle', 'circle'].includes(activeTool)) return false;
    const type = activeTool as 'line' | 'rect' | 'triangle' | 'circle';
    const id = `cad-${type}-${crypto.randomUUID()}`;
    const points = type === 'line' ? createLineWallPoints(dragStartMm, point, 8)
      : type === 'circle' ? createRegularPolygonPoints(dragStartMm.x, dragStartMm.y, distance / (diameterMode ? 2 : 1), 32)
      : type === 'rect' ? createRectanglePoints((point.x + dragStartMm.x) / 2, (point.y + dragStartMm.y) / 2, Math.abs(dx), Math.abs(dy))
      : createTrianglePoints((point.x + dragStartMm.x) / 2, (point.y + dragStartMm.y) / 2, Math.abs(dx), Math.abs(dy));
    onCreateShape({ id, name: `${type === 'line' ? '直线墙' : type === 'rect' ? '矩形' : type === 'circle' ? '圆柱' : '三角柱'} #${shapes.length + 1}`,
      type, points, zHeight: defaultZHeight, zOffset: 0, bevel: type === 'line' ? 0.4 : 0.8,
      color: '#A5ADB8', materialPreset: type === 'line' ? 'steel' : type === 'circle' ? 'brass' : 'aluminum', visible: true });
    setSizeInput(''); setDrawingError(''); setCursorMm(point);
    if (type === 'line') {
      setDragStartMm(point);
      setLinePoints((previous) => [...previous, point]);
      setLineSegmentIds((previous) => [...previous, id]);
    } else finishDrawing();
    return true;
  };

  const undoDrawingPoint = () => {
    if (activeTool === 'polyline') {
      setDraftPoints((points) => points.slice(0, -1)); setSizeInput(''); setDrawingError(''); return;
    }
    const id = lineSegmentIds[lineSegmentIds.length - 1];
    if (activeTool !== 'line' || !id) { setDrawingError('当前命令没有可撤回的线段。'); return; }
    if (shapes[shapes.length - 1]?.id !== id || !onUndoDrawingSegment?.(id)) {
      setDrawingError('模型已被其他操作修改，请结束命令后使用全局撤销。'); return;
    }
    const previous = linePoints[linePoints.length - 2];
    setLineSegmentIds((ids) => ids.slice(0, -1)); setLinePoints((points) => points.slice(0, -1));
    setDragStartMm(previous); setCursorMm(previous); setSizeInput(''); setDrawingError('');
  };

  const submitDrawingInput = () => {
    const command = sizeInput.trim().toUpperCase();
    if (!command) {
      if (activeTool === 'polyline' && draftPoints.length) commitPolyline();
      else finishDrawing();
      return;
    }
    if (command === 'U') { undoDrawingPoint(); return; }
    if (command === 'C' && activeTool === 'polyline') { commitPolyline(); return; }
    if (command === 'C' && activeTool === 'line') {
      if (lineSegmentIds.length < 2) { setDrawingError('至少绘制两段后才能闭合。'); return; }
      const first = linePoints[0];
      if (dragStartMm && Math.hypot(first.x - dragStartMm.x, first.y - dragStartMm.y) < 1e-8) finishDrawing();
      else if (commitDrawingPoint(first)) finishDrawing();
      return;
    }
    if (command === 'D' && activeTool === 'circle' && dragStartMm) { setDiameterMode((value) => !value); setSizeInput(''); setDrawingError(''); return; }
    try {
      commitDrawingPoint(parseDrawingPoint(sizeInput, { tool: activeTool as 'line' | 'rect' | 'circle' | 'triangle' | 'polyline', start: drawingStart, cursor: cursorMm }));
    } catch (error) { setDrawingError(error instanceof Error ? error.message : '无法解析输入。'); }
  };

  useEffect(() => {
    onDrawingStateChange?.(isDrawingTool && isActive);
    return () => onDrawingStateChange?.(false);
  }, [isDrawingTool, isActive, onDrawingStateChange]);

  useEffect(() => {
    if (!isActive || keyboardBlocked) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const ownInput = target === drawingInputRef.current;
      if (event.defaultPrevented || event.isComposing || (!ownInput && (target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"]')))) return;
      if (event.key === 'F3' || event.key === 'F8' || event.key === 'F9') {
        event.preventDefault();
        if (event.key === 'F3') setObjectSnapEnabled((value) => !value);
        else if (event.key === 'F8') setOrthoEnabled((value) => !value);
        else onToggleSnap();
        return;
      }
      if (event.key === 'Escape') {
        if (activePointerRef.current !== null || draftPoints.length || dragStartMm || activeTool !== 'select') event.preventDefault();
        finishDrawing(); return;
      }
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
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  });

''' + s[end:]
# Remove mouse-release creation and the obsolete center-based exact-size implementation.
start = s.index('    if (dragStartMm) {', s.index('  const handleMouseUp ='))
end = s.index('  const activeEdgeIdxForHud =', start)
s = s[:start] + '  };\n\n' + s[end:]
# Persistent command input: same first-point basis as pointer drawing.
start = s.index('        {/* Exact-Size Input Bar:')
end = s.index('        {/* Top-Left Smart Snap Status', start)
s = s[:start] + r'''        {isDrawingTool && <div data-testid="exact-size-input-bar" className="absolute bottom-[94px] left-3 right-3 z-20 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2 shadow-lg text-[11px]">
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[var(--muted)]">
            <strong className="text-[var(--blue)]">{activeTool === 'line' ? 'LINE · 直线墙（厚 8 mm）' : activeTool === 'rect' ? 'RECTANGLE · 两角点矩形' : activeTool === 'circle' ? `CIRCLE · 圆心 / ${diameterMode ? '直径' : '半径'}` : activeTool === 'triangle' ? 'TRIANGLE · 两角点包围盒' : 'P · 闭合面（至少三点）'}</strong>
            <span>{!drawingStart ? '指定第一点：单击或 x,y' : activeTool === 'circle' ? `指定${diameterMode ? '直径' : '半径'}：点选或数值 · D切换` : '指定下一点：单击或输入坐标'}</span>
          </div>
          <div className="flex items-center gap-2">
            <input ref={drawingInputRef} data-testid="exact-size-input" aria-label="绘图命令输入" type="text" value={sizeInput}
              onChange={(event) => { setSizeInput(event.target.value); setDrawingError(''); }}
              placeholder={!drawingStart ? 'x,y' : activeTool === 'rect' || activeTool === 'triangle' ? '@dx,dy / 宽×高 / x,y' : '@dx,dy / @长度<角度 / 长度'}
              className="h-8 min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--input)] px-2 font-mono text-[12px] text-[var(--ink)] outline-none focus:border-[var(--blue)]" />
            <button type="button" onClick={submitDrawingInput} className="h-8 shrink-0 rounded bg-[var(--selection)] px-3 text-[var(--blue)]">输入 ↵</button>
            <button type="button" onClick={() => activeTool === 'polyline' && draftPoints.length ? commitPolyline() : finishDrawing()} className="h-8 shrink-0 rounded px-2 text-[var(--muted)] hover:bg-[var(--surface)]">结束</button>
          </div>
          {drawingError ? <p role="alert" className="mt-1 text-[#f0c577]">{drawingError}</p> : <p className="mt-1 text-[var(--muted)]">{activeTool === 'line' ? '连续点选续线 · U↵撤段 · C↵闭合 · ' : activeTool === 'polyline' ? 'U↵撤点 · C↵闭合 · ' : ''}Enter / 空格 / 右键结束 · Esc 取消未提交部分</p>}
        </div>}

''' + s[end:]
p.write_text(s, encoding='utf-8')
