from functools import wraps
import time
import asyncio
import logging
from typing import Callable
from app.services.cache import redis_cache
from app.core.exceptions import RateLimitException

logger = logging.getLogger(__name__)

def retry(max_attempts: int = 3, delay: float = 1.0, backoff: float = 2.0):
    """Retry decorator for async functions"""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            current_delay = delay
            last_exception = None

            for attempt in range(max_attempts):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt == max_attempts - 1:
                        raise

                    logger.warning(f"Retry {attempt + 1}/{max_attempts} for {func.__name__}: {e}")
                    await asyncio.sleep(current_delay)
                    current_delay *= backoff

            raise last_exception
        return wrapper
    return decorator

def timed(log_level: int = logging.DEBUG):
    """Measure execution time of function"""
    def decorator(func: Callable):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            start = time.perf_counter()
            result = await func(*args, **kwargs)
            elapsed = (time.perf_counter() - start) * 1000
            logger.log(log_level, f"{func.__name__} took {elapsed:.2f}ms")
            return result

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            start = time.perf_counter()
            result = func(*args, **kwargs)
            elapsed = (time.perf_counter() - start) * 1000
            logger.log(log_level, f"{func.__name__} took {elapsed:.2f}ms")
            return result

        return async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper
    return decorator

def cache_result(ttl: int = 300, key_prefix: str = ""):
    """Cache function result in Redis"""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key
            key_parts = [key_prefix or func.__name__]
            key_parts.extend(str(arg) for arg in args)
            key_parts.extend(f"{k}:{v}" for k, v in sorted(kwargs.items()))
            cache_key = ":".join(key_parts)

            # Try to get from cache
            cached = await redis_cache.get(cache_key)
            if cached is not None:
                return cached

            # Execute function
            result = await func(*args, **kwargs)

            # Store in cache
            if result is not None:
                await redis_cache.set(cache_key, result, expire=ttl)

            return result
        return wrapper
    return decorator

def rate_limit(limit: int, window: int, key_func: Callable = None):
    """Rate limit decorator"""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get key
            if key_func:
                key = await key_func(*args, **kwargs)
            else:
                key = f"rate_limit:{func.__name__}"

            # Check rate limit
            current = await redis_cache.incr(key)
            if current == 1:
                await redis_cache.expire(key, window)

            if current > limit:
                raise RateLimitException(retry_after=window)

            return await func(*args, **kwargs)
        return wrapper
    return decorator

def log_call(log_args: bool = True, log_result: bool = False):
    """Log function calls"""
    def decorator(func: Callable):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            logger.info(f"Calling {func.__name__}")
            if log_args:
                logger.debug(f"Args: {args}, Kwargs: {kwargs}")

            try:
                result = await func(*args, **kwargs)
                if log_result:
                    logger.debug(f"Result: {result}")
                return result
            except Exception as e:
                logger.error(f"Error in {func.__name__}: {e}")
                raise

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            logger.info(f"Calling {func.__name__}")
            if log_args:
                logger.debug(f"Args: {args}, Kwargs: {kwargs}")

            try:
                result = func(*args, **kwargs)
                if log_result:
                    logger.debug(f"Result: {result}")
                return result
            except Exception as e:
                logger.error(f"Error in {func.__name__}: {e}")
                raise

        return async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper
    return decorator
