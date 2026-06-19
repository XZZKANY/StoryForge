"""真实端到端探针：用 Starlette TestClient 走真实路由 + 真实 DB + 真实 mimo，打一发 /api/assistant/revise。

为什么用 TestClient 而非 uvicorn：本机 venv 的 uvicorn 无条件 import uvloop，而 Windows 无 uvloop。
TestClient 直接挂载 app.main:app，请求经过完整中间件、鉴权、DB 与 service.revise_file_content → _call_llm，
是货真价实的端到端，只是少了 HTTP socket 这一跳。

用法（在 apps/api 下，已 export STORYFORGE_LLM_* 与 DATABASE_URL）：
  cd apps/api
  uv run python ../../.codex/run-assistant-revise-e2e-probe.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[1] / "apps" / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

from fastapi.testclient import TestClient

from app.main import app


def main() -> int:
    client = TestClient(app)
    resp = client.post(
        "/api/assistant/revise",
        headers={"X-StoryForge-API-Key": "local-dev-key"},
        json={
            "file_path": "draft.md",
            "content": "林岚走进港口。海面很安静。",
            "instruction": "加强画面感与紧张氛围，保持第三人称，不要解释。",
        },
    )
    print(f"http={resp.status_code}", flush=True)
    if resp.status_code != 200:
        print(f"detail={resp.text[:800]}", flush=True)
        return 0
    data = resp.json()
    before = data["before"]
    after = data["after"]
    print(f"model={data['model']} latency_ms={data['latency_ms']} completion_tokens={data['completion_tokens']}", flush=True)
    print(f"changed={after != before} after_chars={len(after)}", flush=True)
    print(f"after_preview={after[:200]!r}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
