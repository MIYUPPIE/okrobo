# Robot API v0

The boundary between controllers (studio UI, student Python, hardware bridges) and robot backends (engine WASM, native sidecar, physical robot). Defined in [schema.json](schema.json), examples in [examples/](examples/).

## Model

Differential-drive robot in a rectangular arena.

- Units: meters, radians, seconds. `theta = 0` faces +x, counter-clockwise positive, normalized to `(-pi, pi]`.
- `drive {left, right}`: wheel linear speeds in m/s. Held until the next command.
- `stop`: both wheels to 0.
- `reset`: world back to its initial state, tick 0.
- `state`: emitted after each step. `sensors.distance` is measured from the robot's front edge along its heading. `collided` is true when the last step was limited by a wall.

## Reference dynamics

The executable spec is `runtime/python/okrobo/_sim.py`. The C++ engine (`engine/src/world.cpp`) implements the same equations; a parity test locks them together (Phase 1). Exact unicycle update per step `dt`:

```text
v = (left + right) / 2
w = (right - left) / wheel_base
if |w| < 1e-9:  x += v*dt*cos(theta);  y += v*dt*sin(theta)
else:           R = v/w
                x += R*(sin(theta + w*dt) - sin(theta))
                y -= R*(cos(theta + w*dt) - cos(theta))
                theta = normalize(theta + w*dt)
```

Then the position is clamped so the robot (radius `r`) stays inside the arena; a clamp sets `collided`.

## Versioning

This directory is frozen once both sides ship against it. Changes go to `v1/` with both sides updated in the same commit.
