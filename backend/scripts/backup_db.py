"""Create a consistent SQLite backup, including committed WAL contents. Never overwrite."""

import argparse
import os
import sqlite3
from pathlib import Path

from sqlalchemy.engine import make_url


def backup(destination: Path) -> None:
    url = make_url(os.environ.get("DATABASE_URL", "sqlite:///./pool.db"))
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        raise SystemExit("This command requires a file-backed SQLite DATABASE_URL.")
    source = Path(url.database).resolve()
    if not source.is_file():
        raise SystemExit("Source database does not exist.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Reserve a private output path; don't replace an earlier backup by accident.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as src:
        with sqlite3.connect(destination) as target:
            src.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Backup integrity check failed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    backup(parser.parse_args().destination)
    print("Database backup completed and verified.")
