from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, HTMLResponse
from app.services.cache import redis_cache
from app.config import settings
import json

class MaintenanceMiddleware(BaseHTTPMiddleware):
    """Middleware для режима обслуживания"""
    
    async def dispatch(self, request: Request, call_next) -> Response:
        # Check if maintenance mode is enabled
        maintenance_mode = await redis_cache.get("system:maintenance_mode", False)
        system_settings = await redis_cache.get("system:settings", {})
        
        if maintenance_mode:
            # Skip for admin endpoints and health check
            if request.url.path.startswith("/api/v1/admin") or \
               request.url.path.startswith("/health") or \
               request.url.path.startswith("/metrics"):
                return await call_next(request)
            
            # Get maintenance message
            message = system_settings.get(
                "maintenance_message",
                "Сервис временно обновляется. Мы уже чиним. Загляните через 10 минут.",
            )
            message = await redis_cache.get("system:maintenance_message", "Система на техническом обслуживании")
            
            message = system_settings.get("maintenance_message", message)

            # Check if client accepts JSON
            if request.headers.get("accept", "").find("application/json") != -1:
                return JSONResponse(
                    status_code=503,
                    content={"detail": message, "maintenance": True}
                )
            
            # Return HTML maintenance page
            html_content = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Технические работы</title>
                <style>
                    body {{
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                    }}
                    .container {{
                        text-align: center;
                        padding: 20px;
                    }}
                    h1 {{ font-size: 48px; margin-bottom: 20px; }}
                    p {{ font-size: 18px; opacity: 0.9; }}
                    .icon {{ font-size: 80px; margin-bottom: 20px; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">🔧</div>
                    <h1>Технические работы</h1>
                    <p>{message}</p>
                    <p>Пожалуйста, зайдите позже.</p>
                </div>
            </body>
            </html>
            """
            return HTMLResponse(content=html_content, status_code=503)
        
        return await call_next(request)
