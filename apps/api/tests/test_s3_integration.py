"""S3/MinIO 真实往返集成测试：默认 skip，设 STORYFORGE_S3_INTEGRATION=1 且 MinIO 在线时启用。

验证真路径而非降级：ensure_bucket → upload_bytes → presigned URL → HTTP GET 取回字节，
断言往返内容一致。conftest 默认把 get_s3_client 打桩成 None，本测试用 upload/presigned
已有的 `_get_client` 注入参数绕过打桩，直连真实 MinIO。
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.integration

_INTEGRATION_ENABLED = os.getenv("STORYFORGE_S3_INTEGRATION") == "1"

skip_unless_integration = pytest.mark.skipif(
    not _INTEGRATION_ENABLED,
    reason="需要真实 MinIO；设 STORYFORGE_S3_INTEGRATION=1 启用",
)


def _real_client():
    """直接按 config 造一个真 boto3 client，绕开 conftest 的全局打桩。"""

    import boto3

    from app.common.config import get_settings
    from app.common.s3_client import _ensure_bucket

    config = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=config.s3_endpoint,
        region_name=config.s3_region,
        aws_access_key_id=config.s3_access_key,
        aws_secret_access_key=config.s3_secret_key,
    )
    _ensure_bucket(client, config.s3_bucket)
    return client


@skip_unless_integration
def test_s3_round_trip_upload_presign_download() -> None:
    """ensure_bucket→upload→presigned→HTTP GET 往返，取回字节须与上传一致。"""

    import urllib.request

    from app.common.s3_client import generate_presigned_get_url, upload_bytes

    client = _real_client()
    payload = f"golden round trip {uuid.uuid4()}".encode()
    key = f"integration-tests/{uuid.uuid4()}.txt"

    uri = upload_bytes(key, payload, "text/plain", _get_client=lambda: client)
    assert uri is not None and uri.startswith("s3://")

    url = generate_presigned_get_url(uri, 300, _get_client=lambda: client)
    assert url is not None and url.startswith("http")

    with urllib.request.urlopen(url, timeout=10) as resp:  # noqa: S310 — 受控的本地 MinIO
        fetched = resp.read()
    assert fetched == payload


@skip_unless_integration
def test_ensure_bucket_is_idempotent_against_real_minio() -> None:
    """对真实 MinIO 连续 ensure 两次不应报错（桶已存在走 head 分支）。"""

    from app.common.config import get_settings
    from app.common.s3_client import _ensure_bucket

    client = _real_client()
    bucket = get_settings().s3_bucket
    _ensure_bucket(client, bucket)
    _ensure_bucket(client, bucket)  # 第二次仍 OK
