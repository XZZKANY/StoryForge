"""Isolated real API host for the Desktop token-stream HTTP acceptance runner.

No provider/runtime replacement: only dotenv and outbound-network isolation.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    def allow_loopback_only(event: str, args: tuple) -> None:
        if event == "socket.connect" and args[1][0] not in ("127.0.0.1", "::1"):
            raise RuntimeError("HTTP acceptance host only permits loopback connections")

    sys.addaudithook(allow_loopback_only)
    from app.common.config import StoryForgeSettings

    StoryForgeSettings.model_config["env_file"] = None
    import uvicorn

    from app.main import app

    uvicorn.run(
        app, host="127.0.0.1", port=int(os.environ["STORYFORGE_API_PORT"]),
        loop="run_windows:storyforge_loop_factory", log_level="warning",
    )


if __name__ == "__main__":
    main()
