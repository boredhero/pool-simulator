"""Read only the public Google client ID; never source /etc/environment as shell code."""

import os
import re
import shlex
from pathlib import Path

KEY = "POOL_MARTINOSPIZZA_DEV_OAUTH_CLIENT_ID"


def configured_client_id(environment=os.environ, path=Path("/etc/environment")):
    value = environment.get(KEY, "")
    if not value and path.exists():
        for line in path.read_text().splitlines():
            name, separator, raw = line.partition("=")
            if separator and name.strip() == KEY:
                words = shlex.split(raw, comments=True)
                if len(words) != 1:
                    raise ValueError("Invalid Google client ID configuration")
                value = words[0]
    if value and not re.fullmatch(
        r"[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com", value
    ):
        raise ValueError("Invalid Google client ID configuration")
    return value


if __name__ == "__main__":
    print(configured_client_id())
