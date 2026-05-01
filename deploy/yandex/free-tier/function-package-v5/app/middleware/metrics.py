from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import time

# Metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

REQUEST_DURATION = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint'],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
)

ACTIVE_REQUESTS = Gauge(
    'http_active_requests',
    'Active HTTP requests'
)

DB_CONNECTION_COUNT = Gauge(
    'db_connection_count',
    'Database connection pool size'
)

REDIS_CONNECTION_COUNT = Gauge(
    'redis_connection_count',
    'Redis connection pool size'
)

USER_COUNT = Gauge(
    'user_count',
    'Total number of users'
)

ACTIVE_USER_COUNT = Gauge(
    'active_user_count',
    'Number of active users (logged in last 24h)'
)

TICKET_COUNT = Gauge(
    'ticket_count',
    'Total number of tickets',
    ['status']
)

PAYMENT_VOLUME = Counter(
    'payment_volume_total',
    'Total payment volume in RUB',
    ['status']
)

class MetricsMiddleware(BaseHTTPMiddleware):
    """Prometheus metrics middleware"""
    
    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip metrics endpoint
        if request.url.path == "/metrics":
            return await call_next(request)
        
        method = request.method
        endpoint = request.url.path
        
        # Increment active requests
        ACTIVE_REQUESTS.inc()
        
        # Start timer
        start_time = time.time()
        
        try:
            response = await call_next(request)
            
            # Record metrics
            REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=response.status_code).inc()
            REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(time.time() - start_time)
            
            return response
            
        finally:
            ACTIVE_REQUESTS.dec()

async def metrics_endpoint(request: Request):
    """Prometheus metrics endpoint"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)