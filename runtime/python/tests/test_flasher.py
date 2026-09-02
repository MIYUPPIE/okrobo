"""okrobo.flasher: the arduino-cli wrapper the sidecar uses to flash a board.

No real arduino-cli involved — `run` is injected everywhere, the same
`open_port`-injection pattern test_serial_link.py uses for pyserial, so these
gate tests are fast, free, and need nothing installed.
"""

from __future__ import annotations

import subprocess

import pytest

from okrobo import flasher


class FakeRun:
    """Records every invocation and returns a scripted CompletedProcess."""

    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.calls: list[list[str]] = []

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        return subprocess.CompletedProcess(args, self.returncode, self.stdout, self.stderr)


def test_is_available_reflects_which():
    assert flasher.is_available(which=lambda name: "/usr/bin/arduino-cli") is True
    assert flasher.is_available(which=lambda name: None) is False


def test_compile_runs_arduino_cli_with_the_expected_args():
    run = FakeRun(stdout="Sketch uses 123 bytes")
    result = flasher.compile_sketch("firmware/okrobo_car", run=run)
    assert result.stage == "compile"
    assert result.output == "Sketch uses 123 bytes"
    assert run.calls == [
        ["arduino-cli", "compile", "--fqbn", flasher.DEFAULT_FQBN, "firmware/okrobo_car"]
    ]


def test_compile_honours_a_custom_fqbn():
    run = FakeRun()
    flasher.compile_sketch("firmware/okrobo_car", "arduino:avr:uno", run=run)
    assert run.calls[0] == [
        "arduino-cli", "compile", "--fqbn", "arduino:avr:uno", "firmware/okrobo_car"
    ]


def test_compile_raises_flash_error_on_nonzero_exit():
    run = FakeRun(returncode=1, stderr="Platform 'esp32:esp32' not found")
    with pytest.raises(flasher.FlashError) as excinfo:
        flasher.compile_sketch("firmware/okrobo_car", run=run)
    assert excinfo.value.stage == "compile"
    assert "not found" in excinfo.value.output


def test_upload_runs_arduino_cli_with_the_expected_args():
    run = FakeRun(stdout="Upload complete")
    result = flasher.upload_sketch("firmware/okrobo_car", "/dev/ttyUSB0", run=run)
    assert result.stage == "upload"
    assert run.calls == [
        [
            "arduino-cli",
            "upload",
            "--fqbn",
            flasher.DEFAULT_FQBN,
            "-p",
            "/dev/ttyUSB0",
            "firmware/okrobo_car",
        ]
    ]


def test_upload_raises_flash_error_on_nonzero_exit():
    run = FakeRun(returncode=1, stderr="no device found on /dev/ttyUSB0")
    with pytest.raises(flasher.FlashError) as excinfo:
        flasher.upload_sketch("firmware/okrobo_car", "/dev/ttyUSB0", run=run)
    assert excinfo.value.stage == "upload"
    assert "no device found" in excinfo.value.output


def test_missing_arduino_cli_binary_reports_the_install_hint():
    def run(args, **kwargs):
        raise FileNotFoundError("arduino-cli")

    with pytest.raises(flasher.FlashError) as excinfo:
        flasher.compile_sketch("firmware/okrobo_car", run=run)
    assert excinfo.value.stage == "compile"
    assert "arduino-cli not found" in excinfo.value.output
    assert "arduino.github.io" in excinfo.value.output


def test_a_hanging_arduino_cli_times_out_with_a_clear_message():
    def run(args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args, timeout=kwargs["timeout"])

    with pytest.raises(flasher.FlashError) as excinfo:
        flasher.upload_sketch("firmware/okrobo_car", "/dev/ttyUSB0", run=run)
    assert excinfo.value.stage == "upload"
    assert "timed out" in excinfo.value.output
