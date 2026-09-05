"""Gate tests for the robot-def v1 reference model and validator.
Mirrors engine/tests/test_robot_def.cpp and apps/studio/src/contracts/robotDef.test.ts:
all three read the same fixtures under contracts/robot-def/v1/ (v1's own
examples/invalid include v0's fixtures verbatim, since v1 is a strict
additive superset -- see docs/decisions/cad-kernel-foundation.md)."""

import json
from pathlib import Path

import pytest

from okrobo import CadMeshGeometry, parse_robot_def, robot_def_to_dict, validate_robot_def

CONTRACT_DIR = Path(__file__).resolve().parents[3] / "contracts" / "robot-def" / "v1"
EXAMPLES_DIR = CONTRACT_DIR / "examples"
INVALID_DIR = CONTRACT_DIR / "invalid"


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def test_examples_directory_is_not_empty():
    assert list(EXAMPLES_DIR.glob("*.json"))


@pytest.mark.parametrize("name", ["single-body", "two-link-arm", "cad-l-bracket"])
def test_example_is_valid_and_round_trips(name):
    data = _load(EXAMPLES_DIR / f"{name}.json")
    robot = parse_robot_def(data)
    assert validate_robot_def(robot) == []

    reparsed = parse_robot_def(robot_def_to_dict(robot))
    assert reparsed == robot


_INVALID_FIXTURES = sorted(p.stem for p in INVALID_DIR.glob("*.json"))


def test_invalid_fixtures_directory_is_not_empty():
    assert _INVALID_FIXTURES


@pytest.mark.parametrize("rule", _INVALID_FIXTURES)
def test_invalid_fixture_triggers_exactly_its_rule(rule):
    robot = parse_robot_def(_load(INVALID_DIR / f"{rule}.json"))
    rules = [issue.rule for issue in validate_robot_def(robot)]
    assert rules == [rule], f"{rule}.json: expected exactly one '{rule}' issue, got {rules}"


# One direct test per rule, pinning the exact message wording. The contract
# explicitly wants actionable messages (see contracts/robot-def/v0/contract.md);
# worth locking that literally, not just asserting a rule id fired.
_EXPECTED_MESSAGES = {
    "body-duplicate-id": "Duplicate body id 'base'",
    "body-invalid-geometry": "Body 'link1': geometry size must be positive",
    "body-invalid-mass": "Body 'link1' has no valid mass",
    "body-invalid-inertia": "Body 'link1': inertia.izz must be > 0",
    "joint-duplicate-id": "Duplicate joint id 'joint1'",
    "joint-unknown-parent-body": "Joint 'joint1': parent body 'ghost' does not exist",
    "joint-unknown-child-body": "Joint 'joint1': child body 'ghost' does not exist",
    "joint-self-loop": "Joint 'joint1' connects 'base' to itself",
    "joint-duplicate-child": "Body 'link1' is attached by more than one joint ('joint1', 'joint2')",
    "joint-missing-axis": "Joint 'joint1': axis must be non-zero",
    "joint-invalid-limits": "Joint 'joint1': limits.lower must be less than limits.upper",
    "joint-invalid-damping-friction": "Joint 'joint1': damping must be >= 0",
    "robot-no-root-body": "Robot cannot simulate: no root body found",
    "robot-multiple-root-bodies": "Robot cannot simulate: 'extra' has no parent joint attaching it to the rest of the robot",
    "robot-cycle": "Robot cannot simulate: cycle detected in joints at body 'p'",
    "actuator-duplicate-id": "Duplicate actuator id 'a1'",
    "actuator-unknown-target-joint": "Actuator 'a1': target joint 'ghost' does not exist",
    "actuator-fixed-joint-target": "Actuator 'a1': cannot actuate fixed joint 'joint1'",
    "actuator-invalid-limits": "Actuator 'a1': limits.effort must be > 0",
    "sensor-duplicate-id": "Duplicate sensor id 's1'",
    "sensor-unknown-body": "Sensor 's1': body 'ghost' does not exist",
    "sensor-encoder-missing-joint": "Sensor 's1': encoder sensors must set 'joint'",
    "sensor-unknown-joint": "Sensor 's1': joint 'ghost' does not exist",
}


