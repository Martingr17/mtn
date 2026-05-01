# MTN OSS/BSS MVP Demo

Документ для локального показа MVP на защите диплома. Реальные RADIUS, OLT, Zabbix и Telegram не вызываются: используются mock adapter'ы и demo data.

## Стек

- Backend: FastAPI, SQLAlchemy async, Alembic, PostgreSQL/SQLite-compatible models.
- Frontend: React, Vite, TypeScript, TanStack Query, Axios.
- Интеграции MVP: RADIUS/CoA mock, GPON/ONT mock, Zabbix mock, Telegram alerts mock mode.
- RBAC: legacy роли `user`, `operator`, `billing`, `noc_engineer`, `admin`, `super_admin` плюс совместимый MVP-слой.

## Запуск локально

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
npm run dev
```

Backend API: `http://localhost:8000/api/v1`.
Frontend: `http://localhost:5173`.

## Production-demo запуск

Production-demo профиль нужен только для защиты и демо-стенда. Он явно включает `DEMO_MODE=true`, но оставляет внешние интеграции безопасными: RADIUS/GPON/Zabbix работают как mock adapter'ы, Telegram по умолчанию отключен и находится в mock mode.

Самый короткий путь на Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/production-demo.ps1
```

Ручной запуск теми же шагами:

```bash
cp .env.production-demo.example .env.production-demo
cd frontend
npm install
npm run build
cd ..
docker compose --env-file .env.production-demo -f docker-compose.prod.yml config
docker compose --env-file .env.production-demo -f docker-compose.prod.yml build app celery_worker celery_beat
docker compose --env-file .env.production-demo -f docker-compose.prod.yml up -d --wait postgres redis
docker compose --env-file .env.production-demo -f docker-compose.prod.yml run --rm --no-deps app alembic upgrade head
docker compose --env-file .env.production-demo -f docker-compose.prod.yml up -d
```

После старта backend сам загружает demo data во время lifespan, потому что в `.env.production-demo` включен `DEMO_MODE=true`. Для настоящего production оставляй `.env.production.example`, где `DEMO_MODE=false`.

Smoke-test внутри app container:

```bash
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/health
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/subscribers
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/network/radius
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/network/gpon
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/monitoring/zabbix
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/noc/incidents
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/audit
```

Прямые URL `/subscribers`, `/subscribers/:id`, `/network/radius`, `/network/gpon`, `/monitoring/zabbix`, `/noc/incidents`, `/noc/incidents/:id` и `/audit` отдаются через backend SPA fallback, поэтому после деплоя их можно открывать напрямую и обновлять в браузере.

## Demo data

Demo bootstrap запускается при `DEMO_MODE=true` во время старта backend. Он создает связный набор данных:

- несколько B2C-абонентов и B2B-абонент `DEMO-B2B-001`;
- тарифы B2C и B2B, платежи и заявки;
- 5 OLT Eltex LTP-16X для JK-1...JK-5;
- ONT с online/offline/blocked/rogue_suspected и разными `rx_power`;
- RADIUS sessions со статусами active/blocked/disconnected;
- Zabbix alarms по BGP, VRRP, ERPS, OLT, ONT optical power, UPS, NAT, DDoS;
- NOC incidents, включая связанный incident из Zabbix alarm;
- audit events появляются после write-действий в RADIUS, GPON, Zabbix, NOC и Telegram.

## Demo users

Пароли предназначены только для локального demo mode.

| Роль | Email | Phone | Password | Что показать |
| --- | --- | --- | --- | --- |
| admin | `admin@operator.local` | `+79005550098` | `AdminDemo2026!` | Полный MVP-доступ, audit log, admin pages |
| super_admin | `superadmin@operator.local` | `+79005550099` | `SuperAdminDemo2026!` | Полный доступ legacy/admin |
| noc_engineer | `noc@operator.local` | `+79005550088` | `NocDemo2026!` | GPON, Zabbix, NOC incidents, Telegram manual send |
| support | `operator@operator.local` | `+79005550077` | `OperatorDemo2026!` | Абоненты, заявки, read-only network/monitoring, RADIUS disconnect |
| billing | `billing@operator.local` | `+79005550066` | `BillingDemo2026!` | Абоненты, баланс, RADIUS block/unblock |
| subscriber | `demo@operator.local` | `+79005553311` | `DemoOperator2026!` | Собственная карточка, платежи, заявки |
| b2b subscriber | `business@operator.local` | `+79005553322` | `DemoBusiness2026!` | B2B-карточка и бизнес-тариф |

## Роли и доступ

- `subscriber` -> legacy `user`: видит только свой кабинет и свою карточку.
- `support` -> legacy `operator`: читает абонентов, GPON/Zabbix/NOC, может делать RADIUS disconnect.
- `billing` -> legacy `billing`: читает абонентов, баланс/платежи, может RADIUS block/unblock.
- `noc_engineer` -> legacy `noc_engineer`: управляет GPON/Zabbix/NOC, может Telegram alert для critical.
- `admin` -> legacy `admin`/`super_admin`: полный MVP-доступ, включая `/audit`.

## Demo сценарии

### 1. Абонент найден -> карточка -> баланс -> платежи -> заявки

1. Войти как `operator@operator.local`.
2. Открыть `/subscribers`.
3. Найти `demo@operator.local` или `DEMO-B2B-001`.
4. Открыть карточку: показать вкладки основного профиля, баланса, платежей и заявок.

### 2. Абонент заблокирован -> RADIUS block/unblock

1. Войти как `billing@operator.local` или `admin@operator.local`.
2. Открыть `/network/radius`.
3. Найти активную session.
4. Нажать `Block`, затем `Unblock`.
5. Открыть `/audit` под admin и показать записи `block`/`unblock`.

### 3. ONT low optical power -> alarm -> incident -> Telegram alert

1. Войти как `noc@operator.local`.
2. Открыть `/monitoring/zabbix`, фильтр `Low optical power` или `Critical`.
3. Нажать `Create incident` для active alarm.
4. Перейти в `/noc/incidents`, открыть incident.
5. Нажать `Send Telegram alert` для critical incident.
6. На Zabbix page показать `Telegram alert log`, под admin дополнительно показать `/audit`.

### 4. Авария BGP/VRRP/ERPS -> создание инцидента

1. Войти как `noc@operator.local`.
2. Открыть `/monitoring/zabbix`.
3. Отфильтровать `BGP down`, `VRRP failover` или `ERPS ring fault`.
4. Создать incident из active alarm.
5. Показать linked alarm в карточке incident.

### 5. Инженер NOC работает с GPON и инцидентами

1. Войти как `noc@operator.local`.
2. Открыть `/network/gpon`.
3. Отфильтровать ONT по low `rx_power` или статусу.
4. Открыть детали ONT, выполнить `Refresh` или `Mark rogue`.
5. Открыть `/noc/incidents`, взять incident в работу: `Ack` -> `Start` -> `Resolve`.

### 6. Проверка audit log

1. Войти как `admin@operator.local`.
2. Открыть `/audit`.
3. Отфильтровать по `entity_type`, `action`, `actor`, `date range`.
4. Показать, что write-действия RADIUS, GPON, Zabbix, NOC и Telegram лежат в едином журнале.

## Маршрут показа на 5-7 минут

1. 30 секунд: войти как admin, показать структуру меню и роли MVP.
2. 60 секунд: `/subscribers` -> карточка demo subscriber, баланс, платежи, заявки.
3. 60 секунд: `/network/radius`, block/unblock или disconnect, показать результат в журнале действий.
4. 90 секунд: `/network/gpon` -> ONT low optical power, затем `/monitoring/zabbix`.
5. 90 секунд: создать NOC incident из alarm, пройти `Ack`/`Start`/`Resolve`.
6. 60 секунд: отправить Telegram mock alert для critical incident/alarm, показать alert log.
7. 30 секунд: `/audit`, фильтры и единый след действий.

## Проверки перед защитой

```bash
python -m pytest tests
python -m ruff check app/api/v1/endpoints/audit.py app/schemas/audit.py app/services/demo_bootstrap.py app/services/billing.py
cd frontend
npm run typecheck
npm run lint
```

Также проверь вручную, что после `alembic upgrade head` и запуска backend demo bootstrap не падает, а меню ведет на реализованные страницы.
