import json
from enum import Enum
from typing import List, Optional, Union, get_args, get_origin

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, EnvSettingsSource, PydanticBaseSettingsSource, SettingsConfigDict


LIST_LIKE_SETTINGS = {
    "celery_accept_content",
    "cors_origins",
    "cors_methods",
    "cors_headers",
    "trusted_hosts",
    "allowed_mime_types",
    "allowed_extensions",
    "operator_network_cidrs",
}


class LenientEnvSettingsSource(EnvSettingsSource):
    """Fall back to raw env strings when list-like settings are not valid JSON."""

    def prepare_field_value(self, field_name, field, value, value_is_complex):
        try:
            return super().prepare_field_value(field_name, field, value, value_is_complex)
        except ValueError:
            if field_name in LIST_LIKE_SETTINGS and isinstance(value, str):
                return value
            raise


class Environment(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class LogLevel(str, Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class DatabaseBackend(str, Enum):
    POSTGRES = "postgres"
    YDB = "ydb"


class YdbCredentialsMode(str, Enum):
    METADATA = "metadata"
    ACCESS_TOKEN = "access-token"
    SERVICE_ACCOUNT_FILE = "service-account-file"
    ANONYMOUS = "anonymous"


class Settings(BaseSettings):
    # Application
    app_name: str = "MTN | Martin Telecom Network"
    app_version: str = "2.0.0"
    environment: Environment = Environment.DEVELOPMENT
    debug: bool = False
    demo_mode: bool = False
    demo_show_sms_code: bool = False
    demo_show_email_code: bool = False
    demo_account_phone: str = "+79005553311"
    demo_account_billing_id: str = "DEMO90001"
    auto_schema_sync: bool = False
    secret_key: str = ""

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = 4
    reload: bool = False
    public_app_url: str = "http://localhost:8000"
    cloud_functions_mode: bool = False

    # Database backend
    database_backend: DatabaseBackend = DatabaseBackend.POSTGRES

    # PostgreSQL
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_user: str = "operator"
    postgres_password: str = "securepassword"
    postgres_db: str = "operator"
    postgres_pool_size: int = 20
    postgres_max_overflow: int = 10
    postgres_pool_timeout: int = 30
    postgres_pool_pre_ping: bool = True
    postgres_use_null_pool: bool = False
    postgres_ssl: bool = False

    # YDB serverless
    ydb_endpoint: str = "ydb.serverless.yandexcloud.net"
    ydb_port: int = 2135
    ydb_database: str = "/ru-central1/b1-example/etn-example"
    ydb_protocol: str = "grpcs"
    ydb_table_path_prefix: str = ""
    ydb_credentials_mode: YdbCredentialsMode = YdbCredentialsMode.METADATA
    ydb_access_token: str = ""
    ydb_service_account_key_file: str = ""

    @property
    def is_postgres(self) -> bool:
        return self.database_backend == DatabaseBackend.POSTGRES

    @property
    def is_ydb(self) -> bool:
        return self.database_backend == DatabaseBackend.YDB

    @property
    def database_url(self) -> str:
        if self.is_ydb:
            database_name = self.ydb_database.lstrip("/")
            return f"ydb_async://{self.ydb_endpoint}:{self.ydb_port}/{database_name}"

        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        if self.is_ydb:
            database_name = self.ydb_database.lstrip("/")
            return f"ydb://{self.ydb_endpoint}:{self.ydb_port}/{database_name}"

        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    def build_ydb_connect_args(self) -> dict:
        if not self.is_ydb:
            return {}

        import ydb

        credentials = None
        if self.ydb_credentials_mode == YdbCredentialsMode.METADATA:
            credentials = ydb.iam.MetadataUrlCredentials()
        elif self.ydb_credentials_mode == YdbCredentialsMode.ACCESS_TOKEN:
            credentials = ydb.AccessTokenCredentials(self.ydb_access_token)
        elif self.ydb_credentials_mode == YdbCredentialsMode.SERVICE_ACCOUNT_FILE:
            credentials = ydb.iam.ServiceAccountCredentials.from_file(
                self.ydb_service_account_key_file,
            )

        connect_args = {
            "database": self.ydb_database,
            "protocol": self.ydb_protocol,
        }
        if credentials is not None:
            connect_args["credentials"] = credentials
        if self.ydb_table_path_prefix:
            connect_args["ydb_table_path_prefix"] = self.ydb_table_path_prefix

        return connect_args

    # Redis
    redis_host: str = "redis"
    redis_port: int = 6379
    redis_password: Optional[str] = None
    redis_db: int = 0
    redis_ssl: bool = False

    @property
    def redis_url(self) -> str:
        auth = f":{self.redis_password}@" if self.redis_password else ""
        protocol = "rediss" if self.redis_ssl else "redis"
        return f"{protocol}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    # JWT
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    jwt_issuer: str = "operator-app"
    jwt_audience: str = "operator-clients"

    # Rate limiting
    rate_limit_enabled: bool = True
    rate_limit_default: str = "100/minute"
    rate_limit_auth: str = "5/minute"
    rate_limit_admin: str = "200/minute"

    # Billing API
    billing_api_url: str = "https://billing.operator.ru/api/v2"
    billing_api_key: str = ""
    billing_timeout: int = 10
    billing_retry_attempts: int = 3
    billing_retry_delay: int = 1

    # YooKassa
    ykassa_shop_id: str = ""
    ykassa_secret_key: str = ""
    ykassa_webhook_secret: str = ""
    ykassa_return_url: str = "https://lk.operator.ru/payments/success"
    ykassa_test_mode: bool = False

    # Stripe Checkout
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""

    # SMS Gateway
    sms_provider: str = "mock"
    sms_api_url: str = "https://sms.ru/sms/send"
    sms_api_key: str = ""
    sms_from: str = "OPERATOR"

    # Email (SMTP)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@operator.ru"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    email_otp_length: int = 6
    email_otp_ttl_seconds: int = 600
    email_otp_resend_cooldown_seconds: int = 60
    email_otp_max_attempts: int = 5
    email_otp_max_sends_per_hour: int = 5

    # Celery
    celery_broker_url: str = ""
    celery_result_backend: str = ""
    celery_task_always_eager: bool = False
    celery_task_eager_propagates: bool = True
    celery_task_serializer: str = "json"
    celery_result_serializer: str = "json"
    celery_accept_content: List[str] = ["json"]
    celery_timezone: str = "Europe/Moscow"
    celery_enable_utc: bool = False

    @field_validator("celery_broker_url", mode="before")
    @classmethod
    def set_celery_broker_url(cls, value: str, info):
        if not value and info.data.get("redis_url"):
            return f"{info.data['redis_url']}/1"
        return value

    @staticmethod
    def _coerce_list(value):
        if isinstance(value, list):
            return value
        if not isinstance(value, str):
            return value

        raw = value.strip()
        if not raw:
            return []

        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

        if raw.startswith("[") and raw.endswith("]"):
            raw = raw[1:-1]

        parts = [part.strip().strip('"').strip("'") for part in raw.split(",")]
        return [part for part in parts if part]

    @field_validator("celery_result_backend", mode="before")
    @classmethod
    def set_celery_result_backend(cls, value: str, info):
        if not value and info.data.get("redis_url"):
            return f"{info.data['redis_url']}/2"
        return value

    @field_validator("*", mode="before")
    @classmethod
    def parse_bool_settings(cls, value, info):
        field = cls.model_fields[info.field_name]
        field_type = field.annotation
        if field_type is bool or get_origin(field_type) is bool or (
            get_origin(field_type) is Union and bool in get_args(field_type)
        ):
            if isinstance(value, str):
                normalized = value.strip().lower()
                if normalized in {"true", "1", "yes", "y", "on"}:
                    return True
                if normalized in {"false", "0", "no", "n", "off"}:
                    return False
                return field.default
        return value

    @field_validator(*LIST_LIKE_SETTINGS, mode="before")
    @classmethod
    def parse_list_settings(cls, value):
        return cls._coerce_list(value)

    # File upload
    upload_dir: str = "uploads/attachments"
    max_upload_size: int = 10 * 1024 * 1024
    allowed_mime_types: List[str] = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]
    allowed_extensions: List[str] = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".pdf",
        ".txt",
        ".doc",
        ".docx",
    ]

    # Security
    bcrypt_rounds: int = 12
    session_ttl_hours: int = 24
    max_login_attempts: int = 5
    lockout_minutes: int = 15
    password_min_length: int = 8
    password_require_uppercase: bool = True
    password_require_lowercase: bool = True
    password_require_digits: bool = True
    password_require_special: bool = True

    # CORS
    cors_origins: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
        "https://lk.operator.ru",
        "https://mtn.website.yandexcloud.net",
    ]
    cors_credentials: bool = True
    cors_methods: List[str] = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    cors_headers: List[str] = ["*"]
    trusted_hosts: List[str] = [
        "lk.operator.ru",
        "mtn.website.yandexcloud.net",
        "localhost",
        "127.0.0.1",
    ]

    # Monitoring
    prometheus_enabled: bool = True
    prometheus_port: int = 9090
    sentry_dsn: Optional[str] = None
    newrelic_license_key: Optional[str] = None

    # Backup
    backup_enabled: bool = True
    backup_path: str = "/backups"
    backup_schedule: str = "0 2 * * *"
    backup_retention_days: int = 30
    backup_s3_bucket: Optional[str] = None
    backup_s3_access_key: Optional[str] = None
    backup_s3_secret_key: Optional[str] = None
    backup_s3_region: str = "ru-central1"

    # Logging
    log_level: LogLevel = LogLevel.INFO
    log_format: str = "json"
    log_file: str = "logs/app.log"
    log_max_bytes: int = 50 * 1024 * 1024
    log_backup_count: int = 10
    log_sql_queries: bool = False

    # Feature flags
    enable_websockets: bool = True
    enable_2fa: bool = True
    enable_captcha: bool = True
    enable_export: bool = True
    enable_import: bool = True
    enable_analytics: bool = True
    enable_mobile_api: bool = True

    # Cache
    cache_ttl_tariffs: int = 3600
    cache_ttl_balance: int = 300
    cache_ttl_tickets: int = 60

    # Speedtest
    speedtest_max_per_hour: int = 5
    speedtest_session_ttl_seconds: int = 180
    speedtest_download_size_mb: int = 8
    speedtest_upload_size_mb: int = 4
    speedtest_enforce_operator_network: bool = False
    operator_network_cidrs: List[str] = [
        "127.0.0.1/32",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
    ]

    # Connection quality monitoring
    monitoring_enabled: bool = True
    monitoring_collection_interval_minutes: int = 5
    monitoring_speed_sample_interval_minutes: int = 15
    monitoring_retention_days: int = 30
    monitoring_alert_cooldown_minutes: int = 30
    monitoring_ping_samples: int = 5
    monitoring_embed_scheduler: bool = False

    # Notifications
    notifications_retention_days: int = 60
    notifications_polling_interval_seconds: int = 45
    notifications_external_api_key: str = ""
    webpush_vapid_public_key: str = ""
    webpush_vapid_private_key: str = ""
    webpush_vapid_subject: str = "mailto:support@mtn.local"
    telegram_alerts_enabled: bool = False
    telegram_bot_token: str = ""
    telegram_noc_chat_id: str = ""
    telegram_mock_mode: bool = True

    # Pagination
    default_page_size: int = 20
    max_page_size: int = 100

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ):
        return (
            init_settings,
            LenientEnvSettingsSource(settings_cls),
            dotenv_settings,
            file_secret_settings,
        )

    @model_validator(mode="after")
    def validate_production_requirements(self):
        if self.environment != Environment.PRODUCTION:
            return self

        required_values = {
            "secret_key": self.secret_key,
            "jwt_secret_key": self.jwt_secret_key,
            "billing_api_key": self.billing_api_key,
        }
        missing = [name for name, value in required_values.items() if not value]
        if missing:
            raise ValueError(
                f"Production configuration requires non-empty values for: {', '.join(missing)}",
            )

        insecure_values = {
            "dev_secret_key_12345678901234567890",
            "dev_jwt_secret_key_12345678901234567890",
            "dev_billing_api_key_12345678901234567890",
            "supersecretkey12345678901234567890",
            "jwtsecretkey12345678901234567890",
            "12345678901234567890123456789012",
        }
        if (
            self.secret_key in insecure_values
            or self.jwt_secret_key in insecure_values
            or self.billing_api_key in insecure_values
        ):
            raise ValueError("Production secrets and API keys must not use repository defaults")

        if self.debug:
            raise ValueError("Production mode requires DEBUG=false")
        if self.reload:
            raise ValueError("Production mode requires RELOAD=false")
        if self.demo_mode or self.demo_show_sms_code or self.demo_show_email_code:
            raise ValueError("Production mode must not expose demo mode or verification codes")

        if self.is_ydb and self.ydb_credentials_mode == YdbCredentialsMode.ACCESS_TOKEN and not self.ydb_access_token:
            raise ValueError("YDB access-token mode requires YDB_ACCESS_TOKEN")
        if (
            self.is_ydb
            and self.ydb_credentials_mode == YdbCredentialsMode.SERVICE_ACCOUNT_FILE
            and not self.ydb_service_account_key_file
        ):
            raise ValueError("YDB service-account-file mode requires YDB_SERVICE_ACCOUNT_KEY_FILE")

        return self


settings = Settings()
