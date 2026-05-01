# MTN Operator App

Единый продукт MTN для абонента и команды поддержки: личный кабинет, тарифы, пополнение, уведомления, speedtest, мониторинг и административная панель.

## Что в проекте

- `frontend/` — React + TypeScript + Vite SPA.
- `app/` — FastAPI-приложение и серверная логика.
- `tests/` — backend-тесты.
- `docker-compose.yml` — локальная разработка.
- `docker-compose.prod.yml` — production-окружение.
- `.env.example` — пример локальной конфигурации.
- `.env.production.example` — пример production-конфигурации.

## Текущий стек

- Backend: FastAPI, SQLAlchemy, Celery, Redis, PostgreSQL.
- Frontend: React 18, TypeScript, Vite, TanStack Query, Zustand.
- Infra: Docker, Docker Compose, Nginx, Prometheus, Grafana.

## Быстрый старт для разработки

1. Перейдите в каталог проекта:

```bash
cd app
```

2. Создайте локальный env:

```bash
cp .env.example .env
```

3. Поднимите dev-окружение:

```bash
docker compose up -d
```

4. При необходимости примените миграции:

```bash
docker compose exec app alembic upgrade head
```

5. Фронтенд в режиме разработки:

```bash
cd frontend
npm install
npm run dev
```

## Проверки перед деплоем

Фронтенд:

```bash
cd app/frontend
npm run lint
npm run typecheck
npm run build
```

Бэкенд:

```bash
cd app
python -m pytest
python -m ruff check .
```

Если `pytest` или `ruff` не запускаются, сначала установите dev-зависимости из `requirements-dev.txt`.

## Production deploy

1. Подготовьте production env:

```bash
cd app
cp .env.production.example .env.production
```

2. Обязательно заполните секреты и внешние интеграции в `.env.production`:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `REDIS_PASSWORD`
- `SECRET_KEY`
- `JWT_SECRET_KEY`
- `PUBLIC_APP_URL`
- `BILLING_API_URL`
- `BILLING_API_KEY`
- `SMTP_*`
- `SMS_*`
- `TELEGRAM_ALERTS_ENABLED`
- `TELEGRAM_MOCK_MODE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_NOC_CHAT_ID`
- `WEBPUSH_VAPID_*`
- `GRAFANA_PASSWORD`
- `GRAFANA_ROOT_URL`
- при необходимости `YKASSA_*`, `STRIPE_*`, `SENTRY_DSN`

3. Проверьте compose-конфигурацию:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config
```

4. Соберите и поднимите production:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

5. После старта проверьте health endpoint:

```bash
curl http://localhost:8000/health
```

## Что важно знать

- Production compose сейчас корректно валидируется, но без `.env.production` Docker подставляет пустые значения для секретов. Это нормально для проверки структуры, но не для реального запуска.
- Production образ использует `Dockerfile.prod`.
- SPA после `npm run build` собирается в `app/static/spa`.
- Nginx, Prometheus и Grafana уже включены в `docker-compose.prod.yml`.
- Для защиты используйте `.env.production-demo.example`: он включает demo data через `DEMO_MODE=true`, но оставляет Telegram в mock mode и не включает реальные RADIUS/GPON/Zabbix интеграции.

## Мини-чеклист перед выкладкой

- Все обязательные переменные в `.env.production` заполнены.
- `npm run lint`, `npm run typecheck`, `npm run build` проходят без ошибок.
- Бэкенд-тесты и линтер запускаются в целевом окружении.
- SSL-сертификаты и nginx-конфиг подготовлены в `docker/ssl` и `docker/nginx.prod.conf.nginx`.
- База данных и Redis имеют постоянные volume.
