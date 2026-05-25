from __future__ import annotations

from fastapi import APIRouter

from app.domains.runtime_tools.schemas import RuntimeToolRead
from app.domains.runtime_tools.service import list_runtime_tools

router = APIRouter(prefix="/api/runtime-tools", tags=["运行时工具"])


@router.get("", response_model=list[RuntimeToolRead])
def list_runtime_tools_endpoint() -> list[RuntimeToolRead]:
    """列出 CreativeToolRegistry 声明的运行时工具能力。"""

    return list_runtime_tools()
