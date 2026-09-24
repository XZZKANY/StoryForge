"""Invoked by the Rust native test, using only a disposable Rust-created config."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

from app.common import config
from app.common.llm_config_file import LlmConfigError
from app.common.llm_env import PolishLlmNotConfiguredError, resolve_polish_llm, resolved_llm_env


def main() -> None:
    # Never consult developer .env settings or provider secrets.
    config.get_settings = lambda: SimpleNamespace()
    for name in list(os.environ):
        if name.startswith(("STORYFORGE_LLM_", "STORYFORGE_POLISH_LLM_")):
            del os.environ[name]
    path = Path(sys.argv[1])
    os.environ.update(
        STORYFORGE_LLM_CONFIG_FILE=str(path),
        STORYFORGE_LLM_CONFIG_MODE="desktop-managed-v2",
        STORYFORGE_LLM_API_KEY="stale-test-key",
    )
    data = json.loads(path.read_text(encoding="utf-8"))
    assert "test-sentinel" not in path.read_text(encoding="utf-8")
    assert resolved_llm_env()["STORYFORGE_LLM_API_KEY"] == "main-test-sentinel"
    assert resolve_polish_llm().source["STORYFORGE_LLM_API_KEY"] == "polish-test-sentinel"
    assert "test-sentinel" not in repr(resolve_polish_llm())

    # A later read in the same backend sees changes without restart or a cached key.
    data["apiKey"] = data["polish"]["apiKey"]
    path.write_text(json.dumps(data), encoding="utf-8")
    assert resolved_llm_env()["STORYFORGE_LLM_API_KEY"] == "polish-test-sentinel"
    data["apiKey"] = None
    path.write_text(json.dumps(data), encoding="utf-8")
    assert resolved_llm_env()["STORYFORGE_LLM_API_KEY"] == ""
    assert resolve_polish_llm().source["STORYFORGE_LLM_API_KEY"] == "polish-test-sentinel"
    data["polish"]["apiKey"] = None
    path.write_text(json.dumps(data), encoding="utf-8")
    try:
        resolve_polish_llm()
    except PolishLlmNotConfiguredError:
        pass
    else:
        raise AssertionError("cleared polish key revived")
    data["apiKey"] = {"scheme": "windows-dpapi-user-v1", "ciphertext": "AAAA"}
    path.write_text(json.dumps(data), encoding="utf-8")
    try:
        resolved_llm_env()
    except LlmConfigError:
        pass
    else:
        raise AssertionError("invalid DPAPI blob did not fail closed")
    print("DPAPI_INTEROP_OK")


if __name__ == "__main__":
    main()
