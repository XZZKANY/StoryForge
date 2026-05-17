from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langgraph.types import Command, Interrupt, InterruptSignal, clear_resume_value, set_resume_value

START = "__start__"
END = "__end__"


@dataclass
class GraphStateSnapshot:
    values: dict[str, Any]


class StateGraph:
    def __init__(self, state_type: type | None = None) -> None:
        self.state_type = state_type
        self._nodes: dict[str, Any] = {}
        self._edges: dict[str, str] = {}

    def add_node(self, name: str, node: Any) -> None:
        self._nodes[name] = node

    def add_edge(self, source: str, target: str) -> None:
        self._edges[source] = target

    def compile(self, checkpointer: Any | None = None):
        return CompiledGraph(self._nodes, self._edges, checkpointer=checkpointer)


class CompiledGraph:
    def __init__(self, nodes: dict[str, Any], edges: dict[str, str], checkpointer: Any | None = None) -> None:
        self._nodes = nodes
        self._edges = edges
        self._checkpointer = checkpointer
        self._state_by_thread: dict[str, dict[str, Any]] = {}
        self._pending_node_by_thread: dict[str, str] = {}

    def stream(self, input_value: dict[str, Any] | Command, config: dict[str, Any] | None = None):
        thread_id = _thread_id(config)
        if isinstance(input_value, Command):
            state = dict(self._state_by_thread.get(thread_id, {}))
            current_node = self._pending_node_by_thread.get(thread_id)
            if current_node is None:
                return iter(())
            return self._run_from_node(thread_id, state, current_node, config, resume=input_value.resume)

        state = dict(input_value)
        current_node = self._edges[START]
        self._state_by_thread[thread_id] = dict(state)
        return self._run_from_node(thread_id, state, current_node, config, resume=None)

    def get_state(self, config: dict[str, Any] | None = None) -> GraphStateSnapshot:
        thread_id = _thread_id(config)
        return GraphStateSnapshot(values=dict(self._state_by_thread.get(thread_id, {})))

    def _run_from_node(
        self,
        thread_id: str,
        state: dict[str, Any],
        current_node: str,
        config: dict[str, Any] | None,
        *,
        resume: Any,
    ):
        def generator():
            next_node = current_node
            pending_resume = resume
            while next_node != END:
                node = self._nodes[next_node]
                tokens: tuple[object, object] | None = None
                try:
                    if pending_resume is not None:
                        tokens = set_resume_value(pending_resume)
                    output = node(state, config)
                    if tokens is not None:
                        clear_resume_value(tokens)
                    pending_resume = None
                except InterruptSignal as signal:
                    if tokens is not None:
                        clear_resume_value(tokens)
                    self._state_by_thread[thread_id] = dict(state)
                    self._pending_node_by_thread[thread_id] = next_node
                    if self._checkpointer is not None:
                        self._checkpointer.state[thread_id] = dict(state)
                    yield {"__interrupt__": [Interrupt(signal.value)]}
                    return

                state.update(output)
                self._state_by_thread[thread_id] = dict(state)
                self._pending_node_by_thread.pop(thread_id, None)
                if self._checkpointer is not None:
                    self._checkpointer.state[thread_id] = dict(state)
                yield {next_node: output}
                next_node = self._edges.get(next_node, END)

        return generator()


def _thread_id(config: dict[str, Any] | None) -> str:
    configured = ((config or {}).get("configurable") or {}).get("thread_id")
    return str(configured or "default-thread")

