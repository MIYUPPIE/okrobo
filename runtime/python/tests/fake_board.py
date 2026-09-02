"""A fake OKROBO board on a pseudo-terminal.

Speaks contracts/robot-serial/v0 exactly as the firmware does, so the real
serial code (okrobo/serial_link.py) can be gate-tested with no hardware. The
odometry mirrors the reference model, which is what the real board integrates.
"""

from __future__ import annotations

import math
import os
import pty
import threading
import time

WHEEL_BASE = 0.12


class FakeBoard:
    """Runs a board loop on one end of a pty; hand the other end to the link."""

    def __init__(
        self,
        *,
        name: str = "okrobo-car",
        version: int = 1,
        identify: bool = True,
        boot_noise: str = "",
        distance: float = 0.9,
    ) -> None:
        self.name = name
        self.version = version
        self.identify = identify
        self.boot_noise = boot_noise
        self.distance = distance

        self.commands: list[str] = []
        self.left = 0.0
        self.right = 0.0
        self.tick = 0
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0

        self._primary, self._secondary = pty.openpty()
        self.port = os.ttyname(self._secondary)
        self._running = True
        self._buffer = b""
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    # -- board behaviour ------------------------------------------------------

    def _write(self, line: str) -> None:
        os.write(self._primary, f"{line}\n".encode())

    def _state_line(self) -> str:
        return (
            f"T {self.tick} {self.x:.3f} {self.y:.3f} {self.theta:.4f} "
            f"{self.distance:.3f} 0"
        )

    def _integrate(self, dt: float) -> None:
        v = (self.left + self.right) / 2.0
        w = (self.right - self.left) / WHEEL_BASE
        if abs(w) < 1e-9:
            self.x += v * dt * math.cos(self.theta)
            self.y += v * dt * math.sin(self.theta)
        else:
            r = v / w
            self.x += r * (math.sin(self.theta + w * dt) - math.sin(self.theta))
            self.y -= r * (math.cos(self.theta + w * dt) - math.cos(self.theta))
            self.theta += w * dt
        self.tick += 1

    def _handle(self, line: str) -> None:
        self.commands.append(line)
        parts = line.split()
        if not parts:
            return
        verb = parts[0]
        if verb == "H":
            if self.boot_noise:
                self._write(self.boot_noise)
            if self.identify:
                self._write(f"I {self.name} {self.version}")
        elif verb == "D" and len(parts) == 3:
            try:
                self.left, self.right = float(parts[1]), float(parts[2])
            except ValueError:
                self._write("E bad-command")
        elif verb == "S":
            self.left = self.right = 0.0
        elif verb == "R":
            self.left = self.right = 0.0
            self.tick = 0
            self.x = self.y = self.theta = 0.0
        elif verb == "Q":
            self._integrate(0.05)
            self._write(self._state_line())
        else:
            self._write("E bad-command")

    def _loop(self) -> None:
        while self._running:
            try:
                chunk = os.read(self._primary, 256)
            except OSError:
                return
            if not chunk:
                return
            self._buffer += chunk
            while b"\n" in self._buffer:
                raw, self._buffer = self._buffer.split(b"\n", 1)
                self._handle(raw.decode(errors="replace").strip())

    def wait_until(self, predicate, timeout: float = 2.0) -> None:
        """Wait for the board to catch up.

        Commands travel over a real pty and are handled on the board thread,
        exactly as a physical robot handles them asynchronously, so tests must
        synchronise rather than assert immediately after writing.
        """
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.005)
        raise AssertionError("board did not reach the expected state in time")

    def close(self) -> None:
        self._running = False
        for fd in (self._secondary, self._primary):
            try:
                os.close(fd)
            except OSError:
                pass
        time.sleep(0.05)

    def __enter__(self) -> "FakeBoard":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
