/**
 * 工程文件（.extrudecad.json）序列化 / 解析 / 下载 / 打开 / 本机自动存档
 */
import {
  CadShape,
  ShapeType,
  MATERIAL_PRESETS,
  MaterialPresetId,
} from './cadEngine';
import { validateSketchGraph } from './sketchGraph';

export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.extrudecad.json';

const AUTOSAVE_STORAGE_KEY = 'extrudecad.project.autosave.v1';

interface ProjectFilePayload {
  app: 'ExtrudeCAD Studio';
  fileType: 'extrudecad-project';
  version: number;
  savedAt: string;
  shapes: CadShape[];
}

const VALID_SHAPE_TYPES: ShapeType[] = [
  'point',
  'segment',
  'rect',
  'triangle',
  'circle',
  'line',
  'polygon',
  'polyline',
  'l-bracket',
  'hollow-box',
  't-beam',
];

function isValidPoint(p: unknown): p is { x: number; y: number } {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as { x?: unknown }).x === 'number' &&
    Number.isFinite((p as { x: number }).x) &&
    typeof (p as { y?: unknown }).y === 'number' &&
    Number.isFinite((p as { y: number }).y)
  );
}

/** 宽松地把外部数据清洗为合法 CadShape；字段缺失时补默认值，非法时返回 null */
function sanitizeShape(raw: unknown, index: number): CadShape | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<CadShape> & Record<string, unknown>;
  const reference = s.type === 'point' || s.type === 'segment';
  if (typeof s.id !== 'string' || s.id.length === 0) return null;
  if (s.endpointIds !== undefined && (s.type !== 'segment' || !Array.isArray(s.endpointIds) || s.endpointIds.length !== 2 || s.endpointIds.some((id) => typeof id !== 'string' || !id) || s.endpointIds[0] === s.endpointIds[1])) return null;
  if (!Array.isArray(s.points) || (reference ? s.points.length !== (s.type === 'point' ? 1 : 2) : s.points.length < 3)) return null;
  if (!s.points.every(isValidPoint)) return null;
  if (s.type === 'segment' && (!Number.isFinite(Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y))
    || (s.points[0].x === s.points[1].x && s.points[0].y === s.points[1].y))) return null;
  if (['zHeight', 'zOffset', 'bevel'].some((key) =>
    s[key] !== undefined && (typeof s[key] !== 'number' || !Number.isFinite(s[key])))) return null;
  if (s.zHeight !== undefined && (reference ? s.zHeight !== 0 : s.zHeight <= 0)) return null;
  if (s.bevel !== undefined && s.bevel < 0) return null;
  if (reference && ((s.bevel !== undefined && s.bevel !== 0) || (s.holePoints !== undefined && (!Array.isArray(s.holePoints) || s.holePoints.length !== 0)))) return null;
  if (
    s.holePoints !== undefined &&
    (!Array.isArray(s.holePoints) ||
      (s.holePoints.length !== 0 && s.holePoints.length < 3) ||
      !s.holePoints.every(isValidPoint))
  ) {
    return null;
  }

  const materialPreset: MaterialPresetId =
    typeof s.materialPreset === 'string' && Object.hasOwn(MATERIAL_PRESETS, s.materialPreset)
      ? s.materialPreset
      : 'aluminum';

  return {
    id: s.id,
    ...(s.endpointIds ? { endpointIds: [...s.endpointIds] as [string, string] } : {}),
    name: typeof s.name === 'string' ? s.name : `图形 #${index + 1}`,
    type: VALID_SHAPE_TYPES.includes(s.type as ShapeType)
      ? (s.type as ShapeType)
      : 'polygon',
    points: s.points.map((p) => ({ x: p.x, y: p.y })),
    holePoints: reference ? undefined : s.holePoints?.map((p) => ({ x: p.x, y: p.y })),
    zHeight: reference ? 0 :
      typeof s.zHeight === 'number' && Number.isFinite(s.zHeight) && s.zHeight > 0 ? s.zHeight : 30,
    zOffset: typeof s.zOffset === 'number' && Number.isFinite(s.zOffset) ? s.zOffset : 0,
    bevel: reference ? 0 : typeof s.bevel === 'number' && Number.isFinite(s.bevel) && s.bevel >= 0 ? s.bevel : 0,
    color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#38bdf8',
    materialPreset,
    visible: s.visible !== false,
    locked: s.locked === true,
    ...(!reference && s.booleanMeta &&
      ['union', 'intersection', 'subtraction'].includes(s.booleanMeta.op) &&
      ['targetId', 'toolId', 'targetName', 'toolName'].every(
        (key) => typeof s.booleanMeta?.[key as keyof typeof s.booleanMeta] === 'string',
      ) ? { booleanMeta: s.booleanMeta } : {}),
  };
}

export function serializeProject(shapes: CadShape[]): string {
  const payload: ProjectFilePayload = {
    app: 'ExtrudeCAD Studio',
    fileType: 'extrudecad-project',
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    shapes,
  };
  return JSON.stringify(payload, null, 2);
}

/** 解析工程文件文本；格式非法时抛错。兼容裸 CadShape[] 数组。 */
export function parseProject(jsonText: string): CadShape[] {
  if (!jsonText.trim()) throw new Error('工程文件是空的，请选择已保存的 .extrudecad.json 文件。');
  let data: unknown;
  try {
    data = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('工程文件内容损坏或不是 JSON 格式，当前画布未改变。');
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const payload = data as Partial<ProjectFilePayload>;
    if (payload.fileType !== undefined && payload.fileType !== 'extrudecad-project') {
      throw new Error('文件类型不匹配，请选择 ExtrudeCAD 工程文件。');
    }
    if (payload.version !== undefined && payload.version !== PROJECT_FILE_VERSION) {
      throw new Error(`暂不支持工程版本 ${payload.version}，请使用版本 ${PROJECT_FILE_VERSION} 的工程文件。`);
    }
  }
  const rawShapes: unknown = Array.isArray(data)
    ? data
    : (data as Partial<ProjectFilePayload> | null)?.shapes;
  if (!Array.isArray(rawShapes)) {
    throw new Error('这不是有效的 ExtrudeCAD 工程文件（缺少 shapes 数据）。');
  }
  const seen = new Set<string>();
  const shapes = rawShapes.map((raw, index) => {
    const s = sanitizeShape(raw, index);
    if (!s) throw new Error(`第 ${index + 1} 个图形的数据不完整或坐标无效，当前画布未改变。`);
    if (seen.has(s.id)) throw new Error(`工程包含重复的图形标识，当前画布未改变。`);
    seen.add(s.id);
    return s;
  });
  validateSketchGraph(shapes);
  return shapes;
}

/** 触发浏览器下载工程文件 */
export function downloadProject(shapes: CadShape[]): void {
  const blob = new Blob([serializeProject(shapes)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const link = document.createElement('a');
  link.href = url;
  link.download = `extrudecad-${stamp}${PROJECT_FILE_EXTENSION}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 弹出文件选择器让用户挑选工程文件；用户取消时 reject('已取消选择') */
export function pickProjectFile(): Promise<CadShape[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('已取消选择'));
        return;
      }
      try {
        const text = await file.text();
        resolve(parseProject(text));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('文件解析失败'));
      }
    };
    input.oncancel = () => reject(new Error('已取消选择'));
    input.click();
  });
}

/** 自动保存到本机 localStorage；存储满等异常静默忽略 */
export function saveProjectToLocal(shapes: CadShape[]): boolean {
  try {
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, serializeProject(shapes));
    return true;
  } catch {
    return false;
  }
}

/** 启动时读取自动存档；无存档或数据损坏时返回 null */
export function loadProjectFromLocal(): CadShape[] | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null;
  }
}

export function clearLocalProject(): void {
  try {
    localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
