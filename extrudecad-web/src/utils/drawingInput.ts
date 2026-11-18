export interface DrawingPoint { x: number; y: number }
export type DrawingInputTool = 'point' | 'line' | 'rect' | 'triangle' | 'circle' | 'polyline';

const scalar = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const pairPattern = new RegExp(`^(@?)\\s*(${scalar})\\s*[,，]\\s*(${scalar})$`);
const polarPattern = new RegExp(`^@\\s*(${scalar})\\s*<\\s*(${scalar})\\s*(?:°|deg)?$`, 'i');
const sizePattern = new RegExp(`^(${scalar})\\s*[xX×*]\\s*(${scalar})$`);
const scalarPattern = new RegExp(`^${scalar}$`);

export function parseDrawingPoint(text: string, options: { tool: DrawingInputTool; start: DrawingPoint | null; cursor: DrawingPoint }): DrawingPoint {
  const raw = text.trim();
  const { start, cursor, tool } = options;
  const checked = (point: DrawingPoint) => {
    if (![point.x, point.y].every(Number.isFinite) || Math.abs(point.x) > 100000 || Math.abs(point.y) > 100000) throw new Error('坐标须为有限数值，范围 ±100000 mm。');
    return point;
  };
  const pair = raw.match(pairPattern);
  if (tool === 'point' && (!pair || pair[1])) throw new Error('定位点请输入绝对坐标 x,y，或单击画布。');
  if (pair) {
    if (pair[1] && !start) throw new Error('请先指定第一点，再输入相对坐标。');
    return checked({ x: Number(pair[2]) + (pair[1] ? start!.x : 0), y: Number(pair[3]) + (pair[1] ? start!.y : 0) });
  }
  if (!start) throw new Error('指定第一点：单击画布，或输入 x,y。');
  const polar = raw.match(polarPattern);
  if (polar) {
    const length = Number(polar[1]);
    if (!(length > 0)) throw new Error('长度必须大于 0。');
    const angle = Number(polar[2]) * Math.PI / 180;
    return checked({ x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) });
  }
  const size = raw.match(sizePattern);
  if (size && (tool === 'rect' || tool === 'triangle')) {
    const width = Number(size[1]);
    const height = Number(size[2]);
    if (!(width > 0 && height > 0)) throw new Error('宽度和高度必须大于 0。');
    return checked({ x: start.x + (cursor.x < start.x ? -width : width), y: start.y + (cursor.y < start.y ? -height : height) });
  }
  if (scalarPattern.test(raw)) {
    const length = Number(raw);
    if (!(length > 0)) throw new Error('长度必须大于 0。');
    const dx = cursor.x - start.x;
    const dy = cursor.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9 && tool !== 'circle') throw new Error('请先移动鼠标指定方向，或输入 @长度<角度。');
    return checked({ x: start.x + length * (distance ? dx / distance : 1), y: start.y + length * (distance ? dy / distance : 0) });
  }
  throw new Error(tool === 'rect' || tool === 'triangle' ? '请输入 x,y、@dx,dy、@长度<角度 或 宽×高。' : '请输入 x,y、@dx,dy、@长度<角度 或 长度。');
}
