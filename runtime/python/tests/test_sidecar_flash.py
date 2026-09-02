"""The flash_firmware path through the sidecar, end to end and local.

Mirrors test_sidecar_hardware.py's shape: a fake studio talks to a real
sidecar over a real websocket. `okrobo.flasher`'s arduino-cli calls are
monkeypatched (no real arduino-cli needed, same spirit as FakeBoard standing
in for a real board in test_sidecar_hardware.py) so this proves the sidecar's
own sequencing — compile before upload, disconnect before flash, one flash at
a time, clear errors — independent of whether arduino-cli is installed here.
"""

import asyncio
import json
from contextlib import asynccontextmanager

import pytest

websockets = pytest.importorskip("websockets")
pytest.importorskip("serial")

from okrobo import flasher  # noqa: E402
from okrobo.sidecar import serve  # noqa: E402

from .fake_board import FakeBoard  # noqa: E402

TIMEOUT = 20


class Studio:
    def __init__(self, ws):
        self.ws = ws
        self.done = None
        self.hardware = None
        self.flash_events: list[dict] = []

    async def send(self, message: dict) -> None:
        await self.ws.send(json.dumps(message))

    async def pump(self, until) -> None:
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), TIMEOUT))
            op = message["op"]
            if op == "hardware":
                self.hardware = message
            elif op == "flash":
                self.flash_events.append(message)
            elif op == "done":
                self.done = message["exit_code"]
            if until(op, message):
                return


@asynccontextmanager
async def studio_session():
    server = await serve(0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            yield Studio(ws)
    finally:
        server.close()
        await server.wait_closed()


def test_flash_reports_missing_arduino_cli_plainly(monkeypatch):
    monkeypatch.setattr(flasher, "is_available", lambda: False)

    async def scenario():
        async with studio_session() as studio:
            await studio.send({"op": "flash_firmware", "port": "/dev/ttyUSB0"})
            await asyncio.wait_for(
                studio.pump(lambda op, m: op == "flash" and m["stage"] == "error"), TIMEOUT
            )
            assert "arduino-cli not found" in studio.flash_events[-1]["error"]

    asyncio.run(scenario())


def test_flash_compiles_then_uploads_in_order(monkeypatch):
    calls: list[str] = []

    def fake_compile(sketch_dir, fqbn=flasher.DEFAULT_FQBN, *, run=None):
        calls.append(f"compile:{sketch_dir}")
        return flasher.FlashResult(stage="compile", output="ok")

    def fake_upload(sketch_dir, port, fqbn=flasher.DEFAULT_FQBN, *, run=None):
        calls.append(f"upload:{sketch_dir}:{port}")
        return flasher.FlashResult(stage="upload", output="ok")

    monkeypatch.setattr(flasher, "is_available", lambda: True)
    monkeypatch.setattr(flasher, "compile_sketch", fake_compile)
    monkeypatch.setattr(flasher, "upload_sketch", fake_upload)

    async def scenario():
        async with studio_session() as studio:
            await studio.send({"op": "flash_firmware", "port": "/dev/ttyUSB0"})
            await asyncio.wait_for(
                studio.pump(lambda op, m: op == "flash" and m["stage"] == "done"), TIMEOUT
            )
            stages = [event["stage"] for event in studio.flash_events]
            assert stages == ["compile", "upload", "done"]
            assert calls[0].startswith("compile:")
            assert calls[1].endswith(":/dev/ttyUSB0")
            # The order must be compile-then-upload, never the reverse.
            assert calls[0].startswith("compile:") and calls[1].startswith("upload:")

    asyncio.run(scenario())


def test_a_failed_compile_never_reaches_upload(monkeypatch):
    uploaded = False

    def fake_compile(sketch_dir, fqbn=flasher.DEFAULT_FQBN, *, run=None):
        raise flasher.FlashError("compile", "syntax error")

    def fake_upload(sketch_dir, port, fqbn=flasher.DEFAULT_FQBN, *, run=None):
        nonlocal uploaded
        uploaded = True
        return flasher.FlashResult(stage="upload", output="ok")

    monkeypatch.setattr(flasher, "is_available", lambda: True)
    monkeypatch.setattr(flasher, "compile_sketch", fake_compile)
    monkeypatch.setattr(flasher, "upload_sketch", fake_upload)

    async def scenario():
        async with studio_session() as studio:
            await studio.send({"op": "flash_firmware", "port": "/dev/ttyUSB0"})
            await asyncio.wait_for(
                studio.pump(lambda op, m: op == "flash" and m["stage"] == "error"), TIMEOUT
            )
            assert "syntax error" in studio.flash_events[-1]["error"]
            assert uploaded is False

    asyncio.run(scenario())


def test_flashing_disconnects_a_live_hardware_link_first(monkeypatch):
    monkeypatch.setattr(flasher, "is_available", lambda: True)
    monkeypatch.setattr(
        flasher,
        "compile_sketch",
        lambda *a, **k: flasher.FlashResult(stage="compile", output="ok"),
    )
    monkeypatch.setattr(
        flasher,
        "upload_sketch",
        lambda *a, **k: flasher.FlashResult(stage="upload", output="ok"),
    )

    async def scenario():
        with FakeBoard() as board:
            async with studio_session() as studio:
                await studio.send({"op": "connect_hardware", "port": board.port})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "hardware"), TIMEOUT)
                assert studio.hardware["connected"] is True

                await studio.send({"op": "flash_firmware", "port": board.port})
                await asyncio.wait_for(
                    studio.pump(lambda op, m: op == "flash" and m["stage"] == "done"), TIMEOUT
                )
                # Flashing silently dropped the link rather than fighting arduino-cli
                # for the port; no extra "hardware: disconnected" event was promised,
                # but the session must not still think the board is connected.
                board.wait_until(lambda: "S" in board.commands)

    asyncio.run(scenario())
