"""Run a command scenario through the reference model, one state per line (JSONL).

    python3 -m okrobo.dump_trace --world arena.json --scenario scenario.json

Scenario format: {"dt": 0.01, "phases": [{"command": <contract v0 command>,
"steps": <int>}, ...]}. Emits the state message after applying each phase's
command and after every step. Used by the engine parity gate
(engine/tests/parity/) to lock the WASM engine to this reference.
"""

from __future__ import annotations

import argparse
import json

from ._sim import World, WorldConfig


def apply_command(world: World, command: dict) -> None:
    if command["type"] == "drive":
        world.drive(command["left"], command["right"])
    elif command["type"] == "stop":
        world.stop()
    elif command["type"] == "reset":
        world.reset()
    else:
        raise ValueError(f"unknown command type: {command['type']!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", required=True, help="contracts/world/v0 JSON file")
    parser.add_argument("--scenario", required=True, help="scenario JSON file")
    args = parser.parse_args()

    with open(args.world) as f:
        world = World(WorldConfig.from_dict(json.load(f)))
    with open(args.scenario) as f:
        scenario = json.load(f)

    dt = scenario["dt"]
    for phase in scenario["phases"]:
        apply_command(world, phase["command"])
        print(json.dumps(world.state().to_message()))
        for _ in range(phase["steps"]):
            world.step(dt)
            print(json.dumps(world.state().to_message()))


if __name__ == "__main__":
    main()
