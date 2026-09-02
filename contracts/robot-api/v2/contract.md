# Robot API v2

v2 = v1 (car, arm, lidar, unchanged, referenced by `$ref`) plus:

## Drone

Point-mass kinematics, the same spirit as the car (no physics engine) and
the arm (no solver): four degrees of freedom, forward speed and yaw rate in
the horizontal plane plus a vertical speed. It shares the car's arena
footprint (`arena_width`/`arena_height`, `robot_radius`) and clamps to it
the same way the car clamps to walls; altitude clamps to `[0, max_altitude]`.
It flies above the ground-level obstacles the car and its camera see, so
unlike the car it has no obstacle-aware sensor — only the arena walls (and
the floor/ceiling) are a hazard, which `collided` and the distance sensor
are for.

Defaults (engine `DroneConfig` / reference `okrobo._sim.DroneConfig`):
2×2 m arena, `robot_radius` 0.1 m, `max_altitude` 1.0 m, start
`(x=1.0, y=1.0, z=0.0, theta=0.0)` — the same arena and start point as the
car, since the drone shares its world.

Commands: `drone_drive {forward, vertical, yaw_rate}`, `drone_stop`
(all rates to zero), `drone_reset`. State: see `drone_state` in
[schema.json](schema.json).

## Reference dynamics

`runtime/python/okrobo/_sim.py` (`DroneWorld`) is the executable spec;
`engine/src/drone_world.cpp` implements the same math and the parity gate
(`engine/tests/parity/`) locks them together, as with v0 and v1.
