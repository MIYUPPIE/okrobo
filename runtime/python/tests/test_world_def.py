"""Gate tests for the world-def v0 reference model and validator.
Mirrors engine/tests/test_world_def.cpp and
apps/studio/src/contracts/worldDef.test.ts: all three read the same
fixtures under contracts/world-def/v0/."""

import json
from pathlib import Path

import pytest

from okrobo import parse_world_def, validate_world_def, world_def_to_dict

CONTRACT_DIR = Path(__file__).resolve().parents[3] / "contracts" / "world-def" / "v0"
EXAMPLES_DIR = CONTRACT_DIR / "examples"
INVALID_DIR = CONTRACT_DIR / "invalid"


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def test_examples_directory_is_not_empty():
    assert list(EXAMPLES_DIR.glob("*.json"))


@pytest.mark.parametrize("name", ["empty", "obstacle-course", "ramp"])
def test_example_is_valid_and_round_trips(name):
    data = _load(EXAMPLES_DIR / f"{name}.json")
    world = parse_world_def(data)
    assert validate_world_def(world) == []

    reparsed = parse_world_def(world_def_to_dict(world))
    assert reparsed == world


_INVALID_FIXTURES = sorted(p.stem for p in INVALID_DIR.glob("*.json"))


def test_invalid_fixtures_directory_is_not_empty():
    assert _INVALID_FIXTURES


_EXPECTED_MESSAGES = {
    "object-duplicate-id": "Duplicate object id 'box1'",
    "object-invalid-geometry": "Object 'box1': geometry size must be positive",
}


def test_expected_messages_cover_every_fixture():
    assert set(_EXPECTED_MESSAGES) == set(_INVALID_FIXTURES)


@pytest.mark.parametrize("rule", sorted(_EXPECTED_MESSAGES))
def test_invalid_fixture_triggers_exactly_its_rule(rule):
    world = parse_world_def(_load(INVALID_DIR / f"{rule}.json"))
    issues = validate_world_def(world)
    assert [i.rule for i in issues] == [rule]
    assert issues[0].message == _EXPECTED_MESSAGES[rule]


def test_parse_raises_on_missing_required_field():
    with pytest.raises(ValueError):
        parse_world_def({"id": "x", "name": "X"})  # no objects


def test_parse_raises_when_object_has_no_geometry():
    with pytest.raises(ValueError):
        parse_world_def({"id": "x", "name": "X", "objects": [{"id": "o1", "name": "O1"}]})
