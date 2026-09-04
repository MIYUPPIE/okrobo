# Decision: robot definition schema (Robot Builder Phase 1)

**Date:** 2026-09-04

## Choice

A new contract family, `contracts/robot-def/v0/`, describing an arbitrary robot as `bodies[]` + `joints[]` + `actuators[]` + `sensors[]` -- structural data only, no runtime behavior. Hand-mirrored into Python (`runtime/python/okrobo/robot_def.py`), TypeScript (`apps/studio/src/contracts/robotDef.ts`), and C++ (`engine/src/robot_def.{hpp,cpp}`), following this repo's existing convention (no codegen anywhere in the project). Purely additive: Car/Arm/Drone and every existing contract, test, and pack are untouched.

Three sub-decisions worth recording, since a reader of `build.md`'s roadmap wouldn't expect them from the one-line summary:

## New family, not a `robot-api` version bump

`contracts/robot-api/vN` is the message protocol between a controller and a running robot backend (commands in, state out) -- every version so far has bolted one more hardcoded robot kind's commands onto that protocol. `robot-def` is a different kind of thing: a static document describing what a robot *is*, structurally, before it runs. That's the same relationship `contracts/world/` (an arena document) already has to `robot-api` (the protocol that runs inside it) -- so `robot-def` gets its own family rather than becoming `robot-api/v4`.

## Kinematic tree via `joints[]` edges, not a `body.parent` field

A body with no incoming joint edge is a root; rigid attachment is a `fixed` joint, not a second hierarchy mechanism. This mirrors URDF exactly, and matches the idiom this repo's own `apps/studio/src/packs/urdf.ts` already uses (`jointChain` walks `parent`/`child` edges, never a stored parent pointer). Avoids two representations of the same tree ever disagreeing.

## A new C++ dependency: nlohmann/json, scoped tightly

The engine has never parsed JSON -- `wasm_api.cpp` deliberately avoids it, keeping the WASM boundary to primitive scalars. Phase 1 needs the C++ side to parse `robot-def` documents into a typed structure. Unlike the hand-written JSON-Schema-style *validators* this repo already reinvents on purpose (`apps/studio/src/lib/validateWorld.ts`, `apps/studio/src/packs/manifest.ts` -- worth owning, since the payoff is tight, actionable error messages), a general JSON *parser* is well-trodden ground where hand-rolling risks subtle bugs (string escapes, number precision) for no benefit. Vendored **nlohmann/json** (single header, MIT, the de facto standard) via `FetchContent` in `engine/CMakeLists.txt`, pinned to `v3.11.3` -- the exact mechanism already used for MuJoCo.

Scoped narrowly so it can't leak: only `robot_def.cpp` includes `<nlohmann/json.hpp>` (`robot_def.hpp`'s public interface exposes no JSON types), and it builds as its own CMake target (`okrobo_robot_def`), never linked into `okrobo_engine`. `scripts/build-engine-wasm.sh` hand-lists every `.cpp` file it compiles and `robot_def.cpp` is not among them, so this dependency mechanically cannot reach the WASM bundle students' browsers download.

## Explicitly not decided here

Whether/how MJCF gets generated from a `robot-def` document, how the frontend builder UI represents this schema, and whether Car/Arm/Drone ever migrate onto it are separate decisions for Phase 3+ and Phase 7 respectively (see `build.md`'s Robot Builder roadmap entries). This document covers Phase 1 (schema, serialization, validation) only.
