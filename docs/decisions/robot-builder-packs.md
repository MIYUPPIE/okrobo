# Decision: robot builder packs (Robot Builder Phase 8)

**Date:** 2026-09-04

## Choice

Close two gaps: a Build-mode robot can now be exported as a standalone `contracts/robot-def/v0` file, and an installed pack's `robot_defs` content can now actually be read back and loaded into Build mode's New Robot picker (Phase 7's `TemplateDialog`). Deliberately does not build pack *authoring*/*signing*/*publishing* — turning an exported file into pack content stays a manual, teacher-side step through the existing, unchanged `scripts/build-pack-index.mjs`/`sign-pack.mjs` tooling, the same way `packs/core/robots/arm.urdf` is hand-authored today, not exported by any UI.

## The gap was bigger than "robot-def specific"

Investigating this phase surfaced something not obvious from the Robot Builder side alone: `install_pack`/`list_packs`/`uninstall_pack` (`apps/studio/src-tauri/src/packs.rs`) already worked, but **nothing ever read an installed pack's content back out** — only the bundled core pack is wired into the UI, via Vite's `@packs/*` build-time alias statically importing `packs/core/worlds/arena.json` etc. straight into the JS bundle (`apps/studio/vite.config.ts:8-11`). A downloaded, non-core pack sitting in `app_data_dir()/packs/<id>/` was, and without this phase would still be, completely inert. The new `read_pack_file` Tauri command (`apps/studio/src-tauri/src/packs.rs`'s `PackStore::read_file`, wrapped in `src/lib.rs`) is deliberately generic — a plain `(pack_id, relative_path) -> bytes` read, reusing the existing (previously test-only) `safe_entry_path` traversal guard — not something robot-def-specific, so any future content type gets the same read-back path for free.

## `contracts/pack/v0` extended in place, not forked to v1

Every other contract in this repo (`robot-api`, `robot-def`, `world-def`) states an explicit "frozen once shipped, changes fork to the next version" policy. `contracts/pack/v0/contract.md` never stated one. Those version bumps were for wire-protocol-shaped content — a new command/state message shape an old client genuinely cannot parse. `pack.json`'s `contents` object is closer to an ordinary extensible schema, and its own hand-rolled validator (`apps/studio/src/packs/manifest.ts`) already treated unknown `contents` keys leniently rather than rejecting them, before this phase touched it at all — an old pack.json stays valid under the extended validator, a new one degrades gracefully (empty arrays) against old app code that hasn't updated. `contents.robot_defs`/`contents.world_defs` are additive optional arrays for exactly this reason. This is a deliberate divergence from the other three contracts' stricter policy, not an inconsistency nobody noticed — recorded here so it reads as a choice, not a gap.

## Export produces a plain file, not a signed pack archive

The simplest, most shareable unit: email it, put it on a USB stick, or hand-curate it into a pack's `robot_defs/` later. Two mechanisms, since this app runs both as a plain web app and as the Tauri desktop shell, and neither had any existing file-save/download code before this phase (grepped: zero `Blob(`/`download=`/`showSaveFilePicker` hits anywhere in `apps/studio/src/`, and neither `tauri-plugin-dialog` nor `tauri-plugin-fs` was a dependency):
- **Browser**: `Blob` + a synthetic `<a download>` click. Zero new dependencies.
- **Desktop**: added `tauri-plugin-dialog` (Tauri's own first-party save-dialog plugin, the tried-and-true choice for exactly this — checked crates.io/the official docs before adding it, not guessed) for a native "Save As" picker, plus one new, small `export_robot_file` Tauri command doing a bare `std::fs::write(path, contents)` — mirroring `write_payload`'s existing `fs::write` calls in `projects.rs`, just targeting an arbitrary user-chosen path instead of the fixed project directory. No `tauri-plugin-fs` needed for a single one-shot write.

## The picker reuses Phase 7's `TemplateDialog`, not a new screen

`TemplateDialog.tsx` was already "pick a robot to start Build mode from." It now has a second, async-loaded section listing robot-def content found in installed packs (`apps/studio/src/builder/packRobots.ts`'s `listPackRobots`, two IPC round-trips per pack: `read_pack_file(id, "pack.json")` to find out what it declares, then `read_pack_file(id, path)` per entry). One picker, one mental model. A pack whose manifest or a single robot-def file fails to parse is skipped and logged, not thrown — one corrupt pack or file should never blank the whole picker.

## A real, known gap in this phase's own test coverage

`scripts/lib/studio-e2e-check.mjs` drives the app as a plain browser tab (the Vite dev server, not the Tauri desktop shell) — `isTauri()` is false there, so every Tauri IPC call in this feature (`read_pack_file`, `export_robot_file`) is unreachable from that harness. The e2e checks added this phase prove what they honestly can in that environment: the pack section settles to a clean empty state rather than hanging or crashing (the `listPackRobots().catch()` graceful-degradation path really works), and clicking Export doesn't throw and never mutates the document. They do **not** prove a real installed pack's robot actually appears, or that the desktop save dialog actually writes a file — those are proven instead by `packRobots.test.ts` (mocked IPC, real parsing/skip-on-error logic) and `exportRobot.test.ts` (both branches, mocked `@tauri-apps/plugin-dialog`/`exportRobotFile`), plus the Rust `read_file` tests in `packs.rs`. Stated plainly rather than papered over, matching this suite's own existing precedent for a gizmo-drag it also cannot simulate.

## Non-goals

- **No in-app pack creation, signing, or publishing UI.** A signing key inside the student-facing app is a real security decision this phase doesn't make.
- **No world-def export or picker.** Build mode has no world-authoring surface (Phase 5's own non-goal, unaffected) — nothing exists yet to export, and nowhere to load a picked one into. `contents.world_defs` ships in the schema for symmetry and future pack authors only.
- **No editing of an installed pack's content, no changes to how packs are discovered/downloaded** (`store.ts`/`AssetStore.tsx`'s existing asset-store/school-server flow untouched) — this phase only makes already-installed packs' robot content actually consumable.
- **No generic "browse any installed pack's files" UI.** The only surfaced content type is robot-def, through the New Robot picker specifically.