def test_expected_messages_cover_every_fixture():
    # Guards against a fixture being added/removed without updating this map.
    assert set(_EXPECTED_MESSAGES) == set(_INVALID_FIXTURES)


@pytest.mark.parametrize("rule", sorted(_EXPECTED_MESSAGES))
def test_invalid_fixture_message_wording(rule):
    robot = parse_robot_def(_load(INVALID_DIR / f"{rule}.json"))
    issues = validate_robot_def(robot)
    assert issues[0].message == _EXPECTED_MESSAGES[rule]


def test_parse_raises_on_missing_required_field():
    with pytest.raises(ValueError):
        parse_robot_def({"id": "x", "name": "X"})  # no bodies


# CAD Kernel Phase 1: the new cad_mesh geometry variant. See
# docs/decisions/cad-kernel-foundation.md.
_IDENTITY = {"position": [0.0, 0.0, 0.0], "rotation_rpy": [0.0, 0.0, 0.0]}
# A tetrahedron: 4 vertices, 4 triangular faces.
_TETRAHEDRON = {
    "vertices": [0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.1],
    "faces": [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3],
}


def _make_robot_with(visual, collision=None, has_collision=False):
    body = {
        "id": "part",
        "name": "Part",
        "transform": _IDENTITY,
        "visual": visual,
        "mass": 0.1,
        "inertia": {"ixx": 0.001, "iyy": 0.001, "izz": 0.001},
    }
    # Only set `collision` at all when a caller actually wants one, so a
    # single geometry field can be tested in isolation (mirrors
    # apps/studio/src/contracts/robotDef.test.ts's makeRobotWith).
    if has_collision:
        body["collision"] = collision
    return {
        "id": "cad-test",
        "name": "CAD Test",
        "description": "",
        "root_placement": _IDENTITY,
        "bodies": [body],
        "joints": [],
        "actuators": [],
        "sensors": [],
    }


def test_cad_mesh_parses_validates_cleanly_and_round_trips():
    geometry = {"type": "cad_mesh", **_TETRAHEDRON}
    robot = parse_robot_def(_make_robot_with(geometry, geometry, has_collision=True))
    assert validate_robot_def(robot) == []
    assert isinstance(robot.bodies[0].visual, CadMeshGeometry)

    reparsed = parse_robot_def(robot_def_to_dict(robot))
    assert reparsed == robot


def test_cad_mesh_rejects_a_non_multiple_of_3_vertices_array():
    bad = {"type": "cad_mesh", "vertices": [0.0, 0.0], "faces": [0, 0, 0]}
    robot = parse_robot_def(_make_robot_with(bad))
    issues = validate_robot_def(robot)
    assert [i.rule for i in issues] == ["body-invalid-geometry"]
    assert issues[0].element_id == "part"


def test_cad_mesh_rejects_a_face_index_out_of_range():
    bad = {"type": "cad_mesh", "vertices": _TETRAHEDRON["vertices"], "faces": [0, 1, 99]}
    robot = parse_robot_def(_make_robot_with(bad))
    issues = validate_robot_def(robot)
    assert [i.rule for i in issues] == ["body-invalid-geometry"]
    assert issues[0].element_id == "part"


def test_cad_mesh_raises_on_a_non_numeric_vertices_array():
    with pytest.raises(ValueError):
        parse_robot_def(_make_robot_with({"type": "cad_mesh", "vertices": ["x"], "faces": [0, 0, 0]}))


def test_cad_mesh_raises_on_a_negative_face_index():
    with pytest.raises(ValueError):
        parse_robot_def(_make_robot_with({"type": "cad_mesh", "vertices": _TETRAHEDRON["vertices"], "faces": [-1, 0, 0]}))
