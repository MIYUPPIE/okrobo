"""The whole hardware path, end to end and local.

A fake studio connects to a real sidecar, tells it to connect to a fake board
on a pty, then runs real student Python. The robot calls must reach the board
over the serial protocol instead of the studio's simulator — that is the
payoff of Phase 7: one program, two backends.
"""

import asyncio
import json
from contextlib import asynccontextmanager

import pytest

websockets = pytest.importorskip("websockets")
pytest.importorskip("serial")

from okrobo.sidecar import serve  # noqa: E402

from .fake_board import FakeBoard  # noqa: E402

TIMEOUT = 20


class Studio:
    """A fake studio that fails loudly if the simulator is asked to do work."""

    def __init__(self, ws):
        self.ws = ws
        self.outputs = []
        self.done = None
        self.hardware = None
        self.simulator_requests = []

    async def send(self, message: dict) -> None:
        await self.ws.send(json.dumps(message))

    async def pump(self, until) -> None:
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), TIMEOUT))
            op = message["op"]
            if op == "output":
                self.outputs.append(message["text"])
            elif op == "hardware":
                self.hardware = message
            elif op == "ports":
                self.ports = message["ports"]
            elif op == "request":
                # With hardware connected nothing should reach the simulator.
                self.simulator_requests.append(message)
                await self.send(
                    {"op": "result", "id": message["id"], "ok": True, "result": None}
                )
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


def test_list_ports_is_answered():
    async def scenario():
        async with studio_session() as studio:
            await studio.send({"op": "list_ports"})
            await asyncio.wait_for(studio.pump(lambda op, _: op == "ports"), TIMEOUT)
            assert isinstance(studio.ports, list)

    asyncio.run(scenario())


def test_connect_reports_the_board_identity():
    async def scenario():
        with FakeBoard() as board:
            async with studio_session() as studio:
                await studio.send({"op": "connect_hardware", "port": board.port})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "hardware"), TIMEOUT)
                assert studio.hardware["connected"] is True
                assert studio.hardware["identity"] == "okrobo-car 1"

    asyncio.run(scenario())


def test_connecting_to_a_silent_port_reports_an_error():
    async def scenario():
        with FakeBoard(identify=False) as board:
            async with studio_session() as studio:
                await studio.send({"op": "connect_hardware", "port": board.port})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "hardware"), TIMEOUT)
                assert studio.hardware["connected"] is False
                assert "no OKROBO robot" in studio.hardware["error"]

    asyncio.run(scenario())


def test_student_program_drives_the_board_not_the_simulator():
    async def scenario():
        with FakeBoard() as board:
            async with studio_session() as studio:
                await studio.send({"op": "connect_hardware", "port": board.port})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "hardware"), TIMEOUT)
                assert studio.hardware["connected"] is True

                # An unmodified student program: no hardware-specific code.
                code = (
                    "from okrobo import Robot\n"
                    "robot = Robot()\n"
                    "robot.forward(0.2)\n"
                    "print('distance:', round(robot.distance(), 2))\n"
                )
                await studio.send({"op": "run", "code": code})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "done"), TIMEOUT)

                assert studio.done == 0, "".join(studio.outputs)
                # The wheels were commanded over the serial protocol...
                assert any(c.startswith("D ") for c in board.commands)
                # ...and the simulator was never asked to do anything.
                assert studio.simulator_requests == []
                assert "distance:" in "".join(studio.outputs)

    asyncio.run(scenario())


def test_disconnect_returns_control_to_the_simulator():
    async def scenario():
        with FakeBoard() as board:
            async with studio_session() as studio:
                await studio.send({"op": "connect_hardware", "port": board.port})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "hardware"), TIMEOUT)
                await studio.send({"op": "disconnect_hardware"})
                await asyncio.wait_for(
                    studio.pump(lambda op, m: op == "hardware" and not m["connected"]),
                    TIMEOUT,
                )

                code = "from okrobo import Robot\nRobot().forward(0.1)\n"
                await studio.send({"op": "run", "code": code})
                await asyncio.wait_for(studio.pump(lambda op, _: op == "done"), TIMEOUT)
                # Back on the simulator: the studio served the call again.
                assert studio.simulator_requests, "simulator never got the call back"

    asyncio.run(scenario())
