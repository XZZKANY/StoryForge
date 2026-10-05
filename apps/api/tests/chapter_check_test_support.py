"""Provider fixture echoes the source identity actually delivered in the prompt."""

import json


def chapter_check_reply(prompt: str, findings: list[dict]) -> dict[str, str]:
    source = next(line.removeprefix("检查源：") for line in prompt.splitlines() if line.startswith("检查源："))
    return {"reply": json.dumps({**json.loads(source), "findings": findings}, ensure_ascii=False)}
