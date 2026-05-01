from contextlib import asynccontextmanager, suppress
import asyncio
import os
import traceback
from typing import Optional
from urllib.parse import quote

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from prometheus_client import make_asgi_app
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from app.api.v1.endpoints import monitoring, notifications, speedtest
from app.api.v1.endpoints.websocket import websocket_endpoint
from app.api.v1.router import api_router
from app.config import settings
from app.core.logging_config import setup_logging
from app.core.middleware import (
    CompressionMiddleware,
    RateLimitMiddleware,
    RequestIDMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)
from app.database import AsyncSessionLocal, engine, init_db
from app.dependencies import get_optional_current_user
from app.middleware.metrics import MetricsMiddleware
from app.models import User, UserRole
from app.services.demo_bootstrap import bootstrap_demo_content
from app.services.metrics_collector import scheduled_metrics_collection
from app.site_content import SITE_CONTENT_PAGES
from app.middleware.maintenance import MaintenanceMiddleware

logger = setup_logging()
ASSET_VERSION = "20260411-auth-suite-v80"

CONTENT_PAGES = {
    "about": {
        "page_title": "О компании MTN",
        "page_lead": "Martin Telecom Network объединяет мобильную связь, домашний интернет, телевидение, поддержку и цифровое самообслуживание в одной понятной системе.",
        "sections": [
            {
                "title": "Надёжный оператор без лишней сложности",
                "body": "MTN строит сервис вокруг скорости принятия решения пользователем: баланс, тариф, платежи, заявки и история действий доступны из одного кабинета без запутанных сценариев.",
            },
            {
                "title": "Технологичность с человеческим лицом",
                "body": "Мы делаем интерфейсы прозрачными, а сервисные процессы — предсказуемыми. Пользователь видит, что происходит с его услугами, и получает понятные статусы без необходимости звонить в контакт-центр.",
            },
            {
                "title": "Продукт для частных и бизнес-клиентов",
                "body": "Платформа MTN рассчитана на частных абонентов, семьи и компании. Структура кабинета уже поддерживает пользовательские и операторские сценарии, а также внутренний Speedtest и мониторинг сервисов.",
            },
        ],
    },
    "contacts": {
        "page_title": "Контакты",
        "page_lead": "Все ключевые каналы связи с MTN собраны в одном месте, чтобы клиент быстро выбрал удобный способ обращения.",
        "sections": [
            {
                "title": "Поддержка абонентов",
                "body": "Горячая линия MTN: +7 (800) 555-00-77. Онлайн-заявки и переписка с оператором доступны в личном кабинете круглосуточно.",
            },
            {
                "title": "Почта и документы",
                "body": "Общие вопросы: support@mtn.example. Для договоров, реквизитов и официальной переписки используйте форму обращения или запрос через поддержку.",
            },
            {
                "title": "Офис",
                "body": "Москва, Пресненская набережная, 8. Визит по документальным вопросам лучше согласовать заранее через поддержку или личный кабинет.",
            },
        ],
    },
    "help": {
        "page_title": "Помощь и FAQ",
        "page_lead": "Основные инструкции MTN: как оплатить услуги, настроить оборудование и решить частые проблемы без лишних поисков по сайту.",
        "sections": [
            {
                "title": "Оплата",
                "body": "Пополнение доступно банковской картой и через СБП. После подтверждения операции баланс обновляется автоматически, а история платежей сохраняется в кабинете.",
            },
            {
                "title": "Настройка оборудования",
                "body": "Если вы подключаете интернет или настраиваете Wi-Fi дома, проверьте базовые инструкции по роутеру и убедитесь, что тариф активен, а баланс положительный.",
            },
            {
                "title": "Типовые проблемы",
                "body": "Если интернет нестабилен, пропал сигнал или не открывается ТВ, сначала проверьте статус услуги, затем выполните Speedtest и при необходимости создайте заявку с описанием проблемы.",
            },
        ],
    },
    "help_payment": {
        "page_title": "Как оплатить",
        "page_lead": "Пошаговый сценарий пополнения баланса в MTN: быстро, понятно и без лишних переходов.",
        "sections": [
            {
                "title": "Выберите сумму",
                "body": "Используйте готовые пресеты или введите свою сумму. Минимальный платёж — 10 ₽. Комиссия со стороны MTN не взимается.",
            },
            {
                "title": "Подтвердите способ оплаты",
                "body": "Оплата поддерживается банковской картой и СБП. После создания платежа система переводит на безопасный checkout-сценарий.",
            },
            {
                "title": "Когда придут деньги",
                "body": "Обычно средства зачисляются в течение 1–2 минут. Если платёж завершён, но баланс не изменился, запись всё равно останется в истории операций.",
            },
        ],
    },
    "help_setup": {
        "page_title": "Настройка оборудования",
        "page_lead": "Базовые рекомендации по роутеру, Wi-Fi и домашней сети, чтобы пользователь мог быстро восстановить связь.",
        "sections": [
            {
                "title": "Проверка подключения",
                "body": "Убедитесь, что кабель подключён в нужный порт, индикаторы на роутере активны, а само устройство перезагружено после смены настроек.",
            },
            {
                "title": "Настройка Wi-Fi",
                "body": "Рекомендуем задать уникальное имя сети, сложный пароль и по возможности использовать диапазон 5 ГГц для устройств рядом с роутером.",
            },
            {
                "title": "Когда нужен оператор",
                "body": "Если проблема сохраняется после базовой проверки, выполните Speedtest и приложите результат к заявке. Это помогает оператору быстрее локализовать причину.",
            },
        ],
    },
    "help_problems": {
        "page_title": "Частые проблемы",
        "page_lead": "Собрали типовые ситуации, которые можно проверить самостоятельно за пару минут до обращения в поддержку.",
        "sections": [
            {
                "title": "Нет интернета",
                "body": "Проверьте баланс, статус услуги, индикаторы оборудования и перезапустите роутер. Если соединение не восстановилось, создайте заявку из кабинета.",
            },
            {
                "title": "Скорость ниже ожидаемой",
                "body": "Запустите встроенный Speedtest MTN. Он покажет скорость скачивания, отдачи, пинг и историю тестов, чтобы можно было сравнить результаты по времени.",
            },
            {
                "title": "Не работает ТВ или сервис",
                "body": "Убедитесь, что услуга активна, устройство подключено к нужной сети и на аккаунте нет задолженности. При необходимости приложите фото ошибки в заявку.",
            },
        ],
    },
    "support": {
        "page_title": "Поддержка",
        "page_lead": "Поддержка MTN строится вокруг прозрачного цифрового сценария: заявка, чат с оператором, статусы, история и уведомления в одном месте.",
        "sections": [
            {
                "title": "Как быстро решить вопрос",
                "body": "Создайте заявку в кабинете, кратко опишите проблему и при необходимости приложите файл. Оператор ответит в той же карточке, без повторного объяснения ситуации.",
            },
            {
                "title": "Что удобно делать онлайн",
                "body": "Через кабинет удобно решать вопросы по интернету, скорости, платежам, тарифам и оборудованию. Статус каждого обращения виден в реальном времени.",
            },
            {
                "title": "Прозрачность работы",
                "body": "После создания обращения система сохраняет контекст и показывает каждый этап: когда ответил оператор, что изменилось и какие действия требуются дальше.",
            },
        ],
    },
    "terms": {
        "page_title": "Условия использования",
        "page_lead": "Коротко и по делу о том, как работает личный кабинет MTN и какие действия доступны пользователю.",
        "sections": [
            {
                "title": "Назначение кабинета",
                "body": "Кабинет предназначен для управления услугами связи, просмотра баланса, выбора тарифов, оплаты, создания заявок и настройки профиля в едином цифровом пространстве.",
            },
            {
                "title": "Доступ и безопасность",
                "body": "Пользователь отвечает за сохранность номера телефона, кода подтверждения и данных входа. При подозрительной активности рекомендуется завершить лишние сессии и сменить пароль.",
            },
            {
                "title": "Внешние сервисы",
                "body": "Часть функций зависит от биллинга, платёжного шлюза и каналов уведомлений. Если внешний сервис временно недоступен, кабинет старается сохранить сценарий и показать понятную ошибку.",
            },
        ],
    },
    "privacy": {
        "page_title": "Конфиденциальность",
        "page_lead": "Личный кабинет MTN использует только те данные, которые реально нужны для авторизации, оплаты, поддержки и персонализации интерфейса.",
        "sections": [
            {
                "title": "Какие данные используются",
                "body": "Телефон, лицевой счёт, контактные данные, события авторизации, платежи, уведомления и данные по заявкам используются только для работы кабинета и сервисных процессов.",
            },
            {
                "title": "Зачем это нужно",
                "body": "Эти данные позволяют показывать статус услуг, защищать вход, формировать уведомления и делать взаимодействие с сервисом быстрее и прозрачнее.",
            },
            {
                "title": "Что контролирует пользователь",
                "body": "Пользователь может обновлять профиль, управлять сессиями, менять пароль, выбирать каналы уведомлений и отслеживать активность внутри собственного аккаунта.",
            },
        ],
    },
}

