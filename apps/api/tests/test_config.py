"""集中配置层 ``app.common.config`` 的契约测试。

覆盖：
- 默认值与 .env 关键字段保持一致。
- 生产环境校验在默认凭据下报错。
- ``cors_origins`` 解析逗号分隔列表。
"""

from __future__ import annotations

import importlib

import pytest


@pytest.fixture
def fresh_settings(monkeypatch: pytest.MonkeyPatch):
    """在每个测试中重新加载配置单例，避免缓存污染。"""

    from app.common import config as config_module

    config_module.get_settings.cache_clear()
    yield config_module
    config_module.get_settings.cache_clear()


def test_default_settings_are_safe_for_local_development(fresh_settings) -> None:
    settings = fresh_settings.get_settings()
    assert settings.storyforge_env in {"development", "local"}
    assert settings.storyforge_api_key == "local-dev-key"
    assert settings.validate_for_environment() == []


def test_cors_origins_parses_comma_separated_values(fresh_settings, monkeypatch) -> None:
    monkeypatch.setenv("STORYFORGE_CORS_ORIGINS", "https://a.example.com,https://b.example.com, ")
    fresh_settings.get_settings.cache_clear()
    settings = fresh_settings.get_settings()
    assert settings.cors_origins == ["https://a.example.com", "https://b.example.com"]


def test_production_environment_rejects_default_credentials(fresh_settings, monkeypatch) -> None:
    monkeypatch.setenv("STORYFORGE_ENV", "production")
    fresh_settings.get_settings.cache_clear()
    settings = fresh_settings.get_settings()

    issues = settings.validate_for_environment()
    assert any("STORYFORGE_API_KEY" in issue for issue in issues)
    assert any("STORYFORGE_JWT_SECRET" in issue for issue in issues)

    with pytest.raises(RuntimeError) as excinfo:
        fresh_settings.ensure_production_settings()
    assert "STORYFORGE_API_KEY" in str(excinfo.value)


def test_production_environment_with_overrides_passes(fresh_settings, monkeypatch) -> None:
    monkeypatch.setenv("STORYFORGE_ENV", "production")
    monkeypatch.setenv("STORYFORGE_API_KEY", "production-secure-key-1234567890abcdef")
    monkeypatch.setenv("STORYFORGE_JWT_SECRET", "production-secure-jwt-secret-1234567890abcdef")
    monkeypatch.setenv("S3_SECRET_KEY", "production-secure-s3-secret")
    fresh_settings.get_settings.cache_clear()

    fresh_settings.ensure_production_settings()  # 不抛异常即通过


def test_get_settings_is_cached(fresh_settings) -> None:
    a = fresh_settings.get_settings()
    b = fresh_settings.get_settings()
    assert a is b


def test_module_reload_does_not_break_singleton_contract() -> None:
    """重新导入模块仍应暴露 get_settings/ensure_production_settings。"""

    from app.common import config

    reloaded = importlib.reload(config)
    assert hasattr(reloaded, "get_settings")
    assert hasattr(reloaded, "ensure_production_settings")
