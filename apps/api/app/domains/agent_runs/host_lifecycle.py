"""Process-owned closing fence. Never a release switch or a manuscript writer."""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from functools import wraps
from threading import RLock

from sqlalchemy import select

from app.domains.agent_runs.loop.external_wait_state import ExternalWritebackConflict
from app.domains.agent_runs.models import AgentRun


class HostLifecycle:
    def __init__(self):
        self.lock = RLock()
        self.closing = False

    def require_open(self):
        with self.lock:
            if self.closing:
                raise ExternalWritebackConflict("managed_host_closing")

    def begin_close(self):
        with self.lock:
            self.closing = True


HOST_LIFECYCLE = HostLifecycle()


@contextmanager
def host_admission_context(required):
    if not required:
        yield
        return
    with HOST_LIFECYCLE.lock:
        HOST_LIFECYCLE.require_open()
        yield


def host_admission(operation):
    """Serialize only short admission transactions with the process closing fence."""

    @wraps(operation)
    def guarded(*args, **kwargs):
        with HOST_LIFECYCLE.lock:
            HOST_LIFECYCLE.require_open()
            return operation(*args, **kwargs)

    return guarded


def require_owned_generation(generation):
    owned = os.getenv("STORYFORGE_MANAGED_HOST_GENERATION", "")
    if re.fullmatch(r"[0-9a-f]{64}", owned) is None or owned != generation:
        raise ExternalWritebackConflict("managed_host_generation_mismatch")
    return owned


def host_close_status(session):
    from app.domains.agent_runs.service_execution import agent_execution_state

    # Inspect ALL unfinished owners in this process's persisted domain, not just
    # running rows: pause may be committed while an old provider is still alive.
    runs = session.scalars(select(AgentRun))
    count = sum(agent_execution_state(session, run) == "in_flight" for run in runs)
    return {
        "closing": HOST_LIFECYCLE.closing,
        "in_flight_owners": count,
        "settled": HOST_LIFECYCLE.closing and count == 0,
    }
