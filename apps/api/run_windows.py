"""
Windows 兼容的 uvicorn 启动脚本
绕过 uvloop 问题
"""
import asyncio
import sys

# 在 Windows 上设置事件循环策略
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Mock uvloop 模块，防止 uvicorn 尝试导入
sys.modules['uvloop'] = type(sys)('uvloop')

if __name__ == "__main__":
    import uvicorn

    # 强制使用 asyncio loop
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",   # 绑定所有接口
        port=8000,
        loop="asyncio",   # 强制 asyncio
        reload=False,     # 禁用 reload 避免多进程问题
        log_level="info",
    )
