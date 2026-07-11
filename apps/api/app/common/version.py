"""应用版本单点：main.py 的 FastAPI(version=...) 与 /health/ready 的 app_version 共用，
与 pyproject.toml / tauri.conf.json 手动对齐。Tauri 起服据 /health/ready 的 app_version
与桌面应用版本比对，不符即杀旧 sidecar 再 spawn（消除覆盖安装后连旧孤儿 exe 的串台）。"""

from __future__ import annotations

APP_VERSION = "0.1.2"
