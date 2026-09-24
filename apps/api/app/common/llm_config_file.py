"""Versioned Desktop configuration boundary; never fall back after protected config errors."""

from __future__ import annotations

import base64
import binascii
import ctypes
import json
import sys
from pathlib import Path

from app.common.exceptions import DomainError

MANAGED_CONFIG_MODE = "desktop-managed-v2"
PROTECTION_SCHEME = "windows-dpapi-user-v1"
_FILE_TO_ENV = {
    "provider": "STORYFORGE_LLM_PROVIDER",
    "baseUrl": "STORYFORGE_LLM_BASE_URL",
    "model": "STORYFORGE_LLM_MODEL",
    "apiKey": "STORYFORGE_LLM_API_KEY",
}


class LlmConfigError(DomainError):
    """Fixed safe errors: do not attach JSON, ciphertext, paths or native error payloads."""

    status_code = 503


def _invalid() -> LlmConfigError:
    return LlmConfigError("LLM 配置格式无效或版本不支持；请在桌面设置中重新配置。")


def unprotect_key(value: object) -> str:
    if value is None:
        return ""
    if not isinstance(value, dict) or value.get("scheme") != PROTECTION_SCHEME:
        raise _invalid()
    encoded = value.get("ciphertext")
    if not isinstance(encoded, str) or not encoded:
        raise _invalid()
    try:
        ciphertext = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise _invalid() from None
    if not ciphertext or len(ciphertext) > 0xFFFFFFFF:
        raise _invalid()
    if sys.platform != "win32":
        raise LlmConfigError("LLM 配置密钥仅支持原 Windows 用户解密；请在 Windows 桌面设置中重新输入。")

    from ctypes import wintypes

    class DataBlob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    decrypt = crypt32.CryptUnprotectData
    decrypt.argtypes = [
        ctypes.POINTER(DataBlob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DataBlob),
    ]
    decrypt.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buffer = (ctypes.c_ubyte * len(ciphertext)).from_buffer_copy(ciphertext)
    source = DataBlob(len(ciphertext), buffer)
    output = DataBlob()
    # CRYPTPROTECT_UI_FORBIDDEN; no optional entropy, exactly matching the Rust writer.
    try:
        if not decrypt(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
            raise LlmConfigError("LLM 配置密钥无法解密；请使用原 Windows 用户或在设置中重新输入密钥。")
        try:
            result = ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
        except UnicodeError:
            raise _invalid() from None
        if not result.strip():
            raise _invalid()
        return result.strip()
    finally:
        if output.pbData:
            ctypes.memset(output.pbData, 0, output.cbData)
            kernel32.LocalFree(output.pbData)


def _validate_slot(slot: object) -> None:
    if not isinstance(slot, dict):
        raise _invalid()
    if any(not isinstance(slot.get(key), str) for key in ("provider", "baseUrl", "model")):
        raise _invalid()
    if "apiKey" not in slot:
        raise _invalid()
    key = slot["apiKey"]
    if key is not None and (
        not isinstance(key, dict)
        or key.get("scheme") != PROTECTION_SCHEME
        or not isinstance(key.get("ciphertext"), str)
        or not key["ciphertext"]
    ):
        raise _invalid()


def apply_config_slot(source: dict[str, str | None], path: str, *, managed: bool, polish: bool = False) -> None:
    if not path:
        if managed:
            raise LlmConfigError("LLM 配置路径缺失；请重新启动桌面应用。")
        return
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        if managed:
            raise LlmConfigError("LLM 配置无法读取；请在桌面设置中修复配置后重试。") from None
        return  # Legacy standalone CLI behavior, never used by the managed sidecar.
    if not isinstance(data, dict):
        if managed:
            raise _invalid()
        return
    version = data.get("schemaVersion", 1)
    if type(version) is not int or version not in (1, 2) or (managed and version != 2):
        raise _invalid()
    if version == 2:
        _validate_slot(data)
        if data.get("polish") is not None:
            _validate_slot(data["polish"])
    slot = data.get("polish") if polish else data
    if version == 2:
        # Absent dedicated slot means unconfigured, not a stale process key.
        source.update(dict.fromkeys(_FILE_TO_ENV.values(), ""))
        source["STORYFORGE_LLM_API_BASE_URL"] = ""
    if not isinstance(slot, dict):
        return
    for file_key, env_key in _FILE_TO_ENV.items():
        if file_key == "apiKey" and version == 2:
            source[env_key] = unprotect_key(slot[file_key])
        elif isinstance(slot.get(file_key), str):
            source[env_key] = slot[file_key].strip()
    if version == 2:
        source["STORYFORGE_LLM_API_BASE_URL"] = source["STORYFORGE_LLM_BASE_URL"]
