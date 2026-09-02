"""Serial link to a physical OKROBO robot (contracts/robot-serial/v0).

The point of this module is that it presents the *same surface as the
simulated World* (`drive`, `stop`, `reset`, `state`), so `okrobo.Robot` drives
a real robot with no changes to the student's program: only the backend swaps.

    from okrobo import Robot
    from okrobo.serial_link import SerialRobot, list_ports

    robot = Robot(world=SerialRobot("/dev/ttyUSB0"))
    robot.forward(0.3)

See docs/decisions/serial-transport.md for why this lives in the sidecar
rather than the webview.
"""

from __future__ import annotations

from . import _deps  # noqa: F401  (adds .deps to sys.path before pyserial)

import math
import threading
import time

import serial
from serial.tools import list_ports as _list_ports

from ._sim import Pose, State

BAUD = 115200
IDENTIFY_TIMEOUT = 2.0
DEFAULT_NAME = "okrobo-car"


def list_ports() -> list:
    """Serial ports that could hold a robot, newest information first."""
    return [
        {
            "device": port.device,
            "description": port.description or "",
            "hwid": port.hwid or "",
        }
        for port in _list_ports.comports()
    ]


class SerialError(RuntimeError):
    pass


def parse_state_line(line: str) -> State | None:
    """Parse 'T <tick> <x> <y> <theta> <distance> <collided>'."""
    parts = line.split()
    if len(parts) != 7 or parts[0] != "T":
        return None
    try:
        return State(
            tick=int(parts[1]),
            pose=Pose(float(parts[2]), float(parts[3]), float(parts[4])),
            distance=float(parts[5]),
            collided=parts[6] == "1",
        )
    except ValueError:
        return None


def format_drive(left: float, right: float) -> str:
    """The board's D command; 3 decimals, matching the contract."""
    return f"D {left:.3f} {right:.3f}"


class SerialRobot:
    """A physical robot behind the simulated World's interface.

    `step()` exists so program code written against the simulator keeps
    working: on hardware the world advances by itself, so stepping only waits
    for real time to pass and refreshes the latest state from the board.
    """

    def __init__(self, port: str, baud: int = BAUD, open_port=None) -> None:
        # open_port is injectable so tests can drive a fake board over a pty.
        self._serial = (open_port or self._open)(port, baud)
        self._lock = threading.Lock()
        self._state = State(tick=0, pose=Pose(), distance=0.0, collided=False)
        self._identity = ""
        self._closed = False
        self._identify()

    @staticmethod
    def _open(port: str, baud: int):
        return serial.Serial(port, baud, timeout=0.2)

    # -- link -----------------------------------------------------------------

    def _write(self, line: str) -> None:
        if self._closed:
            raise SerialError("serial link is closed")
        with self._lock:
            self._serial.write(f"{line}\n".encode())
            self._serial.flush()

    def _read_line(self, deadline: float) -> str | None:
        while time.monotonic() < deadline:
            raw = self._serial.readline()
            if raw:
                return raw.decode(errors="replace").strip()
        return None

    def _identify(self) -> None:
        self._write("H")
        deadline = time.monotonic() + IDENTIFY_TIMEOUT
        while True:
            line = self._read_line(deadline)
            if line is None:
                self.close()
                raise SerialError(
                    "no OKROBO robot on this port (no identity within "
                    f"{IDENTIFY_TIMEOUT:.0f}s)"
                )
            if line.startswith("I "):
                self._identity = line[2:].strip()
                return
            # Boards often emit boot noise; keep looking until the deadline.

    @property
    def identity(self) -> str:
        return self._identity

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._serial.write(b"S\n")
            self._serial.flush()
        except Exception:
            pass  # closing a dead port must never raise
        try:
            self._serial.close()
        except Exception:
            pass

    # -- World interface ------------------------------------------------------

    def drive(self, left: float, right: float) -> None:
        self._write(format_drive(left, right))

    def stop(self) -> None:
        self._write("S")

    def reset(self) -> None:
        self._write("R")
        self._state = State(tick=0, pose=Pose(), distance=0.0, collided=False)

    def step(self, dt: float) -> None:
        """Let real time pass, then take the board's latest state."""
        if dt > 0:
            time.sleep(dt)
        self.refresh()

    def refresh(self, timeout: float = 0.3) -> State:
        """Ask the board for its state and update the cached copy."""
        self._write("Q")
        deadline = time.monotonic() + timeout
        while True:
            line = self._read_line(deadline)
            if line is None:
                return self._state  # keep the last good state; do not stall
            state = parse_state_line(line)
            if state is not None:
                self._state = state
                return state

    def state(self) -> State:
        return self._state

    def ray(self, offset: float) -> float:
        """Hardware has one forward sensor; off-axis rays are unavailable."""
        if abs(offset) < 1e-9:
            return self._state.distance
        return math.nan
