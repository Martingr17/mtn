from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db
from app.services.cache import redis_cache
from app.config import settings
from datetime import datetime
import psutil
import os

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Basic health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": settings.app_version,
        "environment": settings.environment.value
    }

@router.get("/detailed")
async def detailed_health_check(db: AsyncSession = Depends(get_db)):
    """Detailed health check with all dependencies"""
    status = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "checks": {}
    }
    
    # Check database
    try:
        await db.execute(text("SELECT 1"))
        status["checks"]["database"] = {"status": "healthy", "message": "Connected"}
    except Exception as e:
        status["checks"]["database"] = {"status": "unhealthy", "message": str(e)}
        status["status"] = "unhealthy"
    
    # Check Redis
    try:
        await redis_cache.client.ping()
        status["checks"]["redis"] = {"status": "healthy", "message": "Connected"}
    except Exception as e:
        status["checks"]["redis"] = {"status": "unhealthy", "message": str(e)}
        status["status"] = "unhealthy"
    
    # Check disk space
    disk_usage = psutil.disk_usage('/')
    disk_free_percent = 100 - disk_usage.percent
    if disk_free_percent < 10:
        status["checks"]["disk"] = {"status": "warning", "message": f"Low disk space: {disk_free_percent:.1f}% free"}
    else:
        status["checks"]["disk"] = {"status": "healthy", "message": f"{disk_free_percent:.1f}% free"}
    
    # Check memory
    memory = psutil.virtual_memory()
    if memory.percent > 90:
        status["checks"]["memory"] = {"status": "warning", "message": f"High memory usage: {memory.percent}%"}
    else:
        status["checks"]["memory"] = {"status": "healthy", "message": f"{memory.percent}% used"}
    
    # Check CPU
    cpu_percent = psutil.cpu_percent(interval=1)
    if cpu_percent > 80:
        status["checks"]["cpu"] = {"status": "warning", "message": f"High CPU usage: {cpu_percent}%"}
    else:
        status["checks"]["cpu"] = {"status": "healthy", "message": f"{cpu_percent}% used"}
    
    return status

@router.get("/readiness")
async def readiness_check(db: AsyncSession = Depends(get_db)):
    """Readiness probe for k8s"""
    try:
        await db.execute(text("SELECT 1"))
        await redis_cache.client.ping()
        return {"status": "ready"}
    except Exception:
        return {"status": "not ready"}, 503

@router.get("/liveness")
async def liveness_check():
    """Liveness probe for k8s"""
    return {"status": "alive"}