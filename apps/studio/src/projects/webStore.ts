// Browser-local project store, used by projects/api.ts whenever the app
// isn't running inside the Tauri desktop shell -- mirrors
// src-tauri/src/projects.rs's own behavior field-for-field (that file's own
// test suite is the de facto spec: id/created_at/updated_at semantics,
// list ordering, error messages) so the two backends are indistinguishable
// from every caller's perspective (App.tsx, BuiltRobotDialog.tsx,
// projectRobots.ts all just call projects/api.ts, unaware which backend
// answered). See docs/decisions/robot-builder-web-persistence.md for why
// localStorage over IndexedDB.
//
// A project saved here is local to this browser profile -- it does not
// travel to a different browser or computer. That's an inherent property
// of localStorage, not a bug; Export/Import (exportRobot.ts/importRobot.ts)
// remains the cross-device mechanism, same portability story
// docs/decisions/robot-builder-packs.md already established for a single
// exported robot.
//
// The storage backend is an injectable parameter (defaulting to the real
// `localStorage`, same `open_port`-style injection precedent already used
// elsewhere in this codebase for testability) rather than a bare reference
// to the global -- found empirically that this repo's Node+vitest+jsdom
// combination does NOT actually provide a working `localStorage` global
// (Node's own built-in Web Storage implementation returns `undefined`
// unless launched with `--localstorage-file`, and jsdom here defers to it
// rather than installing its own), so tests inject a small in-memory fake
// instead of depending on a real browser environment.

import type { ProjectMeta, ProjectPayload } from "./api";

/** The exact subset of the DOM `Storage` interface this module needs --
 * `localStorage` itself satisfies this, and so does a plain in-memory fake
 * in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = "okrobo:projects";
const payloadKey = (id: string) => `okrobo:project:${id}`;

/** Whole seconds, matching src-tauri/src/projects.rs's own `now()` --
 * OpenDialog.tsx's existing `new Date(p.updated_at * 1000)` formatting
 * already assumes this and needs no changes either backend. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The index is untrusted, mutable browser storage -- a corrupted or
 * hand-edited entry falls back to an empty list rather than breaking
 * every project, the same defensive posture App.tsx already takes toward
 * a corrupted world_custom/robot_def inside one project's own payload. */
function readIndex(store: KeyValueStore): ProjectMeta[] {
  const raw = store.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProjectMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(store: KeyValueStore, index: ProjectMeta[]): void {
  store.setItem(INDEX_KEY, JSON.stringify(index));
}

export async function webListProjects(store: KeyValueStore = localStorage): Promise<ProjectMeta[]> {
  return [...readIndex(store)].sort((a, b) => b.updated_at - a.updated_at);
}

export async function webCreateProject(
  name: string,
  payload: ProjectPayload,
  store: KeyValueStore = localStorage,
): Promise<ProjectMeta> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("project name is empty");
  const now = nowSeconds();
  const meta: ProjectMeta = { id: crypto.randomUUID(), name: trimmed, created_at: now, updated_at: now };
  store.setItem(payloadKey(meta.id), JSON.stringify(payload));
  writeIndex(store, [...readIndex(store), meta]);
  return meta;
}

export async function webSaveProject(
  id: string,
  payload: ProjectPayload,
  store: KeyValueStore = localStorage,
): Promise<ProjectMeta> {
  const index = readIndex(store);
  const existing = index.find((p) => p.id === id);
  if (!existing) throw new Error(`no project with id ${id}`);
  const updated: ProjectMeta = { ...existing, updated_at: nowSeconds() };
  store.setItem(payloadKey(id), JSON.stringify(payload));
  writeIndex(store, index.map((p) => (p.id === id ? updated : p)));
  return updated;
}

export async function webLoadProject(
  id: string,
  store: KeyValueStore = localStorage,
): Promise<[ProjectMeta, ProjectPayload]> {
  const meta = readIndex(store).find((p) => p.id === id);
  if (!meta) throw new Error(`no project with id ${id}`);
  const raw = store.getItem(payloadKey(id));
  if (!raw) throw new Error(`no project with id ${id}`);
  return [meta, JSON.parse(raw) as ProjectPayload];
}

export async function webDeleteProject(id: string, store: KeyValueStore = localStorage): Promise<void> {
  store.removeItem(payloadKey(id));
  writeIndex(store, readIndex(store).filter((p) => p.id !== id));
}