CONTENT_PAGES = SITE_CONTENT_PAGES


async def ensure_runtime_schema() -> None:
    if not settings.is_postgres:
        logger.info("Skipping runtime DDL because database backend is %s", settings.database_backend.value)
        return

    statements = (
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512)",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ",
        "ALTER TABLE payments_log ADD COLUMN IF NOT EXISTS payment_url VARCHAR(512)",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_type VARCHAR(50) NOT NULL DEFAULT 'info'",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'system'",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ",
        "ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS site_enabled BOOLEAN NOT NULL DEFAULT TRUE",
        """ALTER TABLE notification_settings
           ADD COLUMN IF NOT EXISTS enabled_event_types JSONB NOT NULL
           DEFAULT '["connection_issues","maintenance","news","tariff_changes","payment","tickets"]'::jsonb""",
        "ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS quiet_hours_start TIME",
        "ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS quiet_hours_end TIME",
        """UPDATE notification_settings
           SET enabled_event_types = '["connection_issues","maintenance","news","tariff_changes","payment","tickets"]'::jsonb
           WHERE enabled_event_types IS NULL""",
        """CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint VARCHAR(500) NOT NULL UNIQUE,
            p256dh_key VARCHAR(200) NOT NULL,
            auth_key VARCHAR(100) NOT NULL,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        )""",
        "CREATE INDEX IF NOT EXISTS idx_notifications_archived ON notifications (is_archived)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_event_type ON notifications (event_type)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications (category)",
        "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active ON push_subscriptions (user_id, is_active)",
    )

    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Запуск %s v%s", settings.app_name, settings.app_version)
    if settings.auto_schema_sync:
        await init_db()
        if settings.is_postgres:
            await ensure_runtime_schema()
        logger.info("Runtime schema sync is enabled")
    else:
        logger.info("Runtime schema sync is disabled; relying on Alembic migrations")

    if settings.demo_mode:
        async with AsyncSessionLocal() as session:
            await bootstrap_demo_content(session)

    metrics_task: Optional[asyncio.Task] = None
    if settings.monitoring_embed_scheduler and not settings.cloud_functions_mode:
        metrics_task = asyncio.create_task(scheduled_metrics_collection())
    yield
    logger.info("Остановка приложения")
    if metrics_task:
        metrics_task.cancel()
        with suppress(asyncio.CancelledError):
            await metrics_task
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

