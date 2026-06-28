"""Agent Runtime 编排异常定义。

从 ide/orchestrator.py 提取，解除「薄模块反向依赖胖模块」的环。
orchestrator.py 通过 re-export 保持可达性（宪法第 5/6 条）。
"""
from __future__ import annotations


class AgentOrchestrationError(RuntimeError):
    """Agent 编排输入不足或下游工具执行失败。"""
