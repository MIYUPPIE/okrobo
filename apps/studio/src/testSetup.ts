// Vitest setup: extends `expect` with DOM matchers (toBeDisabled, etc.) for
// component tests. Harmless for non-DOM test files.
import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// This repo's Node + vitest + jsdom combination does not provide a working
// `localStorage` global -- Node's own built-in Web Storage implementation
// returns `undefined` for both `globalThis.localStorage` and
// `window.localStorage` unless the process is launched with
// `--localstorage-file`, and jsdom here defers to it rather than
// installing its own (see the node-vitest-localstorage-gotcha memory).
// Installed globally, once, here -- rather than in each individual test
// file that happens to render a component touching localStorage (this hit
// three separate files independently before landing here: webStore.ts's
// own tests, runHistory.ts's own tests, and ResizeHandle -- rendered
// transitively by BuilderPanel.test.tsx, which never touches localStorage
// directly itself and had no reason to know it needed to stub it).
// `projects/webStore.ts` and `compete/runHistory.ts` still take an
// injectable store parameter for their own unit tests regardless (real
// app data deserves a real, controlled fake per test, not a shared
// incidental global) -- this polyfill exists for every OTHER component
// that just needs `localStorage` to not crash.
if (typeof globalThis.localStorage === "undefined" || !("setItem" in (globalThis.localStorage ?? {}))) {
  const store = new Map<string, string>();
  const polyfill: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => void store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: polyfill, writable: true, configurable: true });
  beforeEach(() => store.clear());
}
