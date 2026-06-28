"""Book generation 异常定义。

从 book_generation.py 提取，作为 book_runs 域共享叶子底座，
使 LLM / judge / metrics 等薄模块可单向引用，不反向依赖 god-file。
book_generation.py 通过 re-export 保持可达性（宪法第 5/6 条）。
"""
from __future__ import annotations


class BookGenerationPreflightError(RuntimeError):
    """真实 LLM 生成缺少私有运行配置。"""


class BookGenerationError(RuntimeError):
    """真实 LLM 生成运行失败，不能写入完成证据。"""
