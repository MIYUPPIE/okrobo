"""Gate tests for the sidecar: a fake studio connects over a real WebSocket
and executes robot requests on the reference sim, closing the full
student-code -> worker -> sidecar -> studio loop locally."""

import asyncio
import json
from contextlib import asynccontextmanager

import pytest

websockets = pytest.importorskip(
    "websockets", reason="run: python3 -m pip install --target=.deps -r requirements.txt"
)

from okrobo import Robot  # noqa: E402
from okrobo.sidecar import serve  # noqa: E402

RUN_TIMEOUT = 20


class FakeStudio:
    """Executes sidecar robot requests against the local reference sim."""

    def __init__(self, ws):
        self.ws = ws
        self.robot = Robot()
        self.outputs = []
        self.done = None

    async def run(self, code: str) -> None:
        await self.ws.send(json.dumps({"op": "run", "code": code}))
        await self.pump()

    async def pump(self, stop_after_outputs: int | None = None) -> None:
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), RUN_TIMEOUT))
            op = message["op"]
            if op == "output":
                self.outputs.append((message["stream"], message["text"]))
                if stop_after_outputs and len(self.outputs) >= stop_after_outputs:
                    return
            elif op == "request":
                await self.ws.send(json.dumps(self.execute(message)))
            elif op == "done":
                self.done = message["exit_code"]
                return

    def execute(self, message: dict) -> dict:
        method = message["method"]
        args = message["args"]
        try:
            if method == "position":
                result = list(self.robot.position())
            else:
                result = getattr(self.robot, method)(**args)
            return {"op": "result", "id": message["id"], "ok": True, "result": result}
        except Exception as error:
            return {"op": "result", "id": message["id"], "ok": False, "error": str(error)}


@asynccontextmanager
async def studio_session():
    server = await serve(0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            yield FakeStudio(ws)
    finally:
        server.close()
        await server.wait_closed()


def test_program_drives_the_robot_and_streams_output():
    async def scenario():
        async with studio_session() as studio:
            code = (
                "from okrobo import Robot\n"
                "robot = Robot()\n"
                "robot.forward(0.25)\n"
                "print('distance:', round(robot.distance(), 3))\n"
            )
            await asyncio.wait_for(studio.run(code), RUN_TIMEOUT)
            assert studio.done == 0
            stdout = "".join(text for stream, text in studio.outputs if stream == "stdout")
            # Started 0.9 m from the wall, drove 0.25 m.
            assert "distance: 0.65" in stdout
            assert abs(studio.robot.position()[0] - 1.25) < 1e-9

    asyncio.run(scenario())


def test_program_can_import_a_deps_only_package_through_the_real_worker_subprocess():
    """Regression: start_program's own asyncio.create_subprocess_exec had no
    env= at all, so the worker subprocess only ever saw .deps if the sidecar
    process itself happened to be launched with PYTHONPATH already set --
    _deps.py's own sys.path.insert() is process-local and a subprocess never
    inherits it. Every worker capability before okrobo.vision.detect_objects
    needed nothing from .deps (find_color/Frame are dependency-free pure
    Python), so this went uncaught until a real .deps-only import
    (onnxruntime) was added. Runs the FULL production path (sidecar's own
    serve()/start_program, not test_worker.py's own lower-level harness) to
    prove the fix for real, not just in isolation."""

    async def scenario():
        async with studio_session() as studio:
            code = (
                "from okrobo.vision import object_detection_available\n"
                "print('available:', object_detection_available())\n"
            )
            await asyncio.wait_for(studio.run(code), RUN_TIMEOUT)
            stdout = "".join(text for stream, text in studio.outputs if stream == "stdout")
            stderr = "".join(text for stream, text in studio.outputs if stream == "stderr")
            assert studio.done == 0, stderr
            assert "available: True" in stdout

    asyncio.run(scenario())


def test_student_error_streams_traceback():
    async def scenario():
        async with studio_session() as studio:
            await asyncio.wait_for(studio.run("boom\n"), RUN_TIMEOUT)
            assert studio.done == 1
            stderr = "".join(text for stream, text in studio.outputs if stream == "stderr")
            assert "NameError" in stderr

    asyncio.run(scenario())


def test_stop_terminates_an_infinite_program():
    async def scenario():
        async with studio_session() as studio:
            code = "import itertools\nfor i in itertools.count():\n    print('tick', i)\n"
            await studio.ws.send(json.dumps({"op": "run", "code": code}))
            await asyncio.wait_for(studio.pump(stop_after_outputs=3), RUN_TIMEOUT)
            await studio.ws.send(json.dumps({"op": "stop"}))
            await asyncio.wait_for(studio.pump(), RUN_TIMEOUT)
            assert studio.done != 0  # killed, not a clean exit

    asyncio.run(scenario())
