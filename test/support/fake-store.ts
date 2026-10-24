// A zustand-shaped store without React: the hook form reads through its
// selector, and subscribers see every set with the state before it.

import type { StoreApi } from "../../src/safelight";

export function fakeStore<T extends object>(init: T): StoreApi<T> {
  let state = init;
  const listeners = new Set<(s: T, prev: T) => void>();
  const set = (partial: Partial<T> | ((s: T) => Partial<T>)) => {
    const prev = state;
    state = { ...state, ...(typeof partial === "function" ? partial(state) : partial) };
    for (const l of listeners) l(state, prev);
  };
  const hook = ((selector?: (s: T) => unknown) => (selector ? selector(state) : state)) as StoreApi<T>;
  hook.getState = () => state;
  hook.setState = set;
  hook.subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return hook;
}
