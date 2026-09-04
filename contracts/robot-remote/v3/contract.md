# Robot Remote v3

Same transport, framing, and lifecycle as [v2](../v2/contract.md) — three
processes, two hops, single-line JSON, strictly sequential requests. v3 adds
the arm's graspable object (robot-api v3) to the method set. Every v0/v1/v2
message shape is unchanged, so an older student program runs untouched.

## Methods

### Car, Arm movement, Drone (v0/v1/v2, unchanged)

See [v2's contract](../v2/contract.md).

### New in v3 — Arm object

| method | args | result |
|---|---|---|
| `arm_grip` | — | `boolean`, whether the tip was close enough to grip |
| `arm_release` | — | `null` |
| `arm_holding` | — | `boolean` |
| `arm_object` | — | `[x, y, z]` meters |

`arm_grip` and `arm_holding` return a value immediately, unlike the
blocking movement methods — gripping is instantaneous, there is nothing to
wait on. The worker's `Arm` class exposes these as `grip()` (returns
`bool`), `release()`, `holding()`, `object()`.
