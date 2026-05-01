from enum import Enum, IntEnum
from typing import Dict

class UserRole(str, Enum):
    USER = "user"
    OPERATOR = "operator"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

    @classmethod
    def get_permissions(cls, role: "UserRole") -> Dict[str, bool]:
        permissions = {
            "view_dashboard": True,
            "view_tariffs": True,
            "change_tariff": True,
            "view_payments": True,
            "create_payment": True,
            "view_tickets": True,
            "create_ticket": True,
            "reply_ticket": False,
            "view_statistics": True,
            "view_admin_panel": False,
            "manage_users": False,
            "manage_tariffs": False,
            "manage_tickets": False,
            "view_logs": False,
            "manage_system": False,
        }

        if role in [UserRole.OPERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN]:
            permissions["reply_ticket"] = True
            permissions["view_admin_panel"] = True
            permissions["manage_tickets"] = True

        if role in [UserRole.ADMIN, UserRole.SUPER_ADMIN]:
            permissions["manage_users"] = True
            permissions["view_logs"] = True

        if role == UserRole.SUPER_ADMIN:
            permissions["manage_tariffs"] = True
            permissions["manage_system"] = True

        return permissions

class TicketStatus(str, Enum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    WAITING_CUSTOMER = "waiting_customer"
    RESOLVED = "resolved"
    CLOSED = "closed"
    ESCALATED = "escalated"

    @classmethod
    def get_color(cls, status: "TicketStatus") -> str:
        colors = {
            cls.NEW: "#10B981",  # green
            cls.IN_PROGRESS: "#3B82F6",  # blue
            cls.WAITING_CUSTOMER: "#F59E0B",  # yellow
            cls.RESOLVED: "#8B5CF6",  # purple
            cls.CLOSED: "#6B7280",  # gray
            cls.ESCALATED: "#EF4444",  # red
        }
        return colors.get(status, "#6B7280")

class TicketPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"
    CRITICAL = "critical"

    @classmethod
    def get_sla_hours(cls, priority: "TicketPriority") -> int:
        sla = {
            cls.LOW: 48,
            cls.MEDIUM: 24,
            cls.HIGH: 8,
            cls.URGENT: 4,
            cls.CRITICAL: 1,
        }
        return sla.get(priority, 24)

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"

class NotificationType(str, Enum):
    EMAIL = "email"
    SMS = "sms"
    PUSH = "push"
    TELEGRAM = "telegram"
    WHATSAPP = "whatsapp"

class NotificationPriority(IntEnum):
    LOW = 0
    NORMAL = 1
    HIGH = 2
    URGENT = 3

class ActionType(str, Enum):
    # Auth actions
    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    REGISTER = "register"
    PASSWORD_CHANGE = "password_change"
    PASSWORD_RESET = "password_reset"

    # User actions
    PROFILE_UPDATE = "profile_update"
    PROFILE_VIEW = "profile_view"

    # Tariff actions
    TARIFF_VIEW = "tariff_view"
    TARIFF_CHANGE = "tariff_change"

    # Payment actions
    PAYMENT_CREATE = "payment_create"
    PAYMENT_SUCCESS = "payment_success"
    PAYMENT_FAIL = "payment_fail"

    # Ticket actions
    TICKET_CREATE = "ticket_create"
    TICKET_VIEW = "ticket_view"
    TICKET_REPLY = "ticket_reply"
    TICKET_CLOSE = "ticket_close"
    TICKET_ESCALATE = "ticket_escalate"

    # Admin actions
    ADMIN_USER_BLOCK = "admin_user_block"
    ADMIN_USER_UNBLOCK = "admin_user_unblock"
    ADMIN_TARIFF_FORCE_CHANGE = "admin_tariff_force_change"
    ADMIN_TICKET_ASSIGN = "admin_ticket_assign"
    ADMIN_TICKET_RESOLVE = "admin_ticket_resolve"
    ADMIN_SETTINGS_CHANGE = "admin_settings_change"

    # System actions
    BACKUP_CREATED = "backup_created"
    BACKUP_RESTORED = "backup_restored"
    SYSTEM_ERROR = "system_error"

class HTTPStatusCodes(IntEnum):
    # 2xx Success
    OK = 200
    CREATED = 201
    ACCEPTED = 202
    NO_CONTENT = 204

    # 3xx Redirection
    MOVED_PERMANENTLY = 301
    FOUND = 302
    SEE_OTHER = 303
    NOT_MODIFIED = 304

    # 4xx Client Errors
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    PAYMENT_REQUIRED = 402
    FORBIDDEN = 403
    NOT_FOUND = 404
    METHOD_NOT_ALLOWED = 405
    CONFLICT = 409
    TOO_MANY_REQUESTS = 429

    # 5xx Server Errors
    INTERNAL_SERVER_ERROR = 500
    NOT_IMPLEMENTED = 501
    BAD_GATEWAY = 502
    SERVICE_UNAVAILABLE = 503
    GATEWAY_TIMEOUT = 504

class CacheKeys:
    USER_PREFIX = "user:"
    TARIFFS_LIST = "tariffs:list"
    TARIFF_DETAIL = "tariff:"
    USER_BALANCE = "user_balance:"
    USER_TARIFF = "user_tariff:"
    USER_SESSION = "session:"
    SMS_CODE = "sms_code:"
    LOGIN_ATTEMPTS = "login_attempts:"
    RATE_LIMIT = "rate_limit:"
    TOKEN_BLACKLIST = "token_blacklist:"
    TICKET_LOCK = "ticket_lock:"

    @classmethod
    def user_key(cls, user_id: int) -> str:
        return f"{cls.USER_PREFIX}{user_id}"

    @classmethod
    def tariff_detail_key(cls, tariff_id: int) -> str:
        return f"{cls.TARIFF_DETAIL}{tariff_id}"

    @classmethod
    def user_balance_key(cls, user_id: int) -> str:
        return f"{cls.USER_BALANCE}{user_id}"

    @classmethod
    def user_tariff_key(cls, user_id: int) -> str:
        return f"{cls.USER_TARIFF}{user_id}"
