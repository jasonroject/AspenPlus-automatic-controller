export const COMMAND_ALIASES: Record<string, string> = {
  L: 'line', LINE: 'line', C: 'circle', CIRCLE: 'circle',
  REC: 'rect', RECTANGLE: 'rect', R: 'rect', PL: 'polyline', POLYLINE: 'polyline', P: 'polyline',
  PO: 'point', POINT: 'point', M: 'move', MOVE: 'move',
  CO: 'duplicate', COPY: 'duplicate', RO: 'rotate', ROTATE: 'rotate', SC: 'scale', SCALE: 'scale',
  E: 'delete', ERASE: 'delete', DI: 'measure', DIST: 'measure',
  Z: 'fit', ZOOM: 'fit', ZE: 'fit', F: 'fit', V: 'select', SELECT: 'select',
  U: 'undo', UNDO: 'undo', REDO: 'redo', QSAVE: 'save', SAVE: 'save',
  PROPERTIES: 'inspector', PR: 'inspector', CLEANSCREEN: 'clean', HELP: 'help',
};

export function resolveCommandAlias(text: string): string | undefined {
  return COMMAND_ALIASES[text.trim().replace(/^_/, '').toUpperCase()];
}
