"""S3 对象存储客户端封装（boto3），支持上传与签名 URL 生成。

设计：
- 懒加载单例，从 config 读取 MinIO / S3 配置。
- 无 boto3 或配置不全时记录警告并返回 None，让调用方回退到 memory:// 占位。
- upload_bytes 返回 s3:// URI；generate_presigned_get_url 返回带签名的 HTTP GET URL。
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

_logger = logging.getLogger(__name__)
_client_singleton: Any | None | bool = False  # False = 未初始化, None = 不可用, 其他 = boto3.client
_fallback_warned = False


class S3UploadError(Exception):
    """S3 上传失败。"""


def get_s3_client() -> Any | None:
    """懒加载 S3 客户端；配置不全或 boto3 缺失时返回 None 并记录警告。"""

    global _client_singleton, _fallback_warned  # noqa: PLW0603

    if _client_singleton is not False:
        return _client_singleton if _client_singleton is not None else None

    try:
        import boto3  # noqa: PLC0415
        from botocore.exceptions import BotoCoreError  # noqa: F401, PLC0415
    except ImportError:
        if not _fallback_warned:
            _logger.warning("boto3 不可用，S3 导出将回退到 memory:// 占位。")
            _fallback_warned = True
        _client_singleton = None
        return None

    from app.common.config import get_settings

    config = get_settings()
    if not config.s3_endpoint or not config.s3_bucket:
        if not _fallback_warned:
            _logger.warning("S3 配置不全（缺少 endpoint 或 bucket），S3 导出将回退到 memory:// 占位。")
            _fallback_warned = True
        _client_singleton = None
        return None

    try:
        _client_singleton = boto3.client(
            "s3",
            endpoint_url=config.s3_endpoint,
            region_name=config.s3_region,
            aws_access_key_id=config.s3_access_key,
            aws_secret_access_key=config.s3_secret_key,
        )
        _logger.info("S3 客户端已初始化：endpoint=%s bucket=%s", config.s3_endpoint, config.s3_bucket)
    except Exception:  # noqa: BLE001
        if not _fallback_warned:
            _logger.exception("S3 客户端初始化失败，导出将回退到 memory:// 占位。")
            _fallback_warned = True
        _client_singleton = None
        return None

    # 初始化即确保目标 bucket 存在：MinIO/S3 默认不自建桶，缺桶时 put_object 抛 NoSuchBucket
    # 导致导出一路回退 memory://（实测 .codex/ 多次长跑产物均落内联 payload 而非真对象存储）。
    # 放在 client 层而非 compose init，是因为 CLI 冒烟不经 compose，只有这里能同时覆盖两条路。
    _ensure_bucket(_client_singleton, config.s3_bucket)
    return _client_singleton


def _ensure_bucket(client: Any, bucket: str) -> None:
    """幂等确保 bucket 存在：先 head_bucket 探测，不存在再 create_bucket。

    探测/创建失败不致命——记录警告后让后续 upload_bytes 自行回退 memory://，
    绝不因建桶失败中断 client 初始化（网络抖动、权限不足等不应丢掉已生成正文）。
    """

    try:
        client.head_bucket(Bucket=bucket)
        return
    except Exception:  # noqa: BLE001 — 不存在/无权限/网络，统一尝试创建后由 upload 兜底
        pass

    try:
        client.create_bucket(Bucket=bucket)
        _logger.info("S3 bucket 不存在，已创建：%s", bucket)
    except Exception:  # noqa: BLE001
        _logger.warning("S3 bucket 确保失败（既无法探测也无法创建）：%s，导出将回退 memory://", bucket)


def upload_bytes(
    key: str,
    data: bytes,
    mime_type: str = "application/octet-stream",
    *,
    _get_client: Callable[[], Any | None] | None = None,
) -> str | None:
    """上传字节到 S3，返回 s3://bucket/key URI；失败或客户端不可用时返回 None。"""

    client = (_get_client or get_s3_client)()
    if client is None:
        return None

    from app.common.config import get_settings

    bucket = get_settings().s3_bucket

    try:
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=mime_type)
        _logger.debug("S3 上传成功：s3://%s/%s (%d bytes)", bucket, key, len(data))
        return f"s3://{bucket}/{key}"
    except Exception:
        # docstring 契约：上传失败返回 None，由调用方回退到 memory:// 内联 payload，
        # 而非中断整个 BookRun 导出（bucket 缺失、网络抖动等不应丢掉已生成正文）。
        _logger.exception("S3 上传失败，回退 memory:// 占位：key=%s", key)
        return None


def generate_presigned_get_url(
    storage_uri: str,
    ttl_seconds: int = 300,
    *,
    _get_client: Callable[[], Any | None] | None = None,
) -> str | None:
    """为 s3:// URI 生成 presigned GET URL（默认 5 分钟有效期）；失败或非 S3 URI 返回 None。"""

    if not storage_uri.startswith("s3://"):
        return None

    client = (_get_client or get_s3_client)()
    if client is None:
        return None

    parts = storage_uri[5:].split("/", 1)
    if len(parts) != 2:
        _logger.warning("S3 URI 格式错误：%s", storage_uri)
        return None

    bucket, key = parts
    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=ttl_seconds,
        )
        _logger.debug("生成 presigned URL：s3://%s/%s ttl=%ds", bucket, key, ttl_seconds)
        return url
    except Exception:  # noqa: BLE001
        _logger.exception("生成 presigned URL 失败：%s", storage_uri)
        return None


def presigned_url_expires_at(ttl_seconds: int) -> str:
    """返回当前时刻 + ttl_seconds 的 ISO 8601 时间戳。"""

    return (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat()
