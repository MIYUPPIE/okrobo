"""Run a command scenario through the reference model, one state per line (JSONL).

    python3 -m okrobo.dump_trace --world arena.json --scenario scenario.json
    python3 -m okrobo.dump_trace --robot arm --scenario arm-scenario.json
    python3 -m okrobo.dump_trace --robot drone --scenario drone-scenario.json

Scenario format: {"dt": 0.01, "phases": [{"command": <contract command>,
"steps": <int>}, ...]} (v0 commands for the car, v1 arm commands for the arm,
v2 drone_* commands for the drone). Emits the state message after applying
each phase's command and after every step. Used by the engine parity gate
(engine/tests/parity/) to lock the WASM engine to this reference.
"""

from __future__ import annotations

import argparse
import json

from ._sim import ArmWorld, DroneWorld, World, WorldConfig


def apply_car_command(world: World, command: dict) -> None:
    if command["type"] == "drive":
        world.drive(command["left"], command["right"])
    elif command["type"] == "stop":
        world.stop()
    elif command["type"] == "reset":
        world.reset()
    else:
        raise ValueError(f"unknown command type: {command['type']!r}")


def apply_arm_command(world: ArmWorld, command: dict) -> None:
    if command["type"] == "arm_target":
        world.set_target(command["joint"], command["angle"])
    elif command["type"] == "arm_grip":
        world.grip()
    elif command["type"] == "arm_release":
        world.release()
    elif command["type"] == "stop":
        world.stop()
    elif command["type"] == "reset":
        world.reset()
    else:
        raise ValueError(f"unknown command type: {command['type']!r}")


def apply_drone_command(world: DroneWorld, command: dict) -> None:
    if command["type"] == "drone_drive":
        world.drive(command["forward"], command["vertical"], command["yaw_rate"])
    elif command["type"] == "drone_stop":
        world.stop()
    elif command["type"] == "drone_reset":
        world.reset()
    else:
        raise ValueError(f"unknown command type: {command['type']!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--robot", choices=["car", "arm", "drone"], default="car")
    parser.add_argument("--world", help="contracts/world/v0 JSON file (car only)")
    parser.add_argument("--scenario", required=True, help="scenario JSON file")
    args = parser.parse_args()

    with open(args.scenario) as f:
        scenario = json.load(f)

    if args.robot == "car":
        if not args.world:
            parser.error("--world is required for the car")
        with open(args.world) as f:
            world = World(WorldConfig.from_dict(json.load(f)))
        apply = apply_car_command
    elif args.robot == "arm":
        world = ArmWorld()
        apply = apply_arm_command
    else:
        world = DroneWorld()
        apply = apply_drone_command

    dt = scenario["dt"]
    for phase in scenario["phases"]:
        apply(world, phase["command"])
        print(json.dumps(world.state().to_message()))
        for _ in range(phase["steps"]):
            world.step(dt)
            print(json.dumps(world.state().to_message()))


if __name__ == "__main__":
    main()