app.add_middleware(RequestIDMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CompressionMiddleware)
app.add_middleware(MetricsMiddleware)
app.add_middleware(MaintenanceMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_credentials,
    allow_methods=settings.cors_methods,
    allow_headers=settings.cors_headers,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"] if settings.debug else settings.trusted_hosts,
)

app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))
templates.env.globals["_"] = lambda value: value

app.include_router(api_router, prefix="/api/v1")
app.include_router(speedtest.router, prefix="/api")
app.include_router(monitoring.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(notifications.admin_router, prefix="/api")
if settings.enable_websockets and not settings.cloud_functions_mode:
    app.add_api_websocket_route("/ws", websocket_endpoint)
else:
    logger.info("WebSocket route is disabled for the current deployment profile")


def render_page(request: Request, template_name: str, **context):
    status_code = int(context.pop("status_code", 200))
    demo_staff_accounts = []
    demo_staff_aliases = []
    if settings.demo_mode:
        demo_staff_accounts = [
            {
                "label": "Оператор",
                "phone": "+79005550077",
                "password": "OperatorDemo2026!",
                "role": "operator",
            },
            {
                "label": "Суперадмин",
                "phone": "+79005550099",
                "password": "SuperAdminDemo2026!",
                "role": "super_admin",
            },
        ]
        demo_staff_aliases = [
            {
                "label": "Администратор",
                "email": "admin@mtn.ru",
                "password": "admin123",
                "phone": "+79005550099",
                "actual_password": "SuperAdminDemo2026!",
                "role": "admin",
            },
            {
                "label": "Оператор",
                "email": "operator@mtn.ru",
                "password": "operator123",
                "phone": "+79005550077",
                "actual_password": "OperatorDemo2026!",
                "role": "operator",
            },
        ]

    base_context = {
        "request": request,
        "asset_version": ASSET_VERSION,
        "demo_mode": settings.demo_mode,
        "demo_account_phone": settings.demo_account_phone,
        "demo_account_billing_id": settings.demo_account_billing_id,
        "demo_staff_accounts": demo_staff_accounts,
        "demo_staff_aliases": demo_staff_aliases,
    }
    base_context.update(context)
    return templates.TemplateResponse(template_name, base_context, status_code=status_code)


def render_content_page(request: Request, content_key: str):
    return render_page(request, "content_page.html", **CONTENT_PAGES[content_key])


def render_spa_index() -> FileResponse:
    spa_index = os.path.join(BASE_DIR, "static", "spa", "index.html")
    return FileResponse(spa_index)


def _role_value(role: object) -> str:
    return role.value if hasattr(role, "value") else str(role)


def _is_staff_user(user: Optional[User]) -> bool:
    if not user:
        return False
    return _role_value(user.role) in {
        _role_value(UserRole.ADMIN),
        _role_value(UserRole.OPERATOR),
        _role_value(UserRole.SUPER_ADMIN),
    }


def redirect_to_login(request: Request) -> RedirectResponse:
    next_path = request.url.path
    if request.url.query:
        next_path = f"{next_path}?{request.url.query}"
    login_path = "/admin/login" if request.url.path.startswith("/admin") else "/login"
    return RedirectResponse(url=f"{login_path}?next={quote(next_path, safe='/%?=&')}", status_code=302)


def require_private_page(request: Request, current_user: Optional[User]) -> Optional[RedirectResponse]:
    if current_user is None:
        return redirect_to_login(request)
    return None


def require_admin_page(request: Request, current_user: Optional[User]) -> Optional[RedirectResponse]:
    if current_user is None:
        return redirect_to_login(request)
    if not _is_staff_user(current_user):
        return RedirectResponse(url="/dashboard", status_code=302)
    return None


def require_admin_only_page(request: Request, current_user: Optional[User]) -> Optional[RedirectResponse]:
    if current_user is None:
        return redirect_to_login(request)
    if _role_value(current_user.role) not in {
        _role_value(UserRole.ADMIN),
        _role_value(UserRole.SUPER_ADMIN),
    }:
        return RedirectResponse(url="/admin/dashboard", status_code=302)
    return None


@app.get("/health")
async def health_check():
    from app.api.v1.endpoints.health import health_check as handler

    return await handler()


@app.get("/", response_class=HTMLResponse)
async def root(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    return render_page(request, "index.html", current_user=current_user)


@app.get("/app", include_in_schema=False)
async def spa_root():
    return render_spa_index()


@app.get("/app/{full_path:path}", include_in_schema=False)
async def spa_catch_all(full_path: str):
    return render_spa_index()


@app.get("/subscribers", include_in_schema=False)
@app.get("/network/radius", include_in_schema=False)
@app.get("/network/gpon", include_in_schema=False)
@app.get("/monitoring/zabbix", include_in_schema=False)
@app.get("/noc/incidents", include_in_schema=False)
@app.get("/audit", include_in_schema=False)
async def spa_mvp_route():
    return render_spa_index()


@app.get("/subscribers/{subscriber_id}", include_in_schema=False)
async def spa_subscriber_detail_route(subscriber_id: str):
    return render_spa_index()


@app.get("/noc/incidents/{incident_id}", include_in_schema=False)
async def spa_incident_detail_route(incident_id: str):
    return render_spa_index()


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    if current_user is not None:
        return RedirectResponse(
            url="/admin/dashboard" if _is_staff_user(current_user) else "/dashboard",
            status_code=302,
        )
    return render_page(request, "login.html", current_user=current_user)


@app.get("/admin/login", response_class=HTMLResponse)
async def admin_login_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    if current_user is not None:
        return RedirectResponse(
            url="/admin/dashboard" if _is_staff_user(current_user) else "/dashboard",
            status_code=302,
        )
    return render_page(request, "admin/login.html", current_user=current_user)


@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    if current_user is not None:
        return RedirectResponse(url="/dashboard", status_code=302)
    return render_page(request, "register.html", current_user=current_user)


@app.get("/reset-password", response_class=HTMLResponse)
@app.get("/password-recovery", response_class=HTMLResponse)
async def password_recovery_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    if current_user is not None:
        return RedirectResponse(url="/dashboard", status_code=302)
    return render_page(request, "reset_password.html", current_user=current_user)


@app.get("/tariffs", response_class=HTMLResponse)
@app.get("/lk/tariffs", response_class=HTMLResponse)
async def tariffs_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    if request.url.path.startswith("/lk/"):
        redirect = require_private_page(request, current_user)
        if redirect is not None:
            return redirect
    return render_page(request, "tariffs.html", current_user=current_user)


@app.get("/about", response_class=HTMLResponse)
async def about_page(request: Request):
    return render_content_page(request, "about")


@app.get("/contacts", response_class=HTMLResponse)
async def contacts_page(request: Request):
    return render_content_page(request, "contacts")


@app.get("/help", response_class=HTMLResponse)
async def help_page(request: Request):
    return render_content_page(request, "help")


@app.get("/help/payment", response_class=HTMLResponse)
async def help_payment_page(request: Request):
    return render_content_page(request, "help_payment")


@app.get("/help/setup", response_class=HTMLResponse)
async def help_setup_page(request: Request):
    return render_content_page(request, "help_setup")


@app.get("/help/problems", response_class=HTMLResponse)
async def help_problems_page(request: Request):
    return render_content_page(request, "help_problems")


@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/lk/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "dashboard.html", current_user=current_user)


@app.get("/payments", response_class=HTMLResponse)
async def payments_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "payments.html", current_user=current_user)


