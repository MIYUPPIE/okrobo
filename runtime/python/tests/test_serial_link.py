"""Gate tests for the serial link (contracts/robot-serial/v0).

These run the real okrobo/serial_link.py against a fake board on a pty, so the
link is exercised end to end without hardware attached.
"""

import math

import pytest

serial = pytest.importorskip(
    "serial", reason="run: python3 -m pip install --target=.deps -r requirements.txt"
)

from okrobo import Robot  # noqa: E402
from okrobo.serial_link import (  # noqa: E402
    SerialError,
    SerialRobot,
    format_drive,
    list_ports,
    parse_state_line,
)

from .fake_board import FakeBoard  # noqa: E402


def connect(board: FakeBoard) -> SerialRobot:
    return SerialRobot(board.port)


def test_parse_state_line():
    state = parse_state_line("T 42 1.250 -0.500 1.5708 0.900 1")
    assert state is not None
    assert state.tick == 42
    assert math.isclose(state.pose.x, 1.25)
    assert math.isclose(state.pose.y, -0.5)
    assert math.isclose(state.pose.theta, 1.5708)
    assert math.isclose(state.distance, 0.9)
    assert state.collided is True


def test_parse_state_line_rejects_junk():
    assert parse_state_line("") is None
    assert parse_state_line("E bad-command") is None
    assert parse_state_line("T 1 2 3") is None
    assert parse_state_line("T a b c d e f") is None
    # A truncated line from a noisy cable must not raise.
    assert parse_state_line("T 42 1.25") is None


def test_format_drive_matches_the_contract():
    assert format_drive(0.2, -0.15) == "D 0.200 -0.150"
    assert format_drive(0, 0) == "D 0.000 0.000"


def test_connect_identifies_the_board():
    with FakeBoard() as board:
        robot = connect(board)
        assert robot.identity == "okrobo-car 1"
        assert board.commands[0] == "H"
        robot.close()


def test_connect_tolerates_boot_noise():
    with FakeBoard(boot_noise="ets Jun  8 2016 00:22:57 rst:0x1") as board:
        robot = connect(board)
        assert robot.identity == "okrobo-car 1"
        robot.close()


def test_connect_refuses_a_port_that_never_identifies():
    with FakeBoard(identify=False) as board:
        with pytest.raises(SerialError, match="no OKROBO robot"):
            connect(board)


def test_drive_and_state_round_trip():
    with FakeBoard() as board:
        robot = connect(board)
        robot.drive(0.2, 0.2)
        board.wait_until(lambda: board.left == 0.2 and board.right == 0.2)

        state = robot.refresh()
        assert state.tick == 1
        assert state.pose.x > 0  # the board integrated forward motion
        assert math.isclose(state.distance, 0.9, abs_tol=1e-6)

        robot.stop()
        board.wait_until(lambda: board.left == 0.0 and board.right == 0.0)
        robot.close()


def test_reset_clears_board_odometry():
    with FakeBoard() as board:
        robot = connect(board)
        robot.drive(0.3, 0.3)
        robot.refresh()
        assert board.x > 0
        robot.reset()
        board.wait_until(lambda: board.x == 0.0 and board.tick == 0)
        robot.close()


def test_close_stops_the_wheels():
    with FakeBoard() as board:
        robot = connect(board)
        robot.drive(0.4, 0.4)
        robot.close()
        board.wait_until(lambda: board.commands[-1] == "S")
        # Closing twice is harmless.
        robot.close()


def test_student_robot_api_drives_hardware_unchanged():
    """The whole point: the same Robot program, a different backend."""
    with FakeBoard() as board:
        link = connect(board)
        robot = Robot(world=link)
        robot.forward(0.1)
        # The student's call became wheel commands on the wire, and the
        # movement finished with the wheels stopped.
        assert any(c.startswith("D ") for c in board.commands)
        board.wait_until(lambda: board.left == 0.0 and board.right == 0.0)
        assert isinstance(robot.distance(), float)
        link.close()


def test_ray_offaxis_is_unavailable_on_hardware():
    with FakeBoard() as board:
        robot = connect(board)
        robot.refresh()
        assert math.isclose(robot.ray(0.0), robot.state().distance)
        assert math.isnan(robot.ray(0.5))
        robot.close()


def test_list_ports_returns_dicts():
    for port in list_ports():
        assert {"device", "description", "hwid"} <= set(port)
