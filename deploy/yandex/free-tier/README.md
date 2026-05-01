# MTN on Free Yandex Cloud

Этот профиль переводит проект на бесплатный serverless-контур:

- backend: Yandex Cloud Functions
- database: YDB serverless
- frontend: React SPA в Yandex Object Storage
- public routing: API Gateway, где `/api/*` уходит в функцию, а остальное читается из бакета

## Что уже подготовлено в коде

- backend умеет переключаться между `postgres` и `ydb` через `DATABASE_BACKEND`
- PostgreSQL-специфичные типы в моделях заменены на совместимые SQLAlchemy-типы
- bigint ID генерируются на стороне приложения, чтобы не зависеть от `BIGSERIAL`
- WebSocket-маршрут отключается в `CLOUD_FUNCTIONS_MODE=true`
- для Redis уже есть совместимый fallback `REDIS_HOST=memory`

## Рекомендуемый публичный URL

Рекомендуемый вариант для free-tier: открывать сайт через домен API Gateway, а не напрямую через website endpoint бакета.

Так мы получаем:

- SPA и API под одним доменом
- `VITE_API_BASE_URL=/api/v1`
- отсутствие 405 от бакета на `POST /api/*`

## Файлы в этой папке

- `backend.env.example` — пример env для Cloud Function
- `frontend.env.example` — пример env для сборки SPA
- `api-gateway.yaml` — unified gateway: Object Storage + Cloud Function
- `build-function-package.ps1` — упаковка актуального backend-кода в zip-ready директорию

## Минимальный план деплоя

1. Создать YDB serverless database.
2. Создать service account для Cloud Function с доступом к YDB.
3. Создать service account для API Gateway с правами на чтение бакета и вызов функции.
4. Собрать фронтенд:

```powershell
cd frontend
Copy-Item .env.production .env.production.bak -ErrorAction SilentlyContinue
Copy-Item ..\deploy\yandex\free-tier\frontend.env.example .env.production.local
npm install
npm run build
```

5. Загрузить `dist/` в бакет `mtn`.
6. Собрать backend package:

```powershell
cd deploy\yandex\free-tier
.\build-function-package.ps1
Compress-Archive -Path .\function-package\* -DestinationPath .\function-package.zip -Force
```

7. Создать или обновить Cloud Function:
   entrypoint: `serverless_handler.handler`
   runtime: `python311`
   source: `function-package.zip`
   env: значения из `backend.env.example`
8. Создать или обновить API Gateway по `api-gateway.yaml`.

## Важные ограничения

- Alembic в репозитории остаётся PostgreSQL-only. Для YDB используется `AUTO_SCHEMA_SYNC=true`.
- In-memory Redis подходит только для малого трафика и serverless-демо профиля.
- WebSocket в Cloud Functions не является надёжной transport-стратегией, поэтому для этого профиля он выключен.

## Что проверить после первого запуска

- `GET /api/v1/health/` отвечает через домен API Gateway
- регистрация и логин работают через API Gateway, а не через bucket website URL
- страницы SPA открываются по прямым адресам `/login`, `/dashboard`, `/support`
- в YDB появились таблицы после первого cold start с `AUTO_SCHEMA_SYNC=true`
- после успешного bootstrap лучше переключить `AUTO_SCHEMA_SYNC=false`
