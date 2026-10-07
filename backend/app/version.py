"""Single source of truth: repo-root info.yml version."""

from functools import lru_cache
from pathlib import Path

import yaml


@lru_cache
def get_info() -> dict[str, str]:
    p = Path(__file__).resolve().parents[3] / "info.yml"
    if not p.exists():  # Docker layout fallback (/srv/info.yml)
        alt = Path("/srv/info.yml")
        p = alt if alt.exists() else p
    try:
        data = yaml.safe_load(p.read_text()) or {}
    except Exception:
        data = {}
    return {
        "name": str(data.get("name", "pool-simulator")),
        "version": str(data.get("version", "0.0.0")),
    }
