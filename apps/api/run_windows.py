"""
Windows 兼容的 uvicorn 启动脚本
绕过 uvloop 问题
"""
import asyncio
import os
import sys

# 在 Windows 上设置事件循环策略
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Mock uvloop 模块，防止 uvicorn 尝试导入
sys.modules['uvloop'] = type(sys)('uvloop')


def storyforge_loop_factory(use_subprocess: bool = False):
    return asyncio.SelectorEventLoop()

if __name__ == "__main__":
    import uvicorn

    host = os.getenv("STORYFORGE_API_HOST", "0.0.0.0")
    try:
        port = int(os.getenv("STORYFORGE_API_PORT", "8000"))
    except ValueError:
        port = 8000

    # 强制使用 asyncio loop
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        loop="__main__:storyforge_loop_factory",
        reload=False,     # 禁用 reload 避免多进程问题
        log_level="info",
    )
