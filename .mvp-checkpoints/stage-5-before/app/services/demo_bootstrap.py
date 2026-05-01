from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.constants import (
    NotificationPriority,
    NotificationType,
    GponOltStatus,
    GponOntStatus,
    PaymentStatus,
    RadiusSessionStatus,
    TicketPriority,
    TicketStatus,
    UserRole,
)
from app.models import Message, Notification, Olt, Ont, PaymentLog, RadiusSession, Tariff, Ticket, User
from app.services.monitoring import seed_demo_monitoring_data


DEMO_TARIFFS = [
    {
        "billing_tariff_id": "DEMO-100",
        "name": "Старт 100",
        "speed_mbps": 100,
        "upload_speed_mbps": 50,
        "price": Decimal("490"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 0,
        "description": "Базовый тариф для квартиры, где важны стабильный интернет, мессенджеры, онлайн-кинотеатры и видеозвонки без переплаты за лишнюю скорость.",
        "features": [
            "Wi-Fi 6 роутер в аренду от 1 ₽ в месяц",
            "Подключение в удобный двухчасовой интервал",
            "Защита домашней сети и базовый антиспам",
            "Личный кабинет и чат-поддержка 24/7",
        ],
        "is_popular": False,
        "sort_order": 10,
    },
    {
        "billing_tariff_id": "DEMO-200-FAMILY",
        "name": "Семейный 200",
        "speed_mbps": 200,
        "upload_speed_mbps": 100,
        "price": Decimal("650"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 0,
        "description": "Тариф для семьи из 2-3 человек: стриминг, школьные платформы, умные устройства, видеосвязь и несколько ТВ-сценариев одновременно.",
        "features": [
            "До 50 устройств в домашней сети без просадки",
            "Родительский контроль и расписания доступа",
            "Облачное хранилище 100 ГБ",
            "Быстрое переключение на резервный профиль сети",
        ],
        "is_popular": False,
        "sort_order": 15,
    },
    {
        "billing_tariff_id": "DEMO-300",
        "name": "Город 300",
        "speed_mbps": 300,
        "upload_speed_mbps": 150,
        "price": Decimal("790"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 0,
        "description": "Сбалансированный тариф для семей, гибридной работы и 4K-стриминга. Даёт запас по скорости и удобный сервисный пакет.",
        "features": [
            "Приоритетная линия поддержки",
            "Облачное хранилище 200 ГБ",
            "Ускоренный выезд инженера",
            "Поддержка Smart TV и игровых консолей",
        ],
        "is_popular": True,
        "sort_order": 20,
    },
    {
        "billing_tariff_id": "DEMO-500",
        "name": "Сцена 500",
        "speed_mbps": 500,
        "upload_speed_mbps": 300,
        "price": Decimal("1090"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 0,
        "description": "Тариф для насыщенного цифрового дома: игры, стриминг, монтаж, облака, камеры и десятки устройств без компромиссов по стабильности.",
        "features": [
            "Игровой профиль маршрутизации",
            "Mesh-комплект для больших квартир",
            "Ночной резервный LTE-канал",
            "Повышенный SLA на устранение инцидентов",
        ],
        "is_popular": False,
        "sort_order": 30,
    },
    {
        "billing_tariff_id": "DEMO-700-TV",
        "name": "Семья 700 + ТВ",
        "speed_mbps": 700,
        "upload_speed_mbps": 400,
        "price": Decimal("1490"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 3,
        "description": "Пакет для дома, где интернет должен одновременно держать кинотеатр, детские профили, камеры, рабочие ноутбуки и несколько телевизоров.",
        "features": [
            "220+ телеканалов и киноархив",
            "Детский профиль с таймингами доступа",
            "Видеонаблюдение в мобильном приложении",
            "Приставка и роутер уже готовы к связке",
        ],
        "is_popular": False,
        "sort_order": 40,
    },
    {
        "billing_tariff_id": "DEMO-800-WORK",
        "name": "Офис дома 800",
        "speed_mbps": 800,
        "upload_speed_mbps": 500,
        "price": Decimal("1690"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 1,
        "description": "План для тех, кто работает из дома и зависит от upload-скорости: большие файлы, видеоконференции, резервные копии, VPN и облачные среды.",
        "features": [
            "Высокий аплоад до 500 Мбит/с",
            "Статический IP по запросу",
            "Приоритет для видеосвязи и VPN",
            "Расширенная диагностика линии",
        ],
        "is_popular": False,
        "sort_order": 45,
    },
    {
        "billing_tariff_id": "DEMO-1000",
        "name": "Гигабит Премиум",
        "speed_mbps": 1000,
        "upload_speed_mbps": 700,
        "price": Decimal("1990"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 1,
        "description": "Флагманский тариф с гигабитной скоростью, премиальным SLA и приоритетом в сети для цифрового дома без компромиссов.",
        "features": [
            "Выделенный сервисный менеджер",
            "Премиальный SLA 24/7",
            "Резервирование домашней сети",
            "Мониторинг качества линии в кабинете",
        ],
        "is_popular": False,
        "sort_order": 50,
    },
    {
        "billing_tariff_id": "DEMO-BIZ-1500",
        "name": "Бизнес Канал 1500",
        "speed_mbps": 1500,
        "upload_speed_mbps": 1000,
        "price": Decimal("3490"),
        "setup_fee": Decimal("0"),
        "is_unlimited": True,
        "traffic_limit_gb": None,
        "contract_term_months": 12,
        "description": "Тариф для малого бизнеса, студий и офисов: высокая скорость, резервирование, сервисные окна и понятный SLA для критичных задач.",
        "features": [
            "Резервный канал и приоритетная аварийная поддержка",
            "Статический IP и выделенный сегмент сети",
            "Отдельная линия для касс и облачных сервисов",
            "Персональный менеджер подключения",
        ],
        "is_popular": False,
        "sort_order": 60,
    },
]


async def ensure_demo_tariffs(db: AsyncSession) -> None:
    existing_result = await db.execute(select(Tariff))
    existing_map = {item.billing_tariff_id: item for item in existing_result.scalars().all()}

    for payload in DEMO_TARIFFS:
        tariff = existing_map.get(payload["billing_tariff_id"])
        if tariff is None:
            db.add(Tariff(is_active=True, **payload))
            continue

        for key, value in payload.items():
            setattr(tariff, key, value)
        tariff.is_active = True

    await db.flush()


async def ensure_demo_users(db: AsyncSession) -> tuple[User, User, User]:
    demo_user = await _ensure_user(
        db,
        billing_id=settings.demo_account_billing_id,
        phone=settings.demo_account_phone,
        email="demo@operator.local",
        first_name="Алина",
        last_name="Волкова",
        role=UserRole.USER,
        password="DemoOperator2026!",
        is_verified=True,
    )
    demo_user.notification_settings = {
        "email_enabled": True,
        "sms_enabled": True,
        "push_enabled": True,
        "payment_notifications": True,
        "ticket_notifications": True,
    }

    operator = await _ensure_user(
        db,
        billing_id="STAFF-DEMO-01",
        phone="+79005550077",
        email="operator@operator.local",
        first_name="Марина",
        last_name="Лебедева",
        role=UserRole.OPERATOR,
        password="OperatorDemo2026!",
        is_verified=True,
    )

    super_admin = await _ensure_user(
        db,
        billing_id="STAFF-DEMO-ROOT",
        phone="+79005550099",
        email="superadmin@operator.local",
        first_name="Елена",
        last_name="Орлова",
        role=UserRole.SUPER_ADMIN,
        password="SuperAdminDemo2026!",
        is_verified=True,
    )

    demo_user.last_login_at = datetime.utcnow() - timedelta(minutes=18)
    operator.last_login_at = datetime.utcnow() - timedelta(hours=2, minutes=14)
    super_admin.last_login_at = datetime.utcnow() - timedelta(minutes=42)
    await db.flush()
    return demo_user, operator, super_admin


async def _ensure_user(
    db: AsyncSession,
    *,
    billing_id: str,
    phone: str,
    email: str,
    first_name: str,
    last_name: str,
    role: UserRole,
    password: str,
    is_verified: bool,
) -> User:
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            billing_id=billing_id,
            phone=phone,
            email=email,
            first_name=first_name,
            last_name=last_name,
            role=role,
            is_active=True,
            is_verified=is_verified,
            language="ru",
        )
        user.set_password(password)
        db.add(user)
        await db.flush()
        return user

    user.billing_id = billing_id
    user.phone = phone
    user.email = email
    user.first_name = first_name
    user.last_name = last_name
    user.role = role
    user.is_active = True
    user.is_verified = is_verified
    user.is_blocked = False
    user.block_reason = None
    user.language = user.language or "ru"
    user.set_password(password)
    return user


async def ensure_demo_payments(db: AsyncSession, user: User) -> None:
    result = await db.execute(select(PaymentLog.id).where(PaymentLog.user_id == user.id).limit(1))
    if result.scalar_one_or_none() is not None:
        return

    now = datetime.utcnow()
    payments = [
        PaymentLog(
            user_id=user.id,
            amount=Decimal("890"),
            fee_amount=Decimal("0"),
            net_amount=Decimal("890"),
            payment_method="sbp",
            payment_type="topup",
            status=PaymentStatus.SUCCEEDED,
            external_id="demo-pay-001",
            description="Пополнение счёта через СБП",
            created_at=now - timedelta(days=21),
            completed_at=now - timedelta(days=21, minutes=-2),
        ),
        PaymentLog(
            user_id=user.id,
            amount=Decimal("1490"),
            fee_amount=Decimal("0"),
            net_amount=Decimal("1490"),
            payment_method="bank_card",
            payment_type="topup",
            status=PaymentStatus.SUCCEEDED,
            external_id="demo-pay-002",
            description="Автоплатёж по банковской карте",
            created_at=now - timedelta(days=8),
            completed_at=now - timedelta(days=8, minutes=-1),
        ),
        PaymentLog(
            user_id=user.id,
            amount=Decimal("790"),
            fee_amount=Decimal("0"),
            net_amount=Decimal("790"),
            payment_method="apple_pay",
            payment_type="topup",
            status=PaymentStatus.SUCCEEDED,
            external_id="demo-pay-003",
            description="Моментальное пополнение Apple Pay",
            created_at=now - timedelta(days=2, hours=3),
            completed_at=now - timedelta(days=2, hours=3, minutes=-1),
        ),
        PaymentLog(
            user_id=user.id,
            amount=Decimal("1990"),
            fee_amount=Decimal("0"),
            net_amount=Decimal("1990"),
            payment_method="bank_card",
            payment_type="topup",
            status=PaymentStatus.PENDING,
            external_id="demo-pay-004",
            description="Платёж ожидает подтверждение банка",
            created_at=now - timedelta(minutes=47),
            completed_at=None,
        ),
    ]
    db.add_all(payments)
    await db.flush()


async def ensure_demo_tickets(db: AsyncSession, user: User, operator: User) -> None:
    result = await db.execute(select(Ticket.id).where(Ticket.user_id == user.id).limit(1))
    if result.scalar_one_or_none() is not None:
        return

    now = datetime.utcnow()

    internet_ticket = Ticket(
        user_id=user.id,
        assigned_to=operator.id,
        subject="Падает скорость вечером после 21:00",
        category="internet",
        status=TicketStatus.IN_PROGRESS,
        priority=TicketPriority.HIGH,
        sla_deadline=now + timedelta(hours=6),
        created_at=now - timedelta(hours=6),
        updated_at=now - timedelta(hours=1, minutes=15),
        last_activity_at=now - timedelta(hours=1, minutes=15),
        first_response_at=now - timedelta(hours=5, minutes=35),
        tags=["скорость", "вечерняя_нагрузка"],
        meta={"line_profile": "gpon", "signal_level": "-16 dBm"},
    )
    resolved_ticket = Ticket(
        user_id=user.id,
        assigned_to=operator.id,
        subject="Нужна расшифровка последнего списания",
        category="payment",
        status=TicketStatus.RESOLVED,
        priority=TicketPriority.MEDIUM,
        sla_deadline=now - timedelta(days=3),
        created_at=now - timedelta(days=4, hours=2),
        updated_at=now - timedelta(days=3, hours=20),
        last_activity_at=now - timedelta(days=3, hours=20),
        first_response_at=now - timedelta(days=4, hours=1, minutes=30),
        resolved_at=now - timedelta(days=3, hours=20),
        resolution_summary="Списание относилось к подписке на расширенный ТВ-пакет. Услуга отключена по запросу клиента.",
        satisfaction_rating=5,
        tags=["биллинг", "подписка"],
        meta={"source": "demo-seed"},
    )

    db.add_all([internet_ticket, resolved_ticket])
    await db.flush()

    messages = [
        Message(
            ticket_id=internet_ticket.id,
            user_id=user.id,
            body="После 21:00 скорость падает почти в три раза. Видеозвонки начинают рассыпаться, а загрузка в облако почти встаёт.",
            created_at=now - timedelta(hours=6),
        ),
        Message(
            ticket_id=internet_ticket.id,
            user_id=operator.id,
            body="Проверили линию: видим перегрузку на домашнем Wi-Fi. Уже перевели вас на более свободный радиоканал и открыли наблюдение до утра.",
            created_at=now - timedelta(hours=5, minutes=35),
        ),
        Message(
            ticket_id=internet_ticket.id,
            user_id=user.id,
            body="После переключения стало заметно лучше, но хочу посмотреть ещё один вечер, чтобы подтвердить результат.",
            created_at=now - timedelta(hours=1, minutes=15),
        ),
        Message(
            ticket_id=resolved_ticket.id,
            user_id=user.id,
            body="Вижу дополнительное списание в истории и не понимаю, за что оно было начислено.",
            created_at=now - timedelta(days=4, hours=2),
        ),
        Message(
            ticket_id=resolved_ticket.id,
            user_id=operator.id,
            body="Проверили счёт: это подписка на расширенный ТВ-пакет. Отключили её и отправили детализацию расходов в уведомления.",
            created_at=now - timedelta(days=4, hours=1, minutes=30),
        ),
    ]
    db.add_all(messages)
    await db.flush()


async def ensure_demo_notifications(db: AsyncSession, user: User) -> None:
    result = await db.execute(select(Notification.id).where(Notification.user_id == user.id).limit(1))
    if result.scalar_one_or_none() is not None:
        return

    now = datetime.utcnow()
    notifications = [
        Notification(
            user_id=user.id,
            title="Смена тарифа доступна без звонка",
            body="Мы подготовили новую линейку тарифов. Вы можете перейти на любой из них прямо из каталога без ожидания оператора.",
            type=NotificationType.PUSH,
            priority=NotificationPriority.NORMAL,
            is_read=False,
            is_sent=True,
            sent_at=now - timedelta(minutes=35),
            action_url="/tariffs",
            created_at=now - timedelta(minutes=35),
        ),
        Notification(
            user_id=user.id,
            title="Инженер наблюдает линию до утра",
            body="По заявке о вечернем снижении скорости открыт расширенный мониторинг. Если проблема повторится, ответьте в тикете одним сообщением.",
            type=NotificationType.PUSH,
            priority=NotificationPriority.HIGH,
            is_read=False,
            is_sent=True,
            sent_at=now - timedelta(hours=1, minutes=12),
            action_url="/tickets",
            created_at=now - timedelta(hours=1, minutes=12),
        ),
        Notification(
            user_id=user.id,
            title="Последний платёж проведён успешно",
            body="Пополнение на 790 ₽ зачислено на счёт. Квитанция доступна в истории платежей.",
            type=NotificationType.EMAIL,
            priority=NotificationPriority.NORMAL,
            is_read=True,
            is_sent=True,
            sent_at=now - timedelta(days=2, hours=2),
            action_url="/payments",
            created_at=now - timedelta(days=2, hours=2),
        ),
    ]
    db.add_all(notifications)
    await db.flush()


async def ensure_demo_radius_sessions(db: AsyncSession) -> None:
    result = await db.execute(select(User).where(User.role == UserRole.USER).order_by(User.id).limit(5))
    subscribers = list(result.scalars().all())

    demo_names = [("Никита", "Смирнов"), ("Ольга", "Кузнецова"), ("Илья", "Петров")]
    while len(subscribers) < 3:
        suffix = len(subscribers) + 1
        first_name, last_name = demo_names[(suffix - 1) % len(demo_names)]
        user = await _ensure_user(
            db,
            billing_id=f"DEMO-RADIUS-{suffix:02d}",
            phone=f"+790055501{suffix:02d}",
            email=f"radius-{suffix:02d}@operator.local",
            first_name=first_name,
            last_name=last_name,
            role=UserRole.USER,
            password="DemoRadius2026!",
            is_verified=True,
        )
        subscribers.append(user)

    existing_result = await db.execute(
        select(RadiusSession.subscriber_id).where(
            RadiusSession.subscriber_id.in_([item.id for item in subscribers]),
        ),
    )
    existing_subscriber_ids = {item for item in existing_result.scalars().all()}

    statuses = [
        RadiusSessionStatus.ACTIVE.value,
        RadiusSessionStatus.BLOCKED.value,
        RadiusSessionStatus.DISCONNECTED.value,
    ]
    now = datetime.utcnow()
    for index, subscriber in enumerate(subscribers[:5], start=1):
        if subscriber.id in existing_subscriber_ids:
            continue

        db.add(
            RadiusSession(
                subscriber_id=subscriber.id,
                username=subscriber.billing_id,
                framed_ip_address=f"10.64.{index}.{20 + index}",
                mac_address=f"02:00:00:00:{index:02x}:{(index + 10):02x}",
                nas_ip_address="10.255.0.1",
                nas_port=f"pon-mock-{index}",
                session_id=f"demo-radius-session-{subscriber.id}",
                status=statuses[(index - 1) % len(statuses)],
                tariff_profile=f"MVP-{index * 100}M",
                speed_down=index * 100,
                speed_up=max(index * 50, 50),
                started_at=now - timedelta(hours=index * 3),
                updated_at=now - timedelta(minutes=index * 12),
            ),
        )
    await db.flush()


async def ensure_demo_gpon_assets(db: AsyncSession) -> None:
    now = datetime.utcnow()
    olt_payloads = [
        {
            "name": f"OLT-ЖК-{index}",
            "vendor": "Eltex",
            "model": "LTP-16X",
            "management_ip": f"10.30.0.{10 + index}",
            "location": f"ЖК-{index}",
            "status": [
                GponOltStatus.ONLINE.value,
                GponOltStatus.ONLINE.value,
                GponOltStatus.DEGRADED.value,
                GponOltStatus.ONLINE.value,
                GponOltStatus.OFFLINE.value,
            ][index - 1],
            "pon_ports_total": 16,
            "pon_ports_used": 7 + index,
            "uplink_status": "up" if index != 5 else "down",
        }
        for index in range(1, 6)
    ]

    existing_olts = await db.execute(select(Olt))
    olt_by_ip = {item.management_ip: item for item in existing_olts.scalars().all()}
    olts: list[Olt] = []
    for payload in olt_payloads:
        olt = olt_by_ip.get(payload["management_ip"])
        if olt is None:
            olt = Olt(created_at=now, updated_at=now, **payload)
            db.add(olt)
        else:
            for key, value in payload.items():
                setattr(olt, key, value)
            olt.updated_at = now
        olts.append(olt)

    await db.flush()

    result = await db.execute(select(User).where(User.role == UserRole.USER).order_by(User.id).limit(8))
    subscribers = list(result.scalars().all())
    demo_names = [
        ("Анна", "Павлова"),
        ("Денис", "Соколов"),
        ("Мария", "Федорова"),
        ("Павел", "Иванов"),
        ("Софья", "Морозова"),
        ("Кирилл", "Новиков"),
        ("Вера", "Лебедева"),
        ("Роман", "Орлов"),
    ]
    while len(subscribers) < 8:
        suffix = len(subscribers) + 1
        first_name, last_name = demo_names[(suffix - 1) % len(demo_names)]
        user = await _ensure_user(
            db,
            billing_id=f"DEMO-GPON-{suffix:02d}",
            phone=f"+790055502{suffix:02d}",
            email=f"gpon-{suffix:02d}@operator.local",
            first_name=first_name,
            last_name=last_name,
            role=UserRole.USER,
            password="DemoGpon2026!",
            is_verified=True,
        )
        user.connection_address = f"ЖК-{(suffix - 1) % 5 + 1}, корпус {suffix}, кв. {20 + suffix}"
        subscribers.append(user)

    existing_onts = await db.execute(select(Ont.serial_number))
    existing_serials = {item for item in existing_onts.scalars().all()}
    ont_statuses = [
        GponOntStatus.ONLINE.value,
        GponOntStatus.ONLINE.value,
        GponOntStatus.OFFLINE.value,
        GponOntStatus.BLOCKED.value,
        GponOntStatus.ROGUE_SUSPECTED.value,
        GponOntStatus.ONLINE.value,
        GponOntStatus.ONLINE.value,
        GponOntStatus.OFFLINE.value,
    ]
    rx_values = [Decimal("-12.40"), Decimal("-26.80"), Decimal("-28.00"), Decimal("-17.20")]
    tx_values = [Decimal("2.10"), Decimal("2.30"), Decimal("1.80"), Decimal("2.60")]

    for index, subscriber in enumerate(subscribers[:8], start=1):
        serial_number = f"ELTX{index:08d}"
        if serial_number in existing_serials:
            continue
        olt = olts[(index - 1) % len(olts)]
        db.add(
            Ont(
                subscriber_id=subscriber.id,
                olt_id=olt.id,
                serial_number=serial_number,
                mac_address=f"04:bf:6d:00:{index:02x}:{(index + 20):02x}",
                pon_port=(index - 1) % 16 + 1,
                ont_id_on_port=index,
                vlan_id=300 + index,
                status=ont_statuses[(index - 1) % len(ont_statuses)],
                rx_power=rx_values[(index - 1) % len(rx_values)],
                tx_power=tx_values[(index - 1) % len(tx_values)],
                last_seen_at=now - timedelta(minutes=index * 11),
                created_at=now - timedelta(days=index),
                updated_at=now - timedelta(minutes=index * 7),
            ),
        )

    await db.flush()


async def bootstrap_demo_content(db: AsyncSession) -> None:
    if not settings.demo_mode:
        return

    await ensure_demo_tariffs(db)
    demo_user, demo_operator, _demo_super_admin = await ensure_demo_users(db)
    await ensure_demo_payments(db, demo_user)
    await ensure_demo_tickets(db, demo_user, demo_operator)
    await ensure_demo_notifications(db, demo_user)
    await ensure_demo_radius_sessions(db)
    await ensure_demo_gpon_assets(db)
    await seed_demo_monitoring_data(db, demo_user)
    await db.commit()
