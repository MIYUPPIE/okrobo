"""Make repo-local dependencies importable.

Third-party packages live in runtime/python/.deps (installed with
`pip install --target=.deps -r requirements.txt`), keeping the system Python
untouched without needing venv support. Import this module before importing
anything from .deps.
"""

import sys
from pathlib import Path

_DEPS = Path(__file__).resolve().parent.parent / ".deps"
if _DEPS.is_dir() and str(_DEPS) not in sys.path:
    sys.path.insert(0, str(_DEPS))
