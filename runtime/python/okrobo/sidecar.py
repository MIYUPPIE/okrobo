"""The OKROBO Python sidecar. See contracts/robot-remote/v1.

    python3 -m okrobo.sidecar [--port 8355]

Serves a WebSocket endpoint the studio connects to. On {"op": "run"} it
launches the student's program in a killable subprocess (worker.py) and relays
robot calls up to the studio and output/completion events back down.
"""

from __future__ import annotations

from . import _deps  # noqa: F401  (adds .deps to sys.path before websockets import)

import argparse
import asyncio
import json
import math
import os
import socket
import sys
import tempfile
from pathlib import Path

import websockets


def serial_ports() -> list:
    """Ports that might hold a robot; empty when pyserial is unavailable."""
    try:
        from .serial_link import list_ports

        return list_ports()
    except Exception:
        return []

WORKER_PATH = str(Path(__file__).resolve().parent / "worker.py")
DEFAULT_PORT = 8355


class Session:
    """One connected studio and at most one running program."""

    def __init__(self, ws) -> None:
        self.ws = ws
        self.process: asyncio.subprocess.Process | None = None
        self.rpc_writer: asyncio.StreamWriter | None = None
        self.pending_result: asyncio.Future | None = None
        self.next_id = 0
        self.tasks: list[asyncio.Task] = []
        self.code_path: str | None = None
        # When a physical robot is connected, robot calls go to it instead of
        # the studio's simulator (contracts/robot-serial/v0).
        self.hardware = None
        self.hardware_port: str | None = None

    async def send(self, message: dict) -> None:
        try:
            await self.ws.send(json.dumps(message))
        except websockets.ConnectionClosed:
            pass

    async def handle_message(self, message: dict) -> None:
        op = message.get("op")
        if op == "run":
            await self.stop_program()
            await self.start_program(str(message.get("code", "")))
        elif op == "stop":
            await self.stop_program()
        elif op == "result":
            if self.pending_result and not self.pending_result.done():
                self.pending_result.set_result(message)
        elif op == "list_ports":
            await self.send({"op": "ports", "ports": serial_ports()})
        elif op == "connect_hardware":
            await self.connect_hardware(str(message.get("port", "")))
        elif op == "disconnect_hardware":
            await self.disconnect_hardware()

    # -- hardware -------------------------------------------------------------

    async def connect_hardware(self, port: str) -> None:
        await self.disconnect_hardware(notify=False)
        try:
            from .serial_link import SerialRobot

            # Opening a port blocks; keep the event loop responsive.
            robot = await asyncio.to_thread(SerialRobot, port)
        except Exception as error:
            await self.send({"op": "hardware", "connected": False, "error": str(error)})
            return
        self.hardware = robot
        self.hardware_port = port
        await self.send(
            {
                "op": "hardware",
                "connected": True,
                "port": port,
                "identity": robot.identity,
            }
        )

    async def disconnect_hardware(self, notify: bool = True) -> None:
        robot = self.hardware
        self.hardware = None
        self.hardware_port = None
        if robot is not None:
            await asyncio.to_thread(robot.close)
        if notify:
            await self.send({"op": "hardware", "connected": False})

    async def call_hardware(self, method: str, args: dict):
        """Run one robot call against the physical robot (contract v1 names)."""
        from .robot import Robot

        robot = Robot(world=self.hardware)
        if method in ("forward", "backward", "turn_left", "turn_right", "wait"):
            await asyncio.to_thread(getattr(robot, method), *args.values())
            return None
        if method == "distance":
            return await asyncio.to_thread(lambda: self.hardware.refresh().distance)
        if method == "heading":
            return await asyncio.to_thread(
                lambda: math.degrees(self.hardware.refresh().pose.theta)
            )
        if method == "position":
            def read_position():
                pose = self.hardware.refresh().pose
                return [pose.x, pose.y]

            return await asyncio.to_thread(read_position)
        if method == "stop":
            await asyncio.to_thread(self.hardware.stop)
            return None
        raise ValueError(f"{method} is not available on hardware")

    async def start_program(self, code: str) -> None:
        parent_sock, child_sock = socket.socketpair()
        child_sock.set_inheritable(True)
        fd, self.code_path = tempfile.mkstemp(suffix=".py", prefix="okrobo_program_")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(code)

        self.process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-u",
            WORKER_PATH,
            str(child_sock.fileno()),
            self.code_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            pass_fds=(child_sock.fileno(),),
            # Student code gets its own neutral cwd, not the sidecar's.
            cwd=tempfile.gettempdir(),
        )
        child_sock.close()
        rpc_reader, self.rpc_writer = await asyncio.open_connection(sock=parent_sock)
        await self.send({"op": "started"})

        self.tasks = [
            asyncio.ensure_future(self.pump_output(self.process.stdout, "stdout")),
            asyncio.ensure_future(self.pump_output(self.process.stderr, "stderr")),
            asyncio.ensure_future(self.pump_rpc(rpc_reader)),
            asyncio.ensure_future(self.wait_done(self.process)),
        ]

    async def pump_output(self, stream: asyncio.StreamReader, name: str) -> None:
        while True:
            try:
                line = await stream.readline()
            except (ConnectionResetError, asyncio.IncompleteReadError):
                return
            if not line:
                return
            await self.send({"op": "output", "stream": name, "text": line.decode(errors="replace")})

    async def pump_rpc(self, reader: asyncio.StreamReader) -> None:
        while True:
            try:
                line = await reader.readline()
            except (ConnectionResetError, asyncio.IncompleteReadError):
                return
            if not line:
                return
            request = json.loads(line)
            self.next_id += 1
            request_id = self.next_id

            if self.hardware is not None:
                # A physical robot is connected: serve the call here instead of
                # asking the studio's simulator. The student's code is
                # identical either way.
                try:
                    result = await self.call_hardware(
                        request["method"], request.get("args", {})
                    )
                    reply = {"ok": True, "result": result}
                except Exception as error:
                    reply = {"ok": False, "error": str(error)}
            else:
                self.pending_result = asyncio.get_event_loop().create_future()
                await self.send(
                    {
                        "op": "request",
                        "id": request_id,
                        "method": request["method"],
                        "args": request.get("args", {}),
                    }
                )
                reply = await self.pending_result
            if self.rpc_writer is None:
                return
            self.rpc_writer.write(
                (
                    json.dumps(
                        {
                            "ok": bool(reply.get("ok")),
                            "result": reply.get("result"),
                            "error": reply.get("error"),
                        }
                    )
                    + "\n"
                ).encode()
            )
            await self.rpc_writer.drain()

    async def wait_done(self, process: asyncio.subprocess.Process) -> None:
        exit_code = await process.wait()
        if self.process is process:
            self.cleanup()
            await self.send({"op": "done", "exit_code": exit_code})

    async def stop_program(self) -> None:
        process = self.process
        if process is None:
            return
        self.process = None
        if self.pending_result and not self.pending_result.done():
            self.pending_result.set_result({"ok": False, "error": "program stopped"})
        try:
            process.terminate()
        except ProcessLookupError:
            pass
        try:
            exit_code = await asyncio.wait_for(process.wait(), timeout=2)
        except asyncio.TimeoutError:
            process.kill()
            exit_code = await process.wait()
        self.cleanup()
        await self.send({"op": "done", "exit_code": exit_code})

    def cleanup(self) -> None:
        self.process = None
        current = asyncio.current_task()
        for task in self.tasks:
            if task is not current and not task.done():
                task.cancel()
        self.tasks = []
        if self.rpc_writer is not None:
            self.rpc_writer.close()
            self.rpc_writer = None
        if self.code_path:
            try:
                os.unlink(self.code_path)
            except OSError:
                pass
            self.code_path = None


async def handler(ws) -> None:
    session = Session(ws)
    print(f"studio connected: {ws.remote_address}", flush=True)
    try:
        async for raw in ws:
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            await session.handle_message(message)
    finally:
        await session.stop_program()
        await session.disconnect_hardware(notify=False)
        print("studio disconnected", flush=True)


async def serve(port: int):
    return await websockets.serve(handler, "127.0.0.1", port)


async def main_async(port: int) -> None:
    server = await serve(port)
    actual = server.sockets[0].getsockname()[1]
    print(f"okrobo sidecar listening on ws://127.0.0.1:{actual}", flush=True)
    await asyncio.Future()


def main() -> None:
    parser = argparse.ArgumentParser(description="OKROBO Python sidecar")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    try:
        asyncio.run(main_async(args.port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