@app.get("/lk/balance", response_class=HTMLResponse)
async def lk_balance_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "payments.html", page_mode="balance", current_user=current_user)


@app.get("/lk/payments", response_class=HTMLResponse)
async def lk_payments_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "payments.html", page_mode="payments", current_user=current_user)


@app.get("/payments/checkout/{payment_id}", response_class=HTMLResponse)
async def payment_checkout_page(
    request: Request,
    payment_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "payment_checkout.html", payment_id=payment_id, current_user=current_user)


@app.get("/payments/success", response_class=HTMLResponse)
async def payment_success_page(request: Request):
    return render_page(request, "payments.html", payment_success=True)


@app.get("/tickets", response_class=HTMLResponse)
@app.get("/lk/tickets", response_class=HTMLResponse)
@app.get("/lk/tickets/new", response_class=HTMLResponse)
async def tickets_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "tickets.html", current_user=current_user)


@app.get("/tickets/{ticket_id}", response_class=HTMLResponse)
@app.get("/lk/tickets/{ticket_id}", response_class=HTMLResponse)
async def ticket_detail_page(
    request: Request,
    ticket_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "ticket_detail.html", ticket_id=ticket_id, current_user=current_user)


@app.get("/statistics", response_class=HTMLResponse)
@app.get("/lk/statistics", response_class=HTMLResponse)
async def statistics_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "statistics.html", current_user=current_user)


