"""公共依赖注入声明，消除各路由模块的重复定义。"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import get_session

SessionDependency = Annotated[Session, Depends(get_session)]
