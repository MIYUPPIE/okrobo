# Robot Remote v2

Same transport, framing, and lifecycle as [v1](../v1/contract.md) — three
processes, two hops, single-line JSON, strictly sequential requests. v2 adds
the drone (robot-api v2) to the method set. Every v0/v1 message shape is
unchanged, so a v0 or v1 student program runs untouched.

## Methods

### Car and Arm (v0/v1, unchanged)

See [v1's contract](../v1/contract.md).

### New in v2 — Drone

| method | args | result |
|---|---|---|
| `drone_takeoff` | `height` (meters) | `null` (blocks until arrival) |
| `drone_land` | — | `null` (blocks until arrival) |
| `drone_forward` / `drone_backward` | `meters` | `null` (blocks; stops early at a wall) |
| `drone_up` / `drone_down` | `meters` | `null` (blocks; stops early at the floor/ceiling) |
| `drone_turn_left` / `drone_turn_right` | `degrees` | `null` (blocks until arrival) |
| `drone_altitude` | — | number, meters above the ground |
| `drone_distance` | — | number, meters to the nearest wall along the heading |
| `drone_heading` | — | number, degrees |
| `drone_position` | — | `[x, y, z]` meters |
| `wait` / `stop` | shared with car and arm | `null` |

Movement methods resolve when the motion finishes and reject when the user
presses Stop, exactly like the car's and the arm's. The worker injects
`Robot`, `Arm`, and `Drone` into the fake `okrobo` module, so an unmodified
student file using any of the three classes runs against the local reference
sim or the studio engine.
