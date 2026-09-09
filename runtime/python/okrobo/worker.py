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
import os
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

        def camera(self, width: int = 64, height: int = 48):
            """Rebuild a real Frame from the pixels the backend sends, so
            okrobo.vision works identically here and on the local sim."""
            from okrobo.camera import Frame

            result = rpc("camera", width=width, height=height)
            return Frame(
                width=int(result["width"]),
                height=int(result["height"]),
                pixels=bytes(result["pixels"]),
            )

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

        def grip(self) -> bool:
            return bool(rpc("arm_grip"))

        def release(self) -> None:
            rpc("arm_release")

        def holding(self) -> bool:
            return bool(rpc("arm_holding"))

        def object_position(self) -> tuple:
            result = rpc("arm_object")
            return (float(result[0]), float(result[1]), float(result[2]))

        def wait(self, seconds: float = 1.0) -> None:
            rpc("wait", seconds=seconds)

        def stop(self) -> None:
            rpc("stop")

    class Drone:
        """Remote proxy with the exact okrobo.Drone surface."""

        HOVER_HEIGHT = 0.4

        def takeoff(self, height: float = HOVER_HEIGHT) -> None:
            rpc("drone_takeoff", height=height)

        def land(self) -> None:
            rpc("drone_land")

        def forward(self, meters: float = 0.1) -> None:
            rpc("drone_forward", meters=meters)

        def backward(self, meters: float = 0.1) -> None:
            rpc("drone_backward", meters=meters)

        def up(self, meters: float = 0.1) -> None:
            rpc("drone_up", meters=meters)

        def down(self, meters: float = 0.1) -> None:
            rpc("drone_down", meters=meters)

        def turn_left(self, degrees: float = 90.0) -> None:
            rpc("drone_turn_left", degrees=degrees)

        def turn_right(self, degrees: float = 90.0) -> None:
            rpc("drone_turn_right", degrees=degrees)

        def altitude(self) -> float:
            return float(rpc("drone_altitude"))

        def distance(self) -> float:
            return float(rpc("drone_distance"))

        def heading(self) -> float:
            return float(rpc("drone_heading"))

        def position(self) -> tuple:
            result = rpc("drone_position")
            return (float(result[0]), float(result[1]), float(result[2]))

        def wait(self, seconds: float = 1.0) -> None:
            rpc("wait", seconds=seconds)

        def stop(self) -> None:
            rpc("stop")

    class BuiltRobot:
        """Remote proxy for a Robot Builder document (contracts/robot-def/v0).

        Unlike Robot/Arm/Drone, there is no local/offline implementation of
        this class anywhere in the okrobo package: a built robot's shape is
        arbitrary and per-student, with no fixed physics to mirror, so it
        only ever exists as this remote proxy and can never run standalone
        outside the studio.
        """

        def set(self, actuator_id: str, value: float) -> None:
            rpc("built_set", actuator_id=actuator_id, value=value)

        def read(self, sensor_id: str) -> list:
            return [float(v) for v in rpc("built_read", sensor_id=sensor_id)]

        def wait(self, seconds: float = 1.0) -> None:
            rpc("wait", seconds=seconds)

        def stop(self) -> None:
            rpc("stop")

    module = types.ModuleType("okrobo")
    module.Robot = Robot
    module.Arm = Arm
    module.Drone = Drone
    module.BuiltRobot = BuiltRobot
    # Make the stand-in a real package pointing at the installed okrobo
    # directory, so `from okrobo.vision import find_color` and friends load the
    # genuine submodules while `okrobo.Robot` stays the remote proxy. Without
    # __path__ the module is not a package and every submodule import fails.
    module.__path__ = [os.path.dirname(os.path.abspath(__file__))]
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
