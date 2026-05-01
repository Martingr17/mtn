# Yandex Cloud VM production-demo deployment

Этот сценарий предназначен для защиты диплома и выбран как основной production-demo runtime.

## Архитектура

- Yandex Cloud VM с Docker и Docker Compose.
- Один публичный домен для frontend и API.
- Nginx принимает HTTP/HTTPS на `80/443`.
- Frontend SPA собирается в `app/static/spa` и отдаётся через backend/nginx.
- FastAPI работает в Docker-контейнере `app`.
- PostgreSQL и Redis работают в `docker-compose.prod.yml`.
- API доступен same-origin по `/api/v1`.
- RADIUS, GPON, Zabbix остаются mock adapters.
- Telegram alerts по умолчанию offline/mock: `TELEGRAM_ALERTS_ENABLED=false`, `TELEGRAM_MOCK_MODE=true`.

Bucket/Object Storage и API Gateway уже могут существовать в Yandex Cloud, но для этого варианта они не используются как основной runtime. Старый free-tier/Object Storage сценарий остаётся legacy/optional в `deploy/yandex/free-tier`.

## Что заменить перед деплоем

Создай файл `.env.production-demo` из `.env.production-demo.example` и замени placeholders:

```env
PUBLIC_APP_URL=https://<your-domain>
CORS_ORIGINS=["https://<your-domain>"]
TRUSTED_HOSTS=["<your-domain>","localhost","127.0.0.1"]
YKASSA_RETURN_URL=https://<your-domain>/payments/success

POSTGRES_PASSWORD=<strong-demo-db-password>
REDIS_PASSWORD=<strong-demo-redis-password>
SECRET_KEY=<strong-64-char-demo-secret>
JWT_SECRET_KEY=<strong-64-char-demo-jwt-secret>
GRAFANA_PASSWORD=<strong-demo-grafana-password>
```

Для production-demo оставь:

```env
ENVIRONMENT=staging
DEMO_MODE=true
TELEGRAM_ALERTS_ENABLED=false
TELEGRAM_MOCK_MODE=true
VITE_API_BASE_URL=/api/v1
VITE_WITH_CREDENTIALS=true
VITE_ENABLE_LEGACY_BUCKET_API_MAPPING=false
```

`ENVIRONMENT=staging` здесь используется намеренно: это demo-стенд с production-like compose, но с включёнными demo users/data. Для настоящего production используй `.env.production.example`, где `ENVIRONMENT=production` и `DEMO_MODE=false`.

## TLS certificates

Nginx ожидает сертификаты внутри `docker/ssl`:

```text
docker/ssl/fullchain.pem
docker/ssl/privkey.pem
```

В контейнере они монтируются как:

```text
/etc/nginx/ssl/fullchain.pem
/etc/nginx/ssl/privkey.pem
```

Сертификаты можно получить через Yandex Certificate Manager, certbot или другой процесс, но этот репозиторий не запускает выпуск сертификатов автоматически.

`docker/nginx.prod.conf.nginx` использует `server_name _;` как catch-all для production-demo. Это удобно, если домен на VM уже указывает правильно. Для строгой production-настройки можно заменить `_` на реальный домен.

## Запуск на Yandex VM

```powershell
Copy-Item .env.production-demo.example .env.production-demo
notepad .env.production-demo
```

После заполнения домена и секретов:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/production-demo.ps1 -EnvFile .env.production-demo
```

Ручной эквивалент:

```bash
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

Demo bootstrap выполняется при старте backend, когда включён `DEMO_MODE=true`.

## Smoke-test

Внутри compose:

```bash
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/health
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/subscribers
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/network/radius
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/network/gpon
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/monitoring/zabbix
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/noc/incidents
docker compose --env-file .env.production-demo -f docker-compose.prod.yml exec -T app curl -fsS http://localhost:8000/audit
```

В браузере после деплоя:

- `https://<your-domain>/`
- `https://<your-domain>/health`
- `https://<your-domain>/subscribers`
- `https://<your-domain>/subscribers/1`
- `https://<your-domain>/network/radius`
- `https://<your-domain>/network/gpon`
- `https://<your-domain>/monitoring/zabbix`
- `https://<your-domain>/noc/incidents`
- `https://<your-domain>/noc/incidents/1`
- `https://<your-domain>/audit`

## Demo users

| Роль | Email | Password |
| --- | --- | --- |
| admin | `admin@operator.local` | `AdminDemo2026!` |
| super_admin | `superadmin@operator.local` | `SuperAdminDemo2026!` |
| noc_engineer | `noc@operator.local` | `NocDemo2026!` |
| support | `operator@operator.local` | `OperatorDemo2026!` |
| billing | `billing@operator.local` | `BillingDemo2026!` |
| subscriber | `demo@operator.local` | `DemoOperator2026!` |
| b2b subscriber | `business@operator.local` | `DemoBusiness2026!` |

## Rollback / fallback

Остановить production-demo:

```bash
docker compose --env-file .env.production-demo -f docker-compose.prod.yml down
```

Вернуться к предыдущему образу, если он есть локально:

```bash
docker compose --env-file .env.production-demo -f docker-compose.prod.yml up -d
```

Посмотреть логи:

```bash
docker compose --env-file .env.production-demo -f docker-compose.prod.yml logs -f app nginx
```

Если HTTPS не готов, можно временно проверять backend внутри compose через smoke-test выше, но публичный demo должен открываться по HTTPS-домену.
