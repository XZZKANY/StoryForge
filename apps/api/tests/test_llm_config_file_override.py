from __future__ import annotations

import json

from app.domains.book_runs.book_generation_preflight import resolved_llm_env


def test_llm_config_file_overrides_env(tmp_path, monkeypatch) -> None:
    """桌面端 llm-provider.json 应实时覆盖启动时注入的 env，无需重启即可换模型。"""

    config = tmp_path / "llm-provider.json"
    config.write_text(
        json.dumps(
            {
                "provider": "deepseek",
                "baseUrl": "https://provider.file/v1",
                "model": "model-from-file",
                "apiKey": "key-from-file",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "model-from-env")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))

    source = resolved_llm_env()

    assert source["STORYFORGE_LLM_MODEL"] == "model-from-file"
    assert source["STORYFORGE_LLM_BASE_URL"] == "https://provider.file/v1"
    assert source["STORYFORGE_LLM_API_KEY"] == "key-from-file"
    assert source["STORYFORGE_LLM_PROVIDER"] == "deepseek"


def test_llm_config_file_absent_falls_back_to_env(tmp_path, monkeypatch) -> None:
    """配置文件缺失或损坏时静默回退到 env，不影响非桌面运行态。"""

    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "model-from-env")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(tmp_path / "missing.json"))

    source = resolved_llm_env()

    assert source["STORYFORGE_LLM_MODEL"] == "model-from-env"


def test_resolved_llm_env_facade_reexports_common_impl() -> None:
    """preflight 只是 facade：覆盖链唯一实现在 app/common/llm_env.py（judge 等上游域共用）。"""

    from app.common import llm_env

    assert resolved_llm_env is llm_env.resolved_llm_env
