export type SelectionOperation = 'replace' | 'add' | 'remove' | 'toggle';

export function selectionOperation(keys: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): SelectionOperation {
  return keys.shiftKey ? 'remove' : keys.ctrlKey || keys.metaKey ? 'add' : 'replace';
}

/** Apply a selection operation without changing geometry or ordering existing selections. */
export function updateSelection(current: string[], hits: string[], operation: SelectionOperation): string[] {
  const hitSet = new Set(hits);
  if (operation === 'replace') return [...hitSet];
  if (operation === 'remove') return current.filter(id => !hitSet.has(id));
  if (operation === 'add') return [...new Set([...current, ...hits])];
  const selected = new Set(current);
  return [...current.filter(id => !hitSet.has(id)), ...[...hitSet].filter(id => !selected.has(id))];
}
