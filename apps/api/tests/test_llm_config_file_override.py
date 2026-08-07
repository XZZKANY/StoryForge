from __future__ import annotations

import json

import pytest

from app.common.llm_env import PolishLlmNotConfiguredError, resolve_polish_llm
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


def test_llm_config_file_empty_field_clears_stale_env(tmp_path, monkeypatch) -> None:
    """UF-02: 作者清除 API key 后文件写成 apiKey=""，必须清掉起服 spawn 注入的旧 key，
    resolved_llm_env 不得再读到 stale env（否则后端继续发旧 key 直到重启）。"""

    config = tmp_path / "llm-provider.json"
    config.write_text(
        json.dumps(
            {
                "provider": "deepseek",
                "baseUrl": "https://provider.file/v1",
                "model": "model-from-file",
                "apiKey": "",  # 作者已清除
            }
        ),
        encoding="utf-8",
    )
    # spawn 注入的旧 key 仍在进程环境（桌面起服注入的 per-field 快照）。
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "sk-OLD-launch-key")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))

    source = resolved_llm_env()

    assert source["STORYFORGE_LLM_API_KEY"] == ""  # 修复前：仍是 sk-OLD-launch-key
    assert source["STORYFORGE_LLM_MODEL"] == "model-from-file"  # 非空字段仍以文件为准，不误伤


def test_llm_config_file_new_key_still_overrides_stale_env(tmp_path, monkeypatch) -> None:
    """换新 key 场景不回归：文件非空 apiKey 覆盖 spawn 注入的旧 key。"""

    config = tmp_path / "llm-provider.json"
    config.write_text(
        json.dumps({"provider": "deepseek", "baseUrl": "", "model": "m", "apiKey": "sk-NEW"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "sk-OLD-launch-key")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))

    source = resolved_llm_env()

    assert source["STORYFORGE_LLM_API_KEY"] == "sk-NEW"


def test_llm_config_file_absent_field_preserves_env(tmp_path, monkeypatch) -> None:
    """文件未含某字段（key 不存在）时保留 env/settings 覆盖链，不误清。"""

    config = tmp_path / "llm-provider.json"
    config.write_text(json.dumps({"provider": "deepseek", "model": "m"}), encoding="utf-8")  # 故意省略 apiKey 键
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "sk-from-env")
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))

    source = resolved_llm_env()

    assert source["STORYFORGE_LLM_API_KEY"] == "sk-from-env"


def test_polish_slot_is_resolved_without_changing_main_model(tmp_path, monkeypatch) -> None:
    config = tmp_path / "llm-provider.json"
    config.write_text(
        json.dumps(
            {
                "provider": "openai-compatible",
                "baseUrl": "https://main.example/v1",
                "model": "main-model",
                "apiKey": "main-key",
                "polish": {
                    "provider": "anthropic",
                    "baseUrl": "https://polish.example/v1",
                    "model": "polish-model",
                    "apiKey": "polish-key",
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(config))

    polish = resolve_polish_llm()
    main = resolved_llm_env()

    assert polish.resolution_source == "dedicated"
    assert polish.provider == "anthropic"
    assert polish.model == "polish-model"
    assert polish.source["STORYFORGE_LLM_API_KEY"] == "polish-key"
    assert main["STORYFORGE_LLM_MODEL"] == "main-model"
    assert main["STORYFORGE_LLM_API_KEY"] == "main-key"


def test_missing_polish_slot_never_silently_uses_main_model() -> None:
    env = {
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_BASE_URL": "https://main.example/v1",
        "STORYFORGE_LLM_MODEL": "main-model",
        "STORYFORGE_LLM_API_KEY": "main-key",
    }

    with pytest.raises(PolishLlmNotConfiguredError, match="尚未配置专用润色模型"):
        resolve_polish_llm(env)


def test_main_model_requires_explicit_one_run_authorization() -> None:
    env = {
        "STORYFORGE_LLM_PROVIDER": "gemini",
        "STORYFORGE_LLM_BASE_URL": "https://main.example/v1beta",
        "STORYFORGE_LLM_MODEL": "main-model",
        "STORYFORGE_LLM_API_KEY": "main-key",
    }

    polish = resolve_polish_llm(env, use_main_model=True)

    assert polish.resolution_source == "explicit_main_model_override"
    assert polish.provider == "gemini"
    assert polish.model == "main-model"


def test_explicit_polish_env_uses_dedicated_names_only() -> None:
    env = {
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_BASE_URL": "https://main.example/v1",
        "STORYFORGE_LLM_MODEL": "main-model",
        "STORYFORGE_LLM_API_KEY": "main-key",
        "STORYFORGE_POLISH_LLM_PROVIDER": "gemini",
        "STORYFORGE_POLISH_LLM_BASE_URL": "https://polish.example/v1beta",
        "STORYFORGE_POLISH_LLM_MODEL": "polish-model",
        "STORYFORGE_POLISH_LLM_API_KEY": "polish-key",
    }

    polish = resolve_polish_llm(env)

    assert polish.provider == "gemini"
    assert polish.model == "polish-model"
    assert polish.source["STORYFORGE_LLM_BASE_URL"] == "https://polish.example/v1beta"
