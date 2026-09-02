"""Cross-language parity for contracts/robot-serial/v0.

Everything the Python side sends must be understood by the firmware's real
parser, and the state lines the firmware emits must parse back to the same
numbers on the Python side. Same idea as the simulator's parity gate: one
contract, two implementations, locked together.

Skips when the firmware has not been built (test-all.sh builds it first).
"""

import math
import subprocess
from pathlib import Path

import pytest

from okrobo.serial_link import format_drive, parse_state_line

CLI = Path(__file__).resolve().parents[3] / "firmware" / "build" / "protocol_cli"

pytestmark = pytest.mark.skipif(
    not CLI.exists(), reason="firmware not built: cmake -B firmware/build firmware && cmake --build"
)


def through_firmware(lines: list) -> list:
    """Run lines through the firmware's parser and return its verdicts."""
    result = subprocess.run(
        [str(CLI)],
        input="\n".join(lines) + "\n",
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip().split("\n")


def test_python_drive_commands_are_understood_by_the_firmware():
    speeds = [
        (0.0, 0.0),
        (0.2, 0.2),
        (-0.15, 0.15),
        (0.5, -0.5),
        (0.001, 0.999),
        (1.25, 2.5),
    ]
    lines = [format_drive(left, right) for left, right in speeds]
    verdicts = through_firmware(lines)
    assert len(verdicts) == len(speeds)

    for (left, right), verdict in zip(speeds, verdicts):
        parts = verdict.split()
        assert parts[0] == "DRIVE", f"firmware rejected {format_drive(left, right)!r}"
        # The board parses to float32 with 3 decimals on the wire.
        assert math.isclose(float(parts[1]), left, abs_tol=1e-3)
        assert math.isclose(float(parts[2]), right, abs_tol=1e-3)


def test_simple_verbs_match():
    verdicts = through_firmware(["H", "S", "R", "Q"])
    assert verdicts == ["HELLO", "STOP", "RESET", "QUERY"]


def test_firmware_rejects_what_python_would_never_send():
    verdicts = through_firmware(["D", "D 0.1", "NONSENSE", "D a b"])
    assert verdicts == ["ERROR", "ERROR", "ERROR", "ERROR"]


def test_firmware_state_lines_parse_on_the_python_side():
    # Byte-for-byte what firmware format_state produces (see
    # firmware/tests/test_protocol.cpp), parsed by the link.
    state = parse_state_line("T 1234 1.250 -0.500 1.5708 0.900 1")
    assert state is not None
    assert state.tick == 1234
    assert math.isclose(state.pose.x, 1.25)
    assert math.isclose(state.pose.theta, 1.5708)
    assert state.collided is True

    zero = parse_state_line("T 0 0.000 0.000 0.0000 0.000 0")
    assert zero is not None and zero.tick == 0 and zero.collided is False
