from __future__ import annotations


class DomainError(Exception):
    """?????????"""

    status_code: int = 400


class NotFoundError(DomainError):
    """??????"""

    status_code = 404


class InputError(DomainError):
    """??????"""

    status_code = 400


class ConflictError(DomainError):
    """?????"""

    status_code = 409
