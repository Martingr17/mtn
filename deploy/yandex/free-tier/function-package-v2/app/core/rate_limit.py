import time
from typing import Optional, Tuple
from app.services.cache import redis_cache
import logging

logger = logging.getLogger(__name__)

class RateLimiter:
    """Rate limiter using Redis sliding window algorithm"""
    
    def __init__(self, redis_client=None):
        self.redis = redis_client or redis_cache.client
    
    async def is_allowed(self, key: str, limit: int, window: int) -> Tuple[bool, int]:
        """
        Check if request is allowed
        Returns: (allowed, retry_after_seconds)
        """
        now = int(time.time())
        window_start = now - window
        
        redis_key = f"rate_limit:{key}"
        
        try:
            # Remove old entries
            await self.redis.zremrangebyscore(redis_key, 0, window_start)
            
            # Count current requests
            count = await self.redis.zcard(redis_key)
            
            if count >= limit:
                # Get oldest request timestamp to calculate retry after
                oldest = await self.redis.zrange(redis_key, 0, 0, withscores=True)
                if oldest:
                    retry_after = window - (now - int(oldest[0][1]))
                    return False, max(1, retry_after)
                return False, window
            
            # Add current request
            await self.redis.zadd(redis_key, {str(now): now})
            await self.redis.expire(redis_key, window)
            
            return True, 0
            
        except Exception as e:
            logger.error(f"Rate limiter error: {e}")
            return True, 0  # Allow on error

class UserRateLimiter:
    """Rate limiter per user"""
    
    def __init__(self):
        self.limiter = RateLimiter()
        self.limits = {
            "login": (5, 60),           # 5 attempts per minute
            "register": (3, 3600),       # 3 attempts per hour
            "payment": (10, 3600),       # 10 payments per hour
            "ticket": (20, 3600),        # 20 tickets per hour
            "api": (100, 60),            # 100 requests per minute
            "admin": (200, 60),          # 200 requests per minute
            "sms": (3, 300),             # 3 SMS per 5 minutes
            "password_reset": (3, 3600), # 3 attempts per hour
        }
    
    async def check(self, user_id: int, action: str) -> Tuple[bool, int]:
        """Check rate limit for user action"""
        limit_config = self.limits.get(action, self.limits["api"])
        key = f"{action}:user:{user_id}"
        return await self.limiter.is_allowed(key, limit_config[0], limit_config[1])
    
    async def check_ip(self, ip: str, action: str) -> Tuple[bool, int]:
        """Check rate limit by IP address"""
        limit_config = self.limits.get(action, self.limits["api"])
        key = f"{action}:ip:{ip}"
        return await self.limiter.is_allowed(key, limit_config[0], limit_config[1])

rate_limiter = UserRateLimiter()