"""StoryForge API 集中配置层。

使用 ``pydantic-settings`` 把分散在各模块里的 ``os.getenv`` 收敛为类型化的设置对
象，配套 ``.env`` 加载与启动时校验。

- 所有字段都标注类型、默认值和注释，便于 ``.env.example`` 与本文件保持一致。
- 字段命名维持现有环境变量名（如 ``STORYFORGE_API_KEY``），避免破坏其他模块和
  容器编排。
- 现有调用点 ``os.getenv("...")`` 仍可正常工作；本模块作为额外的事实源，可在新
  代码中替换裸 ``os.getenv``。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[4]


class StoryForgeSettings(BaseSettings):
    """StoryForge API 运行时配置。"""

    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _REPO_ROOT / ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- 基础运行环境 ----
    storyforge_env: Literal["development", "local", "staging", "production"] = Field(
        default="development",
        description="部署环境标签，影响日志格式、Sentry 采样、默认凭据告警等。",
    )

    # ---- 数据库 ----
    database_url: str = Field(
        default="postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge",
        description="SQLAlchemy/Alembic 使用的 Postgres DSN。",
    )

    # ---- Redis ----
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis 连接串，用于缓存与速率限制。",
    )

    # ---- 对象存储 (S3 兼容) ----
    s3_endpoint: str = Field(default="http://localhost:9000", description="S3 兼容服务端点。")
    s3_region: str = Field(default="local", description="S3 区域。")
    s3_bucket: str = Field(default="storyforge", description="StoryForge 工件桶名。")
    s3_access_key: str = Field(default="storyforge", description="S3 Access Key。")
    s3_secret_key: str = Field(default="storyforge-dev-only", description="S3 Secret Key。")

    # ---- 认证 ----
    storyforge_api_key: str = Field(
        default="local-dev-key",
        description="服务间通信使用的静态 API Key。非 development 环境必须修改。",
    )
    storyforge_jwt_secret: str = Field(
        default="",
        description="JWT 签发与校验密钥。生产环境必须配置非空值。",
    )
    storyforge_jwt_expiry_seconds: int = Field(
        default=3600, description="JWT 默认有效期，单位秒。"
    )

    # ---- CORS ----
    storyforge_cors_origins: str = Field(
        default="http://localhost:3007,http://127.0.0.1:3007",
        description="允许的桌面前端跨域来源，逗号分隔。",
    )

    # ---- 请求处理 ----
    storyforge_request_timeout_seconds: float = Field(
        default=120.0,
        description="单个请求处理超时上限，单位秒。<=0 时回退到默认值。",
    )

    # ---- 可观测性 ----
    sentry_dsn: str = Field(default="", description="Sentry DSN，留空时禁用 Sentry。")
    sentry_traces_sample_rate: float = Field(
        default=0.1, description="Sentry traces 采样率 (0~1)。"
    )

    # ---- LLM ----
    storyforge_llm_provider: str = Field(
        default="deterministic", description="LLM Provider 标识。"
    )
    storyforge_llm_model: str = Field(
        default="storyforge-deterministic-writer", description="默认 LLM 模型名。"
    )
    storyforge_llm_api_key: str = Field(default="", description="LLM Provider API Key。")
    storyforge_llm_base_url: str = Field(
        default="", description="LLM Provider Base URL (如 https://api.deepseek.com)。"
    )
    storyforge_llm_timeout_seconds: float = Field(
        default=60.0, description="LLM 调用超时秒数。"
    )

    # ---- Embedding ----
    storyforge_embedding_provider: str = Field(
        default="local", description="Embedding Provider 标识。"
    )
    storyforge_embedding_model: str = Field(
        default="storyforge-fake-embedding", description="Embedding 模型名。"
    )
    storyforge_embedding_api_key: str = Field(default="", description="Embedding API Key。")

    @property
    def cors_origins(self) -> list[str]:
        """解析逗号分隔的 CORS 列表。"""

        return [origin.strip() for origin in self.storyforge_cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.storyforge_env == "production"

    def validate_for_environment(self) -> list[str]:
        """收集当前环境下必须修正的配置项，返回错误列表（空表示通过）。"""

        issues: list[str] = []
        if self.is_production:
            if self.storyforge_api_key == "local-dev-key":
                issues.append("生产环境必须修改 STORYFORGE_API_KEY，不能使用默认值。")
            if not self.storyforge_jwt_secret:
                issues.append("生产环境必须配置 STORYFORGE_JWT_SECRET。")
            if self.s3_secret_key == "storyforge-dev-only":
                issues.append("生产环境必须修改 S3_SECRET_KEY，不能使用默认值。")
            if not self.database_url.startswith("postgresql"):
                issues.append("DATABASE_URL 必须指向 Postgres。")
        return issues


@lru_cache(maxsize=1)
def get_settings() -> StoryForgeSettings:
    """返回进程内单例 ``StoryForgeSettings``。"""

    return StoryForgeSettings()


def ensure_production_settings() -> None:
    """启动时调用：生产环境配置缺失时直接抛出，避免带着不安全默认值上线。"""

    settings = get_settings()
    issues = settings.validate_for_environment()
    if issues:
        joined = "\n  - ".join(issues)
        raise RuntimeError(f"StoryForge 启动配置校验失败：\n  - {joined}")
