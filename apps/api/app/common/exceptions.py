from __future__ import annotations


class DomainError(Exception):
    """领域层可预期异常的基类。"""

    status_code: int = 400


class NotFoundError(DomainError):
    """请求的领域对象不存在。"""

    status_code = 404


class InputError(DomainError):
    """调用方提交的输入不满足领域约束。"""

    status_code = 400


class ConflictError(DomainError):
    """请求与当前领域状态冲突。"""

    status_code = 409


class ForbiddenError(DomainError):
    """请求被领域权限或作用域规则拒绝。"""

    status_code = 403
