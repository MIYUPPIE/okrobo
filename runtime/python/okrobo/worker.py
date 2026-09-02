"""Student-code host subprocess. See contracts/robot-remote/v1.

Run by the sidecar as: python3 -u worker.py <rpc_fd> <code_path>

The rpc fd is one end of a socketpair. Every robot call becomes one JSONL
request up the socket; the reply comes back on the same socket. Before the
student file executes, a fake `okrobo` module is installed whose Robot and Arm
proxy those calls, so an unmodified `from okrobo import Robot` (or `Arm`) file
drives whatever robot backend sits on the other side of the sidecar.

This file is executed by path (not imported as part of the package) so the
real okrobo package is never loaded here.
"""

import json
import socket
import sys
import traceback
import types


def make_rpc(sock: socket.socket):
    reader = sock.makefile("r", encoding="utf-8")
    writer = sock.makefile("w", encoding="utf-8")

    def rpc(method: str, **args):
        writer.write(json.dumps({"op": "request", "method": method, "args": args}) + "\n")
        writer.flush()
        line = reader.readline()
        if not line:
            raise RuntimeError("studio connection closed")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise RuntimeError(str(reply.get("error", "robot call failed")))
        return reply.get("result")

    return rpc


def make_okrobo_module(rpc) -> types.ModuleType:
    class Robot:
        """Remote proxy with the exact okrobo.Robot surface."""

        def forward(self, meters: float = 0.1) -> None:
            rpc("forward", meters=meters)

        def backward(self, meters: float = 0.1) -> None:
            rpc("backward", meters=meters)

        def turn_left(self, degrees: float = 90.0) -> None:
            rpc("turn_left", degrees=degrees)

        def turn_right(self, degrees: float = 90.0) -> None:
            rpc("turn_right", degrees=degrees)

        def wait(self, seconds: float = 1.0) -> None:
            rpc("wait", seconds=seconds)

        def distance(self) -> float:
            return float(rpc("distance"))

        def lidar(self, rays: int = 9, fov: float = 180.0) -> list:
            return [float(d) for d in rpc("lidar", rays=rays, fov_degrees=fov)]

        def heading(self) -> float:
            return float(rpc("heading"))

        def position(self) -> tuple:
            result = rpc("position")
            return (float(result[0]), float(result[1]))

        def stop(self) -> None:
            rpc("stop")

    class Arm:
        """Remote proxy with the exact okrobo.Arm surface."""

        def move(self, joint, degrees: float) -> None:
            rpc("arm_move", joint=joint, degrees=degrees)

        def move_all(self, degrees: list) -> None:
            rpc("arm_move_all", angles=list(degrees))

        def angles(self) -> list:
            return [float(a) for a in rpc("arm_angles")]

        def tip(self) -> tuple:
            result = rpc("arm_tip")
            return (float(result[0]), float(result[1]), float(result[2]))

        def wait(self, seconds: float = 1.0) -> None:
            rpc("wait", seconds=seconds)

        def stop(self) -> None:
            rpc("stop")

    module = types.ModuleType("okrobo")
    module.Robot = Robot
    module.Arm = Arm
    return module


def main() -> int:
    rpc_fd = int(sys.argv[1])
    code_path = sys.argv[2]
    sock = socket.socket(fileno=rpc_fd)
    rpc = make_rpc(sock)
    sys.modules["okrobo"] = make_okrobo_module(rpc)

    with open(code_path, encoding="utf-8") as f:
        source = f.read()
    try:
        exec(compile(source, "<program>", "exec"), {"__name__": "__main__"})
    except Exception as error:
        # Skip this file's exec() frame so the traceback starts in <program>.
        tb = error.__traceback__.tb_next if error.__traceback__ else None
        traceback.print_exception(type(error), error, tb)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
