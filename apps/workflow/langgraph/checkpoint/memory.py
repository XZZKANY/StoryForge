from __future__ import annotations


class InMemorySaver:
    """兼容 create_generation_graph 的最小 checkpointer 占位。"""

    def __init__(self) -> None:
        self.state: dict[str, dict] = {}

