# Pack v0

A pack is a directory (or a `.tar.gz` of one) with `pack.json` at its root,
shipping worlds, robots, and lessons. The core pack installs with the app;
others arrive from the asset store or a school server and then work offline
forever.

```text
robotics-pack/
├── pack.json            manifest (schema.json)
├── worlds/*.json        contracts/world/v0
├── robots/*.urdf        URDF subset (contracts/urdf below)
├── lessons/*.md         lesson markdown with runnable steps
├── robot_defs/*.json    contracts/robot-def/v0 (Robot Builder Phase 8)
└── world_defs/*.json    contracts/world-def/v0 (Robot Builder Phase 8)
```

## robot_defs / world_defs (Robot Builder Phase 8)

Paths to `contracts/robot-def/v0`/`contracts/world-def/v0` documents -- an
arbitrary, student-buildable robot or static test environment, not the
fixed Car/Arm/Drone/arena content `robots`/`worlds` already cover. Added
additively to this same v0 manifest rather than forking a `v1` (unlike
`robot-api`/`robot-def`/`world-def`, this contract never stated a
"frozen once shipped" policy, and its own hand-rolled validator already
treats unknown `contents` keys leniently -- see
`docs/decisions/robot-builder-packs.md`). Loaded via each document's own
`parseRobotDef`/`parseWorldDef` (never through the URDF importer), and
surfaced to a student through Build mode's "New Robot" picker, not a
generic file browser.

## Index (asset store / school server)

A source publishes `index.json`: `{"packs": [<manifest>, ...]}` where each
manifest carries `size_bytes`, `sha256`, and a `url` resolved relative to the
index. The studio prefers a school server on the LAN over the internet; both
speak the same static-file shape, so a school server is just a directory
served over HTTP.

## URDF subset

Robots are described in URDF, but only the subset the engine implements:
`<robot name>` with `<link>` (optional `<visual><geometry><box|cylinder|
sphere>`) and `<joint type="revolute|continuous|fixed">` carrying `<origin
xyz rpy>`, `<axis xyz>`, and `<limit lower upper velocity>`. Anything else is
ignored rather than rejected, so real-world URDFs load with their unsupported
extras dropped. A chain of revolute joints maps onto the engine's joint-space
arm (contract robot-api v1): joint order is the chain order from the root
link, limits and velocities come from `<limit>`, and link lengths come from
each child joint's `origin.xyz` distance.

## Lessons

Markdown with front matter (`title`, `robot`, `pack`) and fenced blocks.
A ```` ```okrobo-python ```` block is a runnable step: the lesson player loads
it into the editor for the student to run.

## Rules

- Pack ids are unique; installing a pack with an existing id upgrades it when
  the version is newer, and is refused otherwise.
- A downloaded archive is verified against `sha256` before it is unpacked.
  A mismatch aborts the install and leaves the previous version in place.
- Pack content is data, never code: no executable payloads, and every file is
  validated against its schema on load.
