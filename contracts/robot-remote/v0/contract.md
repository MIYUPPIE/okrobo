# Robot Remote v0

> Superseded by [v1](../v1/contract.md), which adds the arm and lidar methods.
> Everything here still holds: v1 is v0 plus methods.

The bridge that lets real local Python drive a robot backend it does not own.
Three processes, two hops:

```text
student code          sidecar                 studio (browser)
python subprocess --- okrobo/worker.py        PythonBridge.ts
  robot.forward() ->  socketpair JSONL   ->   WebSocket JSONL -> ProgramRunner -> WASM engine
```

The studio connects to `ws://127.0.0.1:8355` (sidecar default). One browser
client at a time; a new connection replaces the old one. All messages are
single-line JSON.

## Studio -> sidecar

| message | meaning |
|---|---|
| `{"op": "run", "code": "<python source>"}` | run this program in a fresh subprocess (terminating any current one) |
| `{"op": "stop"}` | terminate the running program |
| `{"op": "result", "id": n, "ok": true, "result": ...}` | reply to a robot request |
| `{"op": "result", "id": n, "ok": false, "error": "..."}` | robot request failed (e.g. user pressed Stop) |

## Sidecar -> studio

| message | meaning |
|---|---|
| `{"op": "started"}` | program subprocess launched |
| `{"op": "output", "stream": "stdout"\|"stderr", "text": "..."}` | one line of program output |
| `{"op": "request", "id": n, "method": "...", "args": {...}}` | a robot call to execute |
| `{"op": "done", "exit_code": n}` | program finished (0 = clean; negative = killed by signal) |

Robot requests are strictly sequential: the student subprocess blocks on each
call, so at most one request is outstanding. `id` is a monotonically
increasing integer for safety.

## Methods

`forward {meters}`, `backward {meters}`, `turn_left {degrees}`,
`turn_right {degrees}`, `wait {seconds}` — movement, result `null`.
`distance {}` -> number, `heading {}` -> number, `position {}` -> `[x, y]`,
`stop {}` -> `null`.

Semantics match the okrobo Python package and ProgramRunner exactly; the
worker injects a fake `okrobo` module whose `Robot` proxies these methods, so
an unmodified `from okrobo import Robot` student file runs against either the
local reference sim or the studio engine.

## Worker <-> sidecar (internal)

The subprocess inherits one end of a socketpair as an fd passed in argv.
Requests up: `{"op": "request", "method": ..., "args": {...}}`; replies down:
`{"ok": true, "result": ...}` or `{"ok": false, "error": "..."}`. stdout and
stderr are ordinary pipes, streamed line-by-line as `output` events.
