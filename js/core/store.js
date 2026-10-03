// Tiny observable store. No framework. (A1)
export function createStore(initial = {}) {
  let state = { ...initial };
  const subs = new Set();
  let batching = 0, dirty = false;
  function notify() {
    if (batching) { dirty = true; return; }
    dirty = false;
    for (const fn of [...subs]) { try { fn(state); } catch (e) { console.error('store subscriber failed', e); } }
  }
  return {
    get(key) { return key === undefined ? state : state[key]; },
    set(key, value) {
      if (Object.is(state[key], value)) return;
      state = { ...state, [key]: value }; notify();
    },
    update(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p }; notify();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    batch(fn) {
      batching++;
      try { fn(); } finally { batching--; if (!batching && dirty) notify(); }
    }
  };
}
export const appStore = createStore({ activeProfile: null, dbBlocked: false, safeMode: false, writeError: null });
