"""Synthetic manuscript corpus and application-level read accounting (not disk I/O)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

FIXTURE_VERSION = "style-read-v1"
CASES = ("normal", "large_suffix", "ascii_budget", "unicode_budget")
SENTENCE = "他说「灯该换了」，随后把窗关上。\n"


def make_corpus(root: Path, case: str) -> tuple[list[Path], dict]:
    if case not in CASES:
        raise ValueError("unknown synthetic corpus")
    directory = root / "正文"
    directory.mkdir(parents=True, exist_ok=True)
    seed = ("The lamp went dark! He shut the window.\n" if case == "ascii_budget" else SENTENCE).encode()
    count = 5 if case == "normal" else 3 if case == "large_suffix" else 10
    prefix = seed * 100 if case == "normal" else (seed * (200_000 // len(seed) + 1))[:200_000]
    data = prefix
    if case == "large_suffix":
        data += b"UNREAD_SUFFIX!" * ((8 * 1024 * 1024 - len(data)) // 13 + 1)
        data = data[: 8 * 1024 * 1024]
    files = []
    for index in range(count):
        path = directory / f"第{index + 10:03d}章.md"
        path.write_bytes(data)
        files.append(path)
    instructions = root / ".storyforge" / "agent-instructions.md"
    instructions.parent.mkdir(exist_ok=True)
    instructions.write_text("保持短句，不新增设定。", encoding="utf-8")
    return files, {
        "version": FIXTURE_VERSION,
        "case": case,
        "files": count,
        "bytes_per_file": len(data),
        "content_sha256": hashlib.sha256(data).hexdigest(),
        "prefix_sha256": hashlib.sha256(prefix).hexdigest(),
    }


class ReadProbe:
    """Count read() arguments/results only for selected binary files; never retain text."""

    def __init__(self, files):
        self.files = set(files)
        self.calls = []
        self.opened = []
        self.patch = pytest.MonkeyPatch()

    def __enter__(self):
        original_open = Path.open
        owner = self

        class Reader:
            def __init__(self, stream, path):
                self.stream, self.path = stream, path

            def read(self, size=-1):
                result = self.stream.read(size)
                owner.calls.append({"file": self.path.name, "requested": size, "returned": len(result)})
                return result

            def __enter__(self):
                self.stream.__enter__()
                return self

            def __exit__(self, *args):
                return self.stream.__exit__(*args)

            def __getattr__(self, name):
                return getattr(self.stream, name)

        def open_file(path, mode="r", *args, **kwargs):
            stream = original_open(path, mode, *args, **kwargs)
            if path in owner.files and mode == "rb":
                owner.opened.append(path.name)
                return Reader(stream, path)
            return stream

        self.patch.setattr(Path, "open", open_file)
        return self

    def __exit__(self, *_):
        self.patch.undo()

    def summary(self):
        return {
            "calls": self.calls,
            "opened": len(self.opened),
            "returned_bytes": sum(c["returned"] for c in self.calls),
        }
