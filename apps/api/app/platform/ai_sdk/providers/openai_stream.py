"""OpenAI tool delta assembly, independent of HTTP and StoryForge domains."""
from __future__ import annotations

import json
from collections.abc import Mapping


class OpenAIToolStream:
    def __init__(self) -> None:
        self.calls: dict[int, dict] = {}
        self.response_id: str | None = None
        self.characters = 0

    def feed(self, chunk: Mapping[str, object]) -> None:
        if isinstance(chunk.get("id"), str):
            self.response_id = chunk["id"]
        choices = chunk.get("choices")
        if not isinstance(choices, list) or not choices:
            return
        choice = choices[0]
        delta = choice.get("delta") if isinstance(choice, dict) else None
        fragments = delta.get("tool_calls") if isinstance(delta, dict) else None
        if fragments is None:
            return
        if not isinstance(fragments, list):
            raise ValueError("invalid_tool_stream")
        for fragment in fragments:
            if not isinstance(fragment, dict):
                raise ValueError("invalid_tool_stream")
            index = fragment.get("index")
            if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < 128:
                raise ValueError("invalid_tool_stream_index")
            call = self.calls.setdefault(index, {"id": "", "type": "function",
                                                "function": {"name": "", "arguments": ""}})
            function = fragment.get("function", {})
            if not isinstance(function, dict) or fragment.get("type", "function") != "function":
                raise ValueError("invalid_tool_stream_function")
            for target, key, part in ((call, "id", fragment.get("id")),
                                     (call["function"], "name", function.get("name")),
                                     (call["function"], "arguments", function.get("arguments"))):
                if part is None:
                    continue
                if not isinstance(part, str):
                    raise ValueError("invalid_tool_stream_fragment")
                self.characters += len(part)
                if self.characters > 1_048_576:
                    raise ValueError("tool_stream_too_large")
                target[key] += part

    def complete(self, finish_reason: str | None) -> list[dict]:
        if finish_reason in {"length", "content_filter"}:
            return []  # Preserve finish/usage, but discard every incomplete call.
        if self.calls and finish_reason not in {"stop", "tool_calls"}:
            raise ValueError("incomplete_tool_stream")
        result = [self.calls[index] for index in sorted(self.calls)]
        ids = set()
        for call in result:
            if not call["id"] or not call["function"]["name"] or call["id"] in ids:
                raise ValueError("invalid_completed_tool")
            ids.add(call["id"])
            try:
                arguments = json.loads(call["function"]["arguments"])
            except (ValueError, TypeError):
                raise ValueError("invalid_completed_arguments") from None
            if not isinstance(arguments, dict):
                raise ValueError("invalid_completed_arguments")
        return result
