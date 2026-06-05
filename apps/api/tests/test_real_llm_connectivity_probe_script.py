from __future__ import annotations

import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread

ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / ".codex" / "run-real-llm-connectivity-probe.ps1"
TEN_CHAPTER_WRAPPER_PATH = ROOT / ".codex" / "run-real-llm-10ch-current-env.ps1"


class _ProbeProviderHandler(BaseHTTPRequestHandler):
    """本地 OpenAI 兼容假 Provider，用于验证包装脚本不必触碰真实外部模型。"""

    requests: list[str] = []

    def do_GET(self) -> None:  # noqa: N802
        self.__class__.requests.append(self.path)
        if self.path != "/v1/models":
            self.send_error(404)
            return
        body = json.dumps({"data": [{"id": "local-probe-model"}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        self.__class__.requests.append(self.path)
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.dumps({"choices": [{"message": {"content": "OK"}}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def test_real_llm_connectivity_probe_script_contract() -> None:
    """真实长程前应有低成本连通性探针，先发现网络、鉴权和模型问题。"""

    script = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "Read-Host" in script
    assert "-AsSecureString" in script
    assert "STORYFORGE_LLM_API_KEY" in script
    assert "STORYFORGE_LLM_BASE_URL" in script
    assert "STORYFORGE_LLM_MODEL" in script
    assert "/models" in script
    assert "/chat/completions" in script
    assert "gate: fail_preflight" in script
    assert "models_probe" in script
    assert "chat_probe" in script
    assert "finally" in script
    assert "$env:STORYFORGE_LLM_API_KEY = $null" in script
    assert "外部令牌计划端点" not in script
    assert "tp-" not in script


def test_real_llm_connectivity_probe_allows_reasoning_models_to_return_content() -> None:
    """探针应给长思考模型保留足够输出空间，避免 HTTP 成功但正文为空。"""

    script = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "max_completion_tokens = 64" in script
    assert "max_tokens = 8" not in script


def test_real_llm_connectivity_probe_fails_preflight_without_runtime_env() -> None:
    """缺少当前进程运行时变量时，探针必须在外呼前停止。"""

    result = subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT_PATH),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    assert "gate: fail_preflight" in result.stdout
    assert "missing_env=" in result.stdout
    assert "models_probe: ok" not in result.stdout
    assert "chat_probe: ok" not in result.stdout
    assert "外部令牌计划端点" not in result.stdout
    assert "tp-" not in result.stdout


def test_ten_chapter_wrapper_requires_connectivity_probe_before_long_run() -> None:
    """10 章长程包装必须先通过低成本探针，不能绕过网络和模型门禁。"""

    script = TEN_CHAPTER_WRAPPER_PATH.read_text(encoding="utf-8")

    assert "run-real-llm-connectivity-probe.ps1" in script
    assert "pass_connectivity_probe" in script
    assert "fail_connectivity_probe" in script
    assert "connectivity_probe_exit_code" in script
    assert "run-real-llm-long-direct.py" in script
    assert "[int]$MaxChapterCount = 30" in script
    assert "--max-chapter-count $MaxChapterCount" in script
    assert script.index("-File $connectivityProbePath") < script.index("uv run python $runnerPath")


def test_ten_chapter_wrapper_supports_interactive_secure_runtime_input() -> None:
    """10 章包装应支持显式交互输入，避免把真实凭据写入文件或命令。"""

    script = TEN_CHAPTER_WRAPPER_PATH.read_text(encoding="utf-8")

    assert "[switch]$Interactive" in script
    assert "Read-Host" in script
    assert "-AsSecureString" in script
    assert "Convert-SecureStringToPlainText" in script
    assert "interactiveInjectedNames" in script
    assert "finally" in script
    assert 'STORYFORGE_LLM_API_KEY", "Process"' in script
    assert "$env:STORYFORGE_LLM_API_KEY = $null" in script
    assert "不要把凭据写入文件" in script
    assert "外部令牌计划端点" not in script
    assert "tp-" not in script


def test_ten_chapter_wrapper_probe_only_passes_with_local_provider() -> None:
    """ProbeOnly 模式应验证成功探针路径，并且不启动真实 10 章长程。"""

    _ProbeProviderHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _ProbeProviderHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = os.environ.copy()
    env.update(
        {
            "STORYFORGE_LLM_API_KEY": "test-local-credential",
            "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
            "STORYFORGE_LLM_MODEL": "local-probe-model",
            "STORYFORGE_LLM_PROVIDER": "openai-compatible",
            "STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD": "1",
        }
    )

    try:
        result = subprocess.run(
            [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(TEN_CHAPTER_WRAPPER_PATH),
                "-ProbeOnly",
                "-TimeoutSeconds",
                "5",
            ],
            capture_output=True,
            text=True,
            check=False,
            env=env,
            timeout=20,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert result.returncode == 0, result.stderr
    assert "models_probe: ok" in result.stdout
    assert "chat_probe: ok" in result.stdout
    assert "gate: pass_connectivity_probe" in result.stdout
    assert "gate: pass_probe_only" in result.stdout
    assert "run-real-llm-long-direct.py" not in result.stdout
    assert "test-local-credential" not in result.stdout
    assert _ProbeProviderHandler.requests == ["/v1/models", "/v1/chat/completions"]
