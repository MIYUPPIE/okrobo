# Decision: web persistence — import a robot file + real Save/Open on the web build

**Date:** 2026-09-10

## Scope

Before this, the entire File menu (New Project/Open/Save/Save As, recent projects) was `disabled={!inDesktop}` — a web user had no way to persist a project at all; the work vanished the moment the tab closed. Separately, there was no way to load a previously-exported `.robot-def.json` file back into Build mode, on either platform — Export existed, Import didn't. Closes both: a browser-local project store wired into the existing `projects/api.ts` contract, and a new "From a file" source in the "New Robot" picker.

## `localStorage`, not IndexedDB

Project payloads here are parametric — CAD bodies store a `Feature[]` parameter history, not baked meshes; Blockly/Python are plain text — so realistic per-project size is tens of KB, comfortably inside `localStorage`'s ~5-10MB per-origin ceiling for dozens of saved projects. Chosen over IndexedDB specifically to avoid a new test dependency: **empirically, this repo's Node 26 + vitest + jsdom combination does not provide a working `localStorage` global** (Node's own built-in Web Storage implementation returns `undefined` for `globalThis.localStorage`/`window.localStorage` unless the process is launched with `--localstorage-file`, a fact only discovered by writing a diagnostic test and watching it fail, not assumed from "jsdom usually has this"). IndexedDB would have needed `fake-indexeddb` as a new devDependency just to test it; `localStorage`'s minimal three-method surface (`getItem`/`setItem`/`removeItem`) is instead taken as an **injectable parameter** (`KeyValueStore` in `apps/studio/src/projects/webStore.ts`, defaulting to the real global for production callers), so tests inject a plain `Map`-backed fake with zero new dependencies — the same `open_port`-injection precedent this codebase already uses elsewhere for testability.

## The Rust contract is the spec, mirrored field-for-field

`src-tauri/src/projects.rs`'s own 8-case test suite is the only existing behavioral spec for this contract (zero TS tests existed before this round). `webStore.ts` matches it exactly: `id` a random UUID, `created_at`/`updated_at` in whole seconds (`Math.floor(Date.now()/1000)` — `OpenDialog.tsx`'s existing `new Date(p.updated_at * 1000)` formatting needed no changes), `list` sorted DESC by `updated_at`, `create` trims the name and rejects empty-after-trim with the literal message `"project name is empty"`, `save` bumps only `updated_at` (never `created_at`) and rejects an unknown id with `` `no project with id ${id}` `` — both error strings copied verbatim from the Rust `format!`s so the two backends are indistinguishable from the UI's perspective. `deleteProject` on an unknown id is a no-op, matching Rust's own "delete is not an error for unknown id."

`apps/studio/src/projects/api.ts` branches each of the 5 functions on `inDesktop`; every existing caller (`App.tsx`, `BuiltRobotDialog.tsx`, `projectRobots.ts`) needed zero changes — `BuiltRobotDialog`'s "From your saved projects" section, previously always empty on web (`listProjects()` unconditionally rejected there), now works for real with no code change of its own.

## Asset Store stays desktop-only

The "File" menu-item button itself is un-gated, but `disabled={!inDesktop}` moved down onto just the "Asset Store…" item. Pack install/signing (`installPack`/`checkPackSignature`/`listPacks`) is a separate, genuinely filesystem-bound concern (Ed25519-signed archives unpacked to `app_data_dir()`) — out of scope for "import a robot / save a project," and not something this round pretends to half-solve.

## Import lives inside `TemplateDialog.tsx`, not a standalone toolbar button

`TemplateDialog` ("New Robot" picker) is only ever opened from the empty `robotDef === null` state (`App.tsx`'s single `setDialog("new-robot")` call site) — so a new "From a file" section there never risks silently clobbering an in-progress robot, the same safety every other row (Blank, a template, a pack robot) already has for free. A direct Build-mode toolbar button next to Export was considered and rejected: it would need its own bespoke two-click confirm to avoid clobbering, duplicating what `BuilderPanel.tsx`'s existing "New Robot" two-click-confirm → empty state → "+ New Robot" → `TemplateDialog` chain already provides.

Unlike Export, Import needs **no** desktop/browser split. Export needed two mechanisms because a browser can't silently write to disk (`<a download>` vs. a native save dialog); reading a file the student explicitly picked via a plain `<input type="file">` already works identically inside Tauri's webview — no Tauri API involved, one implementation (`apps/studio/src/builder/importRobot.ts`).

## A project saved on web stays local to that browser profile

Inherent to `localStorage` — it doesn't travel to a different browser or computer. Export/Import remains the cross-device, cross-browser mechanism, the same portability story `docs/decisions/robot-builder-packs.md` already established for a single exported robot. Not stated as a limitation to fix later — it's the correct, expected behavior of browser-local storage, same as every other web app that saves locally.

## Verification

`apps/studio`: `npm run test` (878 passing, up from 860 — new `webStore.test.ts`, `projects/api.test.ts`, `importRobot.test.ts`, extended `TemplateDialog.test.tsx`), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh` gained: a full File > Save As → Open → Save-in-place → Delete round trip against the real browser-local store (the first-ever real-browser proof web save actually works, not just a unit-tested module), an Import check (a real fixture file written to disk by the script itself, fed into the hidden file input via a new `DOM.setFileInputFiles`-based `setFileInputFiles` helper in `cdp.mjs` — CDP's own documented mechanism for injecting a real file into a file input, since a synthetic click/change event can't hand the browser real file bytes), and an Asset-Store-stays-disabled check. One pre-existing check's own query (`.template-row .project-name`, asserting the exact template list) needed narrowing to the first `.project-list` specifically, since the new "From a file" row shares that same row styling class and would otherwise be counted alongside the templates — a real, if minor, coupling between this change and existing e2e assertions, found and fixed by actually running the suite rather than assumed clean. Passed twice in a row for stability, alongside the full 878-test suite and a clean build.
