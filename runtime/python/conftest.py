# Makes okrobo importable when running pytest from this directory, and makes
# repo-local dependencies (.deps, see requirements.txt) importable in tests.

import sys
from pathlib import Path

_deps = Path(__file__).resolve().parent / ".deps"
if _deps.is_dir() and str(_deps) not in sys.path:
    sys.path.insert(0, str(_deps))
