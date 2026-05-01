from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp
import time
import logging
from app.config import settings
from app.services.cache import redis_cache

logger = logging.getLogger(__name__)


def _is_staging_demo_mode() -> bool:
    environment = getattr(settings.environment, "value", settings.environment)
    return bool(settings.demo_mode and environment == "staging")

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging all requests"""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start_time = time.time()

        # Get request details
        client_ip = request.client.host if request.client else "unknown"
        method = request.method
        url = str(request.url)
        user_agent = request.headers.get("user-agent", "")

        # Process request
        try:
            response = await call_next(request)

            # Calculate duration
            duration_ms = (time.time() - start_time) * 1000

            # Log request
            logger.info(
                f"{method} {url} - {response.status_code} - {duration_ms:.2f}ms - {client_ip} - {user_agent}",
            )

            # Add response headers
            response.headers["X-Response-Time-MS"] = f"{duration_ms:.2f}"
            response.headers["X-Request-ID"] = request.headers.get("X-Request-ID", "")

            return response

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            logger.error(f"{method} {url} - ERROR: {e} - {duration_ms:.2f}ms - {client_ip}")
            raise

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting middleware using Redis"""

    def __init__(self, app: ASGIApp):
        super().__init__(app)
        self.rate_limits = {
            "default": (100, 60),  # 100 requests per minute
            "auth": (5, 60),       # 5 requests per minute for auth
            "admin": (200, 60),    # 200 requests per minute for admin
            "api": (1000, 60),     # 1000 requests per minute for API
        }

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if not settings.rate_limit_enabled:
            return await call_next(request)

        # HTML pages and static assets should keep working even if Redis is degraded.
        if not request.url.path.startswith("/api"):
            return await call_next(request)

        if settings.debug and request.url.hostname in {"localhost", "127.0.0.1"}:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"

        # Determine rate limit based on path
        path = request.url.path
        if _is_staging_demo_mode() and path in {"/api/v1/auth/login", "/api/v1/auth/2fa/login"}:
            return await call_next(request)

        sensitive_auth_paths = {
            "/api/v1/auth/login",
            "/api/v1/auth/register",
            "/api/v1/auth/register/confirm",
            "/api/v1/auth/reset-password",
        }
        if path.startswith("/api/v1/admin"):
            limit_key = "admin"
        elif path in sensitive_auth_paths or path.startswith("/api/v1/auth/2fa"):
            limit_key = "auth"
        elif path.startswith("/api"):
            limit_key = "api"
        else:
            limit_key = "default"

        limit, window = self.rate_limits.get(limit_key, self.rate_limits["default"])

        # Check rate limit
        redis_key = f"rate_limit:{limit_key}:{client_ip}"
        current = await redis_cache.incr(redis_key)
        if current <= 0:
            return await call_next(request)

        if current == 1:
            await redis_cache.expire(redis_key, window)

        if current > limit:
            logger.warning(f"Rate limit exceeded for {client_ip} on {path}")
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests", "retry_after": window},
            )

        return await call_next(request)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses"""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
            "style-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
            "style-src-attr 'self' 'unsafe-inline'; "
            "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self' ws: wss:; "
            "worker-src 'self' blob:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none';"
        )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        return response

class CompressionMiddleware(BaseHTTPMiddleware):
    """Compress responses for better performance"""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        # Check if client accepts gzip
        accept_encoding = request.headers.get("accept-encoding", "")
        if "gzip" not in accept_encoding or response.status_code >= 300:
            return response

        # Streaming/template responses don't expose an in-memory body here.
        body = getattr(response, "body", None)
        if body is None or not isinstance(body, (bytes, bytearray)):
            return response

        # Skip tiny responses and anything already encoded.
        if len(body) <= 1024 or response.headers.get("Content-Encoding"):
            return response

        import gzip

        compressed_body = gzip.compress(body)
        response.body = compressed_body
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(compressed_body))

        return response

class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add unique request ID to each request"""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        import uuid

        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id

        return response
