from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ProviderErrorCategory(StrEnum):
    CONFIGURATION = "configuration"
    AUTHENTICATION = "authentication"
    RATE_LIMIT = "rate_limit"
    INVALID_REQUEST = "invalid_request"
    CONTENT_FILTER = "content_filter"
    UNSUPPORTED = "unsupported"
    TIMEOUT = "timeout"
    CONNECTION = "connection"
    RESPONSE = "response"
    INTERNAL = "internal"


@dataclass(frozen=True)
class ProviderErrorDetails:
    category: ProviderErrorCategory
    safe_message: str
    retryable: bool = False
    status_code: int | None = None
    provider_code: str | None = None
    request_id: str | None = None


class ProviderError(RuntimeError):
    def __init__(self, details: ProviderErrorDetails) -> None:
        super().__init__(details.safe_message)
        self.details = details
