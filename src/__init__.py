from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

_repo_root = Path(__file__).resolve().parent.parent
load_dotenv(_repo_root / ".env", override=False)
load_dotenv(_repo_root / ".env.local", override=False)
