# Decision: serial transport for hardware robots

**Date:** 2026-09-02 (Phase 7 start, per the open-decisions rule in build.md)

## Choice

**Serial goes through the Python sidecar** (pyserial), not Web Serial in the
webview.

## Why

- **Web Serial does not exist in our webview.** The desktop app renders in
  WebKitGTK (2.52 on this machine); Web Serial is a Chromium-only API. Building
  on it would mean the feature works in a Chrome dev tab and is missing in the
  actual product — the worst possible split.
- **The sidecar already owns the boundary.** It speaks
  `contracts/robot-remote/v1` and runs the student's Python. Adding a serial
  backend there means the same unmodified program drives the simulator or the
  physical robot: only the backend changes.
- **Hardware belongs with the local runtime.** Port enumeration, reconnect,
  and firmware flashing are OS-level jobs. Python has mature tooling
  (pyserial); the webview has none.
- **No new permission surface.** Web Serial would add a browser permission
  prompt per session; the sidecar already runs locally with the user's rights.

## Cost accepted

Students must have the sidecar running to use hardware. In the desktop app
that is automatic (the shell spawns it), so the cost lands only on the
browser-only dev mode, where hardware is not the point.

## Shape

```text
student python ─ worker ─ sidecar ─┬─ studio websocket ─ WASM engine   (simulator)
                                   └─ pyserial ─ USB ─ ESP32/Arduino   (hardware)
```

The link protocol is `contracts/robot-serial/v0`: a compact line format the
microcontroller can parse in a few hundred bytes of RAM. The firmware's parser
and formatter live in `firmware/okrobo_car/protocol.hpp` and are gate-tested
with ctest on this machine, so the code that ships to the board is tested
without needing a board.
