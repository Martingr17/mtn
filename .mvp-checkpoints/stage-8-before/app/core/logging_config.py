import copy
import json
import logging
import logging.config
import os
from datetime import datetime

from app.config import settings
try:
    from pythonjsonlogger import jsonlogger
except ImportError:
    jsonlogger = None

if jsonlogger is not None:
    class CustomJsonFormatter(jsonlogger.JsonFormatter):
        """Custom JSON formatter for structured logging"""

        def add_fields(self, log_record, record, message_dict):
            super().add_fields(log_record, record, message_dict)
            log_record["timestamp"] = datetime.utcnow().isoformat()
            log_record["level"] = record.levelname
            log_record["logger"] = record.name
            log_record["module"] = record.module
            log_record["function"] = record.funcName
            log_record["line"] = record.lineno

            if hasattr(record, "request_id"):
                log_record["request_id"] = record.request_id
            if hasattr(record, "user_id"):
                log_record["user_id"] = record.user_id
            if hasattr(record, "ip_address"):
                log_record["ip_address"] = record.ip_address
else:
    class CustomJsonFormatter(logging.Formatter):
        """Fallback formatter when python-json-logger is unavailable."""

        def format(self, record):
            payload = {
                "timestamp": datetime.utcnow().isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "module": record.module,
                "function": record.funcName,
                "line": record.lineno,
                "message": record.getMessage(),
            }
            if hasattr(record, "request_id"):
                payload["request_id"] = record.request_id
            if hasattr(record, "user_id"):
                payload["user_id"] = record.user_id
            if hasattr(record, "ip_address"):
                payload["ip_address"] = record.ip_address
            if record.exc_info:
                payload["exc_info"] = self.formatException(record.exc_info)
            return json.dumps(payload, ensure_ascii=False)

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": CustomJsonFormatter,
            "format": "%(timestamp)s %(level)s %(name)s %(message)s",
        },
        "text": {
            "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "level": "INFO",
            "formatter": "json" if settings.log_format == "json" else "text",
            "stream": "ext://sys.stdout",
        },
        "file_app": {
            "class": "logging.handlers.RotatingFileHandler",
            "level": "DEBUG",
            "formatter": "json" if settings.log_format == "json" else "text",
            "filename": "logs/app.log",
            "maxBytes": settings.log_max_bytes,
            "backupCount": settings.log_backup_count,
        },
        "file_error": {
            "class": "logging.handlers.RotatingFileHandler",
            "level": "ERROR",
            "formatter": "json" if settings.log_format == "json" else "text",
            "filename": "logs/error.log",
            "maxBytes": settings.log_max_bytes,
            "backupCount": settings.log_backup_count,
        },
        "file_access": {
            "class": "logging.handlers.RotatingFileHandler",
            "level": "INFO",
            "formatter": "json" if settings.log_format == "json" else "text",
            "filename": "logs/access.log",
            "maxBytes": settings.log_max_bytes,
            "backupCount": settings.log_backup_count,
        },
    },
    "loggers": {
        "app": {
            "level": settings.log_level.value,
            "handlers": ["console", "file_app"],
            "propagate": False,
        },
        "uvicorn": {
            "level": "INFO",
            "handlers": ["console", "file_app"],
            "propagate": False,
        },
        "uvicorn.access": {
            "level": "INFO",
            "handlers": ["console", "file_access"],
            "propagate": False,
        },
        "sqlalchemy": {
            "level": "WARNING" if not settings.log_sql_queries else "DEBUG",
            "handlers": ["console", "file_app"],
            "propagate": False,
        },
        "sqlalchemy.engine": {
            "level": "WARNING" if not settings.log_sql_queries else "DEBUG",
            "handlers": ["console", "file_app"],
            "propagate": False,
        },
        "sqlalchemy.pool": {
            "level": "WARNING",
            "handlers": ["console", "file_app"],
            "propagate": False,
        },
        "celery": {
            "level": "INFO",
            "handlers": ["console", "file_app"],
            "propagate": False,
        },
    },
    "root": {
        "level": "WARNING",
        "handlers": ["console"],
    },
}

class RequestIdFilter(logging.Filter):
    """Add request ID to log records"""

    def filter(self, record):
        from contextvars import ContextVar
        request_id_var: ContextVar[str] = ContextVar("request_id", default="")
        record.request_id = request_id_var.get()
        return True

# Add filter to handlers
for handler in LOGGING_CONFIG["handlers"].values():
    if "filters" not in handler:
        handler["filters"] = []
    handler["filters"].append("request_id")

LOGGING_CONFIG["filters"] = {
    "request_id": {
        "()": RequestIdFilter,
    },
}


def _resolve_logging_config():
    config = copy.deepcopy(LOGGING_CONFIG)
    log_dir = os.path.dirname(settings.log_file) or "logs"

    try:
        os.makedirs(log_dir, exist_ok=True)
        probe_path = os.path.join(log_dir, ".write_test")
        with open(probe_path, "a", encoding="utf-8"):
            pass
        os.remove(probe_path)
        return config
    except OSError:
        file_handlers = {"file_app", "file_error", "file_access"}
        for handler_name in file_handlers:
            config["handlers"].pop(handler_name, None)
        for logger_config in config["loggers"].values():
            logger_config["handlers"] = [
                handler_name
                for handler_name in logger_config.get("handlers", [])
                if handler_name not in file_handlers
            ] or ["console"]
        return config


def setup_logging():
    """Configure logging"""
    logging.config.dictConfig(_resolve_logging_config())
    logger = logging.getLogger("app")
    logger.info("Logging configured successfully")
    return logger
