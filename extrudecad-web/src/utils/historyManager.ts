export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function cloneHistoryItem<T>(item: T): T {
  return JSON.parse(JSON.stringify(item));
}

export function isSameHistoryItem<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistoryState<T>(initialPresent: T): HistoryState<T> {
  return {
    past: [],
    present: cloneHistoryItem(initialPresent),
    future: [],
  };
}

export function pushHistoryState<T>(
  state: HistoryState<T>,
  nextPresent: T,
  maxDepth = 50,
): HistoryState<T> {
  if (isSameHistoryItem(state.present, nextPresent)) {
    return state;
  }
  const updatedPast = [...state.past, cloneHistoryItem(state.present)];
  if (updatedPast.length > maxDepth) {
    updatedPast.shift();
  }
  return {
    past: updatedPast,
    present: cloneHistoryItem(nextPresent),
    future: [],
  };
}

export function replaceHistoryPresent<T>(
  state: HistoryState<T>,
  nextPresent: T,
): HistoryState<T> {
  return {
    ...state,
    present: cloneHistoryItem(nextPresent),
  };
}

export function undoHistoryState<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) {
    return state;
  }
  const previous = state.past[state.past.length - 1];
  const newPast = state.past.slice(0, state.past.length - 1);
  return {
    past: newPast,
    present: cloneHistoryItem(previous),
    future: [cloneHistoryItem(state.present), ...state.future],
  };
}

export function redoHistoryState<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) {
    return state;
  }
  const next = state.future[0];
  const newFuture = state.future.slice(1);
  return {
    past: [...state.past, cloneHistoryItem(state.present)],
    present: cloneHistoryItem(next),
    future: newFuture,
  };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
