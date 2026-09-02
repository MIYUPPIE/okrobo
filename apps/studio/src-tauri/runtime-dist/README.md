# runtime-dist

Holds the bundled standalone CPython for packaged builds. Populate with:

```bash
../../../scripts/fetch-python-runtime.sh
```

It downloads python-build-standalone into `cpython/` here (gitignored). When
present, installed apps run students' Python fully offline with no system
Python needed; when absent, the packaged app falls back to system `python3`
(see `src/sidecar.rs`).
