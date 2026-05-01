from fastapi import HTTPException, status
from typing import Optional, Dict, Any

class AppException(HTTPException):
    """Base application exception"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: Optional[str] = None,
        headers: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.error_code = error_code or f"ERR_{status_code}"
        self.context = context or {}

class NotFoundException(AppException):
    def __init__(self, detail: str = "Resource not found", **kwargs):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail,
            error_code="RESOURCE_NOT_FOUND",
            **kwargs,
        )

class UnauthorizedException(AppException):
    def __init__(self, detail: str = "Unauthorized", **kwargs):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            error_code="UNAUTHORIZED",
            **kwargs,
        )

class ForbiddenException(AppException):
    def __init__(self, detail: str = "Forbidden", **kwargs):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
            error_code="FORBIDDEN",
            **kwargs,
        )

class ValidationException(AppException):
    def __init__(self, detail: str = "Validation error", **kwargs):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
            error_code="VALIDATION_ERROR",
            **kwargs,
        )

class ConflictException(AppException):
    def __init__(self, detail: str = "Conflict", **kwargs):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
            error_code="CONFLICT",
            **kwargs,
        )

class RateLimitException(AppException):
    def __init__(self, detail: str = "Too many requests", retry_after: int = 60, **kwargs):
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            error_code="RATE_LIMIT_EXCEEDED",
            headers={"Retry-After": str(retry_after)},
            **kwargs,
        )

class ServiceUnavailableException(AppException):
    def __init__(self, detail: str = "Service temporarily unavailable", **kwargs):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail,
            error_code="SERVICE_UNAVAILABLE",
            **kwargs,
        )

class BillingServiceException(AppException):
    def __init__(self, detail: str = "Billing service error", **kwargs):
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
            error_code="BILLING_SERVICE_ERROR",
            **kwargs,
        )

class PaymentException(AppException):
    def __init__(self, detail: str = "Payment processing error", **kwargs):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
            error_code="PAYMENT_ERROR",
            **kwargs,
        )
