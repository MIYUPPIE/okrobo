"""Gate tests for the student-code worker subprocess (contracts/robot-remote/v0)."""

import json
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

WORKER = str(Path(__file__).resolve().parents[1] / "okrobo" / "worker.py")


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


def test_position_tuple():
    code = "from okrobo import Robot\nx, y = Robot().position()\nprint(x + y)\n"
    _, stdout, stderr, exit_code = run_worker(code, lambda r: {"ok": True, "result": [1.0, 0.5]})
    assert exit_code == 0, stderr
    assert "1.5" in stdout
