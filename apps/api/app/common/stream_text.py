"""Bounded incremental visible-text filtering; no provider or application dependency."""
from __future__ import annotations

import re
from collections.abc import Iterable

from app.common.redaction import configured_secret_values, redact_sensitive_text

# Hold unfinished secret-shaped words/assignments, including markers split across reads.
_MARKERS = ("sk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "xoxb-", "xoxp-",
            "xoxa-", "xoxr-", "xoxs-", "aiza", "api-key", "api_key", "api key",
            "apikey", "authorization", "bearer", "token", "password", "secret", "credential")
_CANDIDATE = re.compile(
    r"(?i)\b(?:sk-|gh[pousr]_|xox[baprs]-|AIza)[A-Za-z0-9._:/+=@\-]*$"
    r"|\b(?:api[-_ ]?key|authorization|bearer|token|password|secret|credential)"
    r"(?:\s*[:=\-]\s*|\s+)?[A-Za-z0-9._:/+=@\-]*$"
)
_TOKEN_CHAR = re.compile(r"[A-Za-z0-9._:/+=@\-]")


class VisibleTextFilter:
    """Remove think blocks anywhere and withhold incomplete secrets before publication."""

    def __init__(self, secrets: Iterable[str | None] = ()) -> None:
        self._secrets = tuple(configured_secret_values(secrets))
        self._tag_buffer = ""
        self._thinking = False
        self._pending = ""
        self._dropping = False
        self.stripped = False

    def feed(self, text: str) -> str:
        self._tag_buffer += text
        visible = []
        while self._tag_buffer:
            lower = self._tag_buffer.lower()
            tag = "</think>" if self._thinking else "<think>"
            index = lower.find(tag)
            if index >= 0:
                if not self._thinking:
                    visible.append(self._tag_buffer[:index])
                self._tag_buffer = self._tag_buffer[index + len(tag):]
                self._thinking = not self._thinking
                self.stripped = True
                continue
            keep = max((size for size in range(1, len(tag))
                        if lower.endswith(tag[:size])), default=0)
            end = len(self._tag_buffer) - keep
            if not self._thinking:
                visible.append(self._tag_buffer[:end])
            self._tag_buffer = self._tag_buffer[end:]
            break
        return self._redact("".join(visible))

    def _redact(self, text: str, *, final: bool = False) -> str:
        if self._dropping:
            index = next((i for i, char in enumerate(text) if not _TOKEN_CHAR.fullmatch(char)), None)
            if index is None:
                return ""
            text = text[index:]
            self._dropping = False
        self._pending += text
        if final:
            result = redact_sensitive_text(self._pending, extra_secrets=self._secrets)
            self._pending = ""
            return result
        cut = len(self._pending)
        candidate = _CANDIDATE.search(self._pending)
        if candidate:
            cut = candidate.start()
        for marker in (*_MARKERS, *self._secrets):
            haystack = self._pending if marker in self._secrets else self._pending.lower()
            for size in range(min(len(marker), len(haystack)), 0, -1):
                if haystack.endswith(marker[:size]):
                    cut = min(cut, len(haystack) - size)
                    break
        # A generic marker inside a known credential must not split its prefix into output.
        previous_cut = -1
        while previous_cut != cut:
            previous_cut = cut
            for secret in self._secrets:
                start = self._pending.find(secret)
                while start >= 0:
                    if start < cut < start + len(secret):
                        cut = start
                    start = self._pending.find(secret, start + 1)
        ready, self._pending = self._pending[:cut], self._pending[cut:]
        result = redact_sensitive_text(ready, extra_secrets=self._secrets)
        if len(self._pending) > 4096:
            # Never publish an unbounded ambiguous ASCII token just to release memory.
            self._pending = ""
            self._dropping = True
            result += "[REDACTED]"
        return result

    def finish(self) -> str:
        # An unfinished think tag/block is not publishable.
        self._tag_buffer = ""
        return self._redact("", final=True)
