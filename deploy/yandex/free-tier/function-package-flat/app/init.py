"""Operator Self-Service Portal Application"""

__version__ = "2.0.0"
__author__ = "Operator Team"
__description__ = "Web application for subscribers to interact with telecom operator"

from app.config import settings
from app.database import engine, Base, get_db

__all__ = [
    "settings",
    "engine",
    "Base",
    "get_db",
    "__version__",
]
