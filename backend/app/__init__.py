from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

_base_dir = Path(__file__).resolve().parents[2]
load_dotenv(_base_dir / ".env", override=False)
load_dotenv(_base_dir / ".env.local", override=False)