@app.get("/speedtest", response_class=HTMLResponse)
async def speedtest_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "speedtest.html", current_user=current_user)


@app.get("/monitoring", response_class=HTMLResponse)
@app.get("/lk/monitoring", response_class=HTMLResponse)
async def monitoring_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "monitoring.html", current_user=current_user)


@app.get("/monitoring/alerts", response_class=HTMLResponse)
@app.get("/lk/monitoring/alerts", response_class=HTMLResponse)
async def monitoring_alerts_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "monitoring_alerts.html", current_user=current_user)


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "profile.html", current_user=current_user)


@app.get("/settings", response_class=HTMLResponse)
@app.get("/lk/settings", response_class=HTMLResponse)
@app.get("/lk/settings/notifications", response_class=HTMLResponse)
async def settings_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "settings.html", current_user=current_user)


@app.get("/notifications", response_class=HTMLResponse)
@app.get("/lk/notifications", response_class=HTMLResponse)
async def notifications_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_private_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "notifications.html", current_user=current_user)


@app.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/dashboard.html", current_user=current_user)


@app.get("/admin/users", response_class=HTMLResponse)
@app.get("/admin/abonents", response_class=HTMLResponse)
async def admin_users_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/users.html", current_user=current_user)


@app.get("/admin/abonents/{user_id}", response_class=HTMLResponse)
async def admin_abonent_detail_page(
    request: Request,
    user_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/abonent_detail.html", user_id=user_id, current_user=current_user)


@app.get("/admin/tickets", response_class=HTMLResponse)
async def admin_tickets_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/tickets.html", current_user=current_user)


@app.get("/admin/tickets/{ticket_id}", response_class=HTMLResponse)
async def admin_ticket_detail_page(
    request: Request,
    ticket_id: int,
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/ticket_detail.html", ticket_id=ticket_id, current_user=current_user)


@app.get("/admin/logs", response_class=HTMLResponse)
@app.get("/admin/activity-log", response_class=HTMLResponse)
async def admin_logs_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/logs.html", current_user=current_user)


@app.get("/admin/metrics", response_class=HTMLResponse)
async def admin_metrics_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/metrics.html", current_user=current_user)


@app.get("/admin/settings", response_class=HTMLResponse)
async def admin_settings_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_only_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/settings.html", current_user=current_user)


@app.get("/admin/tariffs", response_class=HTMLResponse)
async def admin_tariffs_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_only_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/tariffs.html", current_user=current_user)


@app.get("/admin/payments", response_class=HTMLResponse)
async def admin_payments_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_only_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/payments.html", current_user=current_user)


@app.get("/admin/operators", response_class=HTMLResponse)
async def admin_operators_page(request: Request, current_user: Optional[User] = Depends(get_optional_current_user)):
    redirect = require_admin_only_page(request, current_user)
    if redirect is not None:
        return redirect
    return render_page(request, "admin/operators.html", current_user=current_user)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return RedirectResponse(url=f"/static/favicon.svg?v={ASSET_VERSION}", status_code=302)


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    return FileResponse(
        os.path.join(BASE_DIR, "static", "sw.js"),
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"},
    )


@app.get("/support", response_class=HTMLResponse)
async def support_page(request: Request):
    return render_content_page(request, "support")


@app.get("/terms", response_class=HTMLResponse)
async def terms_page(request: Request):
    return render_content_page(request, "terms")


@app.get("/privacy", response_class=HTMLResponse)
async def privacy_page(request: Request):
    return render_content_page(request, "privacy")


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    accepts_html = "text/html" in request.headers.get("accept", "")
    if accepts_html and exc.status_code == 404:
        return render_page(request, "errors/404.html", status_code=404)
    if accepts_html and exc.status_code == 503:
        return render_page(request, "errors/503.html", status_code=503)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled application error")
    accepts_html = "text/html" in request.headers.get("accept", "")
    if accepts_html:
        return render_page(request, "errors/500.html", status_code=500)
    payload = {"detail": "Internal server error"}
    if settings.debug:
        payload["error"] = str(exc)
        payload["traceback"] = traceback.format_exc()
    return JSONResponse(status_code=500, content=payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
