# Robot Remote v1

Same transport, framing, and lifecycle as [v0](../v0/contract.md) — three
processes, two hops, single-line JSON, strictly sequential requests:

```text
student code          sidecar                 studio (browser)
python subprocess --- okrobo/worker.py        PythonBridge.ts
  robot.forward() ->  socketpair JSONL   ->   WebSocket JSONL -> ProgramRunner -> engine
```

v1 adds the arm and the lidar fan (robot-api v1) to the method set. Every v0
message shape is unchanged, so a v0 student program runs untouched.

## Methods

### Car (v0, unchanged)

`forward {meters}`, `backward {meters}`, `turn_left {degrees}`,
`turn_right {degrees}`, `wait {seconds}` -> `null`;
`distance {}` -> number, `heading {}` -> number, `position {}` -> `[x, y]`,
`stop {}` -> `null`.

### New in v1

| method | args | result |
|---|---|---|
| `lidar` | `rays` (int), `fov_degrees` (number) | `number[]`, left to right |
| `camera` | `width` (int), `height` (int) | `{width, height, pixels}`, RGB bytes as numbers, row-major from the top |
| `arm_move` | `joint` (name or index), `degrees` | `null` (blocks until arrival) |
| `arm_move_all` | `angles` (4 numbers, degrees) | `null` (blocks until arrival) |
| `arm_angles` | — | `number[4]` degrees |
| `arm_tip` | — | `[x, y, z]` meters |

Movement methods resolve when the motion finishes and reject when the user
presses Stop, exactly like the car's. The worker injects both `Robot` and
`Arm` into the fake `okrobo` module, so an unmodified student file using
either class runs against the local reference sim or the studio engine.
