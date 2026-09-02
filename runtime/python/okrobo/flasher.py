"""Compiles and uploads firmware/okrobo_car to a board via arduino-cli.

docs/decisions/serial-transport.md already assigns "firmware flashing" to the
sidecar, the same reasoning as port enumeration and connect: it's an OS-level
job Python's ecosystem covers and the webview's doesn't. arduino-cli itself is
kept external and optional, the same way pyserial and ROS are elsewhere in
this codebase (see the architecture rule: anything optional is imported/
invoked lazily) — it is never bundled, so a school without a board plugged in
pays nothing, and one that has arduino-cli installed gets one-click flashing
instead of the README's manual command line.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass

DEFAULT_FQBN = "esp32:esp32:esp32"
COMPILE_TIMEOUT = 180.0
UPLOAD_TIMEOUT = 120.0
INSTALL_HINT = (
    "arduino-cli not found on PATH. Install it from "
    "https://arduino.github.io/arduino-cli/latest/installation/, then run "
    "'arduino-cli core install esp32:esp32' once."
)


def is_available(which=shutil.which) -> bool:
    """Whether arduino-cli is on PATH; false, not an exception, when it isn't."""
    return which("arduino-cli") is not None


class FlashError(RuntimeError):
    """Raised with whichever arduino-cli stage failed and its combined output."""

    def __init__(self, stage: str, output: str) -> None:
        super().__init__(output)
        self.stage = stage
        self.output = output


@dataclass
class FlashResult:
    stage: str
    output: str


def _run(stage: str, args: list[str], timeout: float, run) -> FlashResult:
    try:
        result = run(args, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as error:
        raise FlashError(stage, INSTALL_HINT) from error
    except subprocess.TimeoutExpired as error:
        raise FlashError(stage, f"arduino-cli {stage} timed out after {timeout:.0f}s") from error
    output = ((result.stdout or "") + (result.stderr or "")).strip()
    if result.returncode != 0:
        raise FlashError(stage, output or f"arduino-cli {stage} failed (exit {result.returncode})")
    return FlashResult(stage=stage, output=output)


def compile_sketch(
    sketch_dir: str, fqbn: str = DEFAULT_FQBN, *, run=subprocess.run
) -> FlashResult:
    """Build the sketch. Raises FlashError (stage="compile") on any failure."""
    return _run(
        "compile",
        ["arduino-cli", "compile", "--fqbn", fqbn, str(sketch_dir)],
        COMPILE_TIMEOUT,
        run,
    )


def upload_sketch(
    sketch_dir: str, port: str, fqbn: str = DEFAULT_FQBN, *, run=subprocess.run
) -> FlashResult:
    """Upload the last compile's output to `port`. Raises FlashError (stage="upload")."""
    return _run(
        "upload",
        ["arduino-cli", "upload", "--fqbn", fqbn, "-p", port, str(sketch_dir)],
        UPLOAD_TIMEOUT,
        run,
    )
