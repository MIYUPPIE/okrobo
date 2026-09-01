# OKROBO

OKHUB Robotics Studio: a local robotics development environment with a browser-like interface, working completely offline. For schools where internet is unreliable or expensive.

- **[build.md](build.md)** is the master plan. Every session starts there.
- [docs/vision.md](docs/vision.md) holds the original vision notes.

## Quick start

```bash
./scripts/test-all.sh          # all gate suites
cd apps/studio && npm run dev  # studio UI shell
python3 -m okrobo.demo         # student API driving the reference sim
#   (run from runtime/python/)
```

## Layout

| Directory | What |
|---|---|
| `contracts/` | Versioned JSON schemas every side mirrors (TS, Python, C++) |
| `apps/studio/` | React + TypeScript UI |
| `engine/` | C++ simulation core (the only home of the sim math) |
| `runtime/python/` | `okrobo` student Python package |
| `packs/` | Robots, worlds, lessons |
| `scripts/` | Glue: test runner |
