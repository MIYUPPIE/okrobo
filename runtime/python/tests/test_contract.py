"""Structural gate tests for contracts/robot-api/v0.

Dependency-free checks that the schema parses, the examples match the message
shapes, and the reference model emits contract-shaped state.
"""

import json
import math
from pathlib import Path

from okrobo import World

CONTRACT_DIR = Path(__file__).resolve().parents[3] / "contracts" / "robot-api" / "v0"

COMMAND_TYPES = {"drive", "stop", "reset"}


def _check_state_message(msg: dict) -> None:
    assert set(msg) == {"tick", "pose", "sensors", "collided"}
    assert isinstance(msg["tick"], int) and msg["tick"] >= 0
    assert set(msg["pose"]) == {"x", "y", "theta"}
    assert all(isinstance(msg["pose"][k], (int, float)) for k in ("x", "y", "theta"))
    assert -math.pi < msg["pose"]["theta"] <= math.pi
    assert set(msg["sensors"]) == {"distance"}
    assert msg["sensors"]["distance"] >= 0
    assert isinstance(msg["collided"], bool)


def test_schema_parses():
    schema = json.loads((CONTRACT_DIR / "schema.json").read_text())
    assert set(schema["definitions"]) == {"command", "state"}


def test_command_examples():
    for name in ("command-drive", "command-stop", "command-reset"):
        msg = json.loads((CONTRACT_DIR / "examples" / f"{name}.json").read_text())
        assert msg["type"] in COMMAND_TYPES
        if msg["type"] == "drive":
            assert set(msg) == {"type", "left", "right"}
            assert isinstance(msg["left"], (int, float))
            assert isinstance(msg["right"], (int, float))
        else:
            assert set(msg) == {"type"}


def test_state_example():
    msg = json.loads((CONTRACT_DIR / "examples" / "state.json").read_text())
    _check_state_message(msg)


def test_reference_model_emits_contract_shape():
    world = World()
    world.drive(0.2, 0.1)
    world.step(0.01)
    _check_state_message(world.state().to_message())
