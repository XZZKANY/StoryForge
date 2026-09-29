"""Application logging composition for the content-free performance recorder."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any, ParamSpec, TypeVar

from app.common.logging_config import get_logger
from app.common.performance import RunMeasurement, current_measurement, measure_stage, measurement_scope

P = ParamSpec("P")
R = TypeVar("R")


def log_measurement(summary: dict[str, Any]) -> None:
    get_logger(__name__).info("operation_measurement", **summary)


def observe_run(name: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorate(function: Callable[P, R]) -> Callable[P, R]:
        @wraps(function)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            if current_measurement() is not None:
                with measure_stage(name):
                    return function(*args, **kwargs)
            recorder = RunMeasurement(sink=log_measurement)
            try:
                with measurement_scope(recorder), measure_stage(name):
                    return function(*args, **kwargs)
            finally:
                recorder.publish("complete")

        return wrapper

    return decorate
