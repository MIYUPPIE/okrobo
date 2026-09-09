"""Gate tests for the student-code worker subprocess (contracts/robot-remote/v0)."""

import json
import os
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

WORKER = str(Path(__file__).resolve().parents[1] / "okrobo" / "worker.py")

# Mirrors conftest.py's own .deps discovery -- that file only patches the
# CURRENT process's sys.path, which a subprocess.Popen child never inherits
# (only real environment variables do). Every worker test before
# test_student_code_can_import_object_detection happened to need nothing
# from .deps (find_color/Frame are dependency-free pure Python, the whole
# point of find_color's own design) -- detect_objects is the first one that
# does, and it surfaced this for real: a bare `python3 -m pytest` run (no
# PYTHONPATH already set in the invoking shell, e.g. scripts/test-all.sh's
# own invocation) left the worker subprocess unable to `import onnxruntime`
# even though the parent test process could see it fine via conftest.py.
_DEPS = Path(__file__).resolve().parents[1] / ".deps"


def _worker_env() -> dict:
    env = dict(os.environ)
    if _DEPS.is_dir():
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{_DEPS}{os.pathsep}{existing}" if existing else str(_DEPS)
    return env


def run_worker(code: str, answer):
    """Run code in a real worker subprocess, answering robot RPCs with `answer`.

    Returns (requests, stdout, stderr, exit_code).
    """
    parent, child = socket.socketpair()
    child.set_inheritable(True)
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code)
        path = f.name

    proc = subprocess.Popen(
        [sys.executable, "-u", WORKER, str(child.fileno()), path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        pass_fds=(child.fileno(),),
        close_fds=True,
        env=_worker_env(),
    )
    child.close()

    requests = []
    reader = parent.makefile("r", encoding="utf-8")
    writer = parent.makefile("w", encoding="utf-8")
    while True:
        line = reader.readline()
        if not line:
            break
        request = json.loads(line)
        requests.append(request)
        writer.write(json.dumps(answer(request)) + "\n")
        writer.flush()

    stdout, stderr = proc.communicate(timeout=10)
    parent.close()
    Path(path).unlink(missing_ok=True)
    return requests, stdout.decode(), stderr.decode(), proc.returncode


def test_robot_calls_become_rpc_requests():
    code = "from okrobo import Robot\nrobot = Robot()\nrobot.forward(0.25)\nrobot.turn_left(45)\n"
    requests, _, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert [r["method"] for r in requests] == ["forward", "turn_left"]
    assert requests[0]["args"] == {"meters": 0.25}
    assert requests[1]["args"] == {"degrees": 45}


def test_results_flow_back_and_print_works():
    code = 'from okrobo import Robot\nrobot = Robot()\nprint("d =", robot.distance())\n'
    requests, stdout, _, exit_code = run_worker(code, lambda r: {"ok": True, "result": 0.65})
    assert exit_code == 0
    assert requests[0]["method"] == "distance"
    assert "d = 0.65" in stdout


def test_failed_rpc_raises_in_student_code():
    code = "from okrobo import Robot\nRobot().forward()\nprint('unreachable')\n"
    requests, stdout, stderr, exit_code = run_worker(
        code, lambda r: {"ok": False, "error": "program stopped"}
    )
    assert exit_code == 1
    assert "unreachable" not in stdout
    assert "program stopped" in stderr


def test_student_error_gives_clean_traceback():
    code = "x = 1 / 0\n"
    _, _, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 1
    assert "ZeroDivisionError" in stderr
    assert '"<program>"' in stderr
    assert "worker.py" not in stderr


def test_arm_calls_become_rpc_requests():
    code = (
        "from okrobo import Arm\n"
        "arm = Arm()\n"
        "arm.move('shoulder', 80)\n"
        "arm.move_all([0, 90, 0, 0])\n"
    )
    requests, _, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert [r["method"] for r in requests] == ["arm_move", "arm_move_all"]
    assert requests[0]["args"] == {"joint": "shoulder", "degrees": 80}
    assert requests[1]["args"] == {"angles": [0, 90, 0, 0]}


def test_arm_readbacks():
    code = "from okrobo import Arm\narm = Arm()\nprint(arm.tip()[2], arm.angles()[1])\n"
    answers = {"arm_tip": [0.4, 0.0, 0.55], "arm_angles": [0.0, 60.0, -30.0, -30.0]}
    _, stdout, stderr, exit_code = run_worker(
        code, lambda r: {"ok": True, "result": answers[r["method"]]}
    )
    assert exit_code == 0, stderr
    assert "0.55 60.0" in stdout


def test_lidar_returns_floats():
    code = "from okrobo import Robot\nprint(sum(Robot().lidar(rays=3)))\n"
    requests, stdout, stderr, exit_code = run_worker(
        code, lambda r: {"ok": True, "result": [0.5, 1.0, 0.5]}
    )
    assert exit_code == 0, stderr
    assert requests[0]["args"] == {"rays": 3, "fov_degrees": 180.0}
    assert "2.0" in stdout


def test_built_robot_set_becomes_rpc_request():
    code = "from okrobo import BuiltRobot\nrobot = BuiltRobot()\nrobot.set('shoulder', 1.5)\n"
    requests, _, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert requests[0]["method"] == "built_set"
    assert requests[0]["args"] == {"actuator_id": "shoulder", "value": 1.5}


def test_built_robot_read_returns_list():
    code = "from okrobo import BuiltRobot\nrobot = BuiltRobot()\nprint(robot.read('touch')[0])\n"
    requests, stdout, stderr, exit_code = run_worker(
        code, lambda r: {"ok": True, "result": [1.0]}
    )
    assert exit_code == 0, stderr
    assert requests[0]["method"] == "built_read"
    assert requests[0]["args"] == {"sensor_id": "touch"}
    assert "1.0" in stdout


def test_built_robot_wait_and_stop_reuse_generic_rpc_names():
    code = "from okrobo import BuiltRobot\nrobot = BuiltRobot()\nrobot.wait(0.5)\nrobot.stop()\n"
    requests, _, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert [r["method"] for r in requests] == ["wait", "stop"]
    assert requests[0]["args"] == {"seconds": 0.5}


def test_student_code_can_import_okrobo_submodules():
    """The injected okrobo must be a real package.

    Without __path__ the stand-in is a plain module and every
    `from okrobo.vision import ...` in a lesson fails at import time.
    """
    code = (
        "from okrobo import Robot\n"
        "from okrobo.vision import find_color, COLORS\n"
        "from okrobo.camera import Frame\n"
        "print('colors:', len(COLORS))\n"
        "frame = Frame(width=1, height=1, pixels=bytes([220, 40, 40]))\n"
        "print('found:', find_color(frame, 'red') is not None)\n"
    )
    _, stdout, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert "colors: 4" in stdout
    assert "found: True" in stdout


def test_student_code_can_import_object_detection():
    """detect_objects/load_image live in the same okrobo.vision submodule as
    find_color -- proves a Vision Lab lesson works through the real
    worker/RPC boundary too. Needs no RPC call at all (unlike find_color,
    which needs robot.camera()'s own frame) -- see vision.py's own header on
    why detect_objects() is deliberately standalone, not wired to the
    robot's camera."""
    code = (
        "from okrobo.vision import detect_objects, object_detection_available\n"
        "from okrobo.camera import Frame\n"
        "print('available:', object_detection_available())\n"
        "frame = Frame(width=4, height=4, pixels=bytes([120, 120, 120] * 16))\n"
        "results = detect_objects(frame)\n"
        "print('ran ok:', isinstance(results, list))\n"
    )
    _, stdout, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert "available: True" in stdout
    assert "ran ok: True" in stdout


def test_camera_frames_cross_the_rpc_boundary():
    code = (
        "from okrobo import Robot\n"
        "frame = Robot().camera(2, 2)\n"
        "print('size:', frame.width, frame.height, len(frame.pixels))\n"
        "print('pixel:', frame.pixel(0, 0))\n"
    )
    pixels = [10, 20, 30] * 4
    requests, stdout, stderr, exit_code = run_worker(
        code, lambda r: {"ok": True, "result": {"width": 2, "height": 2, "pixels": pixels}}
    )
    assert exit_code == 0, stderr
    assert requests[0]["method"] == "camera"
    assert requests[0]["args"] == {"width": 2, "height": 2}
    assert "size: 2 2 12" in stdout
    assert "pixel: (10, 20, 30)" in stdout


def test_drone_calls_become_rpc_requests():
    code = (
        "from okrobo import Drone\n"
        "drone = Drone()\n"
        "drone.takeoff()\n"
        "drone.forward(0.3)\n"
        "drone.turn_right(45)\n"
        "drone.land()\n"
    )
    requests, _, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": None})
    assert exit_code == 0, stderr
    assert [r["method"] for r in requests] == [
        "drone_takeoff",
        "drone_forward",
        "drone_turn_right",
        "drone_land",
    ]
    assert requests[0]["args"] == {"height": 0.4}
    assert requests[1]["args"] == {"meters": 0.3}
    assert requests[2]["args"] == {"degrees": 45}
    assert requests[3]["args"] == {}


def test_drone_readbacks():
    code = (
        "from okrobo import Drone\n"
        "drone = Drone()\n"
        "print(drone.altitude(), drone.heading(), drone.position())\n"
    )
    answers = {"drone_altitude": 0.4, "drone_heading": -90.0, "drone_position": [1.3, 0.7, 0.4]}
    _, stdout, stderr, exit_code = run_worker(
        code, lambda r: {"ok": True, "result": answers[r["method"]]}
    )
    assert exit_code == 0, stderr
    assert "0.4 -90.0 (1.3, 0.7, 0.4)" in stdout


def test_position_tuple():
    code = "from okrobo import Robot\nx, y = Robot().position()\nprint(x + y)\n"
    _, stdout, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": [1.0, 0.5]})
    assert exit_code == 0, stderr
    assert "1.5" in stdout
