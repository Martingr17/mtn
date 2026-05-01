# Render Free deployment

Р­С‚РѕС‚ С„Р°Р№Р» РѕРїРёСЃС‹РІР°РµС‚ Р°Р»СЊС‚РµСЂРЅР°С‚РёРІРЅС‹Р№ Р±РµСЃРїР»Р°С‚РЅС‹Р№ production-demo СЃС†РµРЅР°СЂРёР№ РґР»СЏ Р·Р°С‰РёС‚С‹ РґРёРїР»РѕРјР°.
Р РµР°Р»СЊРЅС‹Р№ production Рё Yandex VM deployment РѕСЃС‚Р°СЋС‚СЃСЏ РѕС‚РґРµР»СЊРЅС‹РјРё СЃС†РµРЅР°СЂРёСЏРјРё.

## РђСЂС…РёС‚РµРєС‚СѓСЂР°

- РћРґРёРЅ Render Web Service СЃ runtime `python`, plan `free`.
- FastAPI РѕС‚РґР°С‘С‚ backend API Рё React SPA РёР· `app/static/spa`.
- Frontend РѕР±СЂР°С‰Р°РµС‚СЃСЏ Рє API same-origin С‡РµСЂРµР· `/api/v1`.
- PostgreSQL СЃРѕР·РґР°С‘С‚СЃСЏ РєР°Рє Render PostgreSQL Free.
- Redis Рё Celery РЅРµ РїРѕРґРЅРёРјР°СЋС‚СЃСЏ РґР»СЏ demo: РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ `REDIS_HOST=memory`.
- RADIUS, GPON, Zabbix Рё Telegram РѕСЃС‚Р°СЋС‚СЃСЏ mock/offline.
- `ENVIRONMENT=staging` РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РЅР°РјРµСЂРµРЅРЅРѕ, РїРѕС‚РѕРјСѓ С‡С‚Рѕ `ENVIRONMENT=production` Р·Р°РїСЂРµС‰Р°РµС‚ `DEMO_MODE=true`.

## РџРѕС‡РµРјСѓ Redis/Celery РѕС‚РєР»СЋС‡РµРЅС‹

Р”Р»СЏ Р·Р°С‰РёС‚С‹ РЅСѓР¶РЅС‹ РёРЅС‚РµСЂР°РєС‚РёРІРЅС‹Рµ API-СЃС†РµРЅР°СЂРёРё: РєР°СЂС‚РѕС‡РєР° Р°Р±РѕРЅРµРЅС‚Р°, RADIUS, GPON, Zabbix, NOC, Telegram mock Рё audit.
РћРЅРё СЂР°Р±РѕС‚Р°СЋС‚ РІ web process. Celery-Р·Р°РґР°С‡Рё РЅСѓР¶РЅС‹ РґР»СЏ С„РѕРЅРѕРІРѕР№ СѓР±РѕСЂРєРё, РѕС‚Р»РѕР¶РµРЅРЅС‹С… СѓРІРµРґРѕРјР»РµРЅРёР№, РјРѕРЅРёС‚РѕСЂРёРЅРіР° Рё backup jobs.
РќР° Render Free Р±РµР·РѕРїР°СЃРЅРµРµ РЅРµ РїРѕРґРЅРёРјР°С‚СЊ РѕС‚РґРµР»СЊРЅС‹Рµ worker/Redis СЃРµСЂРІРёСЃС‹, С‡С‚РѕР±С‹ СЃРѕРєСЂР°С‚РёС‚СЊ СЃС‚РѕРёРјРѕСЃС‚СЊ, С…РѕР»РѕРґРЅС‹Рµ СЃС‚Р°СЂС‚С‹ Рё С‚РѕС‡РєРё РѕС‚РєР°Р·Р°.

Р—Р°РґР°Р№:

```env
REDIS_HOST=memory
MONITORING_EMBED_SCHEDULER=false
ENABLE_WEBSOCKETS=false
```

`ENABLE_WEBSOCKETS=false` РЅРµРѕР±СЏР·Р°С‚РµР»РµРЅ, РЅРѕ РґР»СЏ demo СѓРјРµРЅСЊС€Р°РµС‚ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ runtime. MVP-СЃС‚СЂР°РЅРёС†С‹ СЂР°Р±РѕС‚Р°СЋС‚ Р±РµР· WebSocket.

## Blueprint

Р’ СЂРµРїРѕР·РёС‚РѕСЂРёРё РґРѕР±Р°РІР»РµРЅ `render.yaml`.

РћРЅ СЃРѕР·РґР°С‘С‚:

- web service `mtn-demo`;
- database `mtn-oss-bss-db`;
- `DATABASE_URL` С‡РµСЂРµР· `fromDatabase.property: connectionString`;
- generated `SECRET_KEY` Рё `JWT_SECRET_KEY`;
- demo/mock env.

Р•СЃР»Рё Render Blueprint РІ С‚РІРѕС‘Рј Р°РєРєР°СѓРЅС‚Рµ РЅРµ РїСЂРёРјРµС‚ `fromDatabase` РґР»СЏ `connectionString`, СЃРѕР·РґР°Р№ PostgreSQL РІСЂСѓС‡РЅСѓСЋ РІ Dashboard Рё Р·Р°РїРѕР»РЅРё `DATABASE_URL` РёР· РїРѕР»СЏ Internal Database URL.

## Build Рё start

Build command:

```bash
cd frontend && npm ci && VITE_OUT_DIR=../app/static/spa npm run build && cd .. && pip install -r requirements.txt
```

Start command:

```bash
python -m alembic upgrade head && gunicorn app.main:app -c gunicorn.conf.py
```

`gunicorn.conf.py` С‡РёС‚Р°РµС‚ Render-РїРµСЂРµРјРµРЅРЅСѓСЋ `PORT`, РїРѕСЌС‚РѕРјСѓ РѕС‚РґРµР»СЊРЅС‹Р№ bind СѓРєР°Р·С‹РІР°С‚СЊ РЅРµ РЅСѓР¶РЅРѕ.

Migrations РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ РїСЂРё СЃС‚Р°СЂС‚Рµ РїРµСЂРµРґ Р·Р°РїСѓСЃРєРѕРј FastAPI. РќР° Р±РµСЃРїР»Р°С‚РЅРѕРј Render СЌС‚Рѕ РїСЂРѕС‰Рµ, С‡РµРј РѕС‚РґРµР»СЊРЅС‹Р№ pre-deploy job.

Demo bootstrap РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РІ lifespan FastAPI, РєРѕРіРґР° `DEMO_MODE=true`.

## Env

РџСЂРѕРІРµСЂСЊ РїРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ Blueprint:

```env
ENVIRONMENT=staging
DEBUG=false
DEMO_MODE=true
DEMO_SHOW_SMS_CODE=true
DEMO_SHOW_EMAIL_CODE=true
AUTO_SCHEMA_SYNC=false
CLOUD_FUNCTIONS_MODE=false

PUBLIC_APP_URL=https://mtn-demo.onrender.com
CORS_ORIGINS=["https://mtn-demo.onrender.com"]
TRUSTED_HOSTS=["mtn-demo.onrender.com","*.onrender.com","localhost","127.0.0.1"]

DATABASE_URL=<Internal Database URL from Render PostgreSQL>
REDIS_HOST=memory
GUNICORN_WORKERS=1
POSTGRES_POOL_SIZE=2
POSTGRES_MAX_OVERFLOW=1

SECRET_KEY=<generated>
JWT_SECRET_KEY=<generated>
BILLING_API_KEY=production-demo-mock-billing-key
BILLING_API_URL=https://operator.local/api/v2

SMS_PROVIDER=mock
TELEGRAM_ALERTS_ENABLED=false
TELEGRAM_MOCK_MODE=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_NOC_CHAT_ID=

VITE_API_BASE_URL=/api/v1
VITE_WITH_CREDENTIALS=true
VITE_ENABLE_LEGACY_BUCKET_API_MAPPING=false
```

Р•СЃР»Рё РјРµРЅСЏРµС€СЊ РёРјСЏ Render service, РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ Р·Р°РјРµРЅРё РґРѕРјРµРЅ РІ `PUBLIC_APP_URL`, `CORS_ORIGINS` Рё `TRUSTED_HOSTS`.

## Demo users

| Р РѕР»СЊ | Email | Password |
| --- | --- | --- |
| admin | `admin@operator.local` | `AdminDemo2026!` |
| super_admin | `superadmin@operator.local` | `SuperAdminDemo2026!` |
| noc_engineer | `noc@operator.local` | `NocDemo2026!` |
| support | `operator@operator.local` | `OperatorDemo2026!` |
| billing | `billing@operator.local` | `BillingDemo2026!` |
| subscriber | `demo@operator.local` | `DemoOperator2026!` |
| b2b subscriber | `business@operator.local` | `DemoBusiness2026!` |

## РџСЂРѕРІРµСЂРєР° РїРѕСЃР»Рµ РґРµРїР»РѕСЏ

РћС‚РєСЂРѕР№:

- `https://mtn-demo.onrender.com/health`
- `https://mtn-demo.onrender.com/subscribers`
- `https://mtn-demo.onrender.com/subscribers/1`
- `https://mtn-demo.onrender.com/network/radius`
- `https://mtn-demo.onrender.com/network/gpon`
- `https://mtn-demo.onrender.com/monitoring/zabbix`
- `https://mtn-demo.onrender.com/noc/incidents`
- `https://mtn-demo.onrender.com/noc/incidents/1`
- `https://mtn-demo.onrender.com/audit`

РџСЂСЏРјС‹Рµ SPA URL СЂР°Р±РѕС‚Р°СЋС‚ С‡РµСЂРµР· backend fallback РІ `app/main.py`, РѕС‚РґРµР»СЊРЅС‹Рµ Render rewrite rules РЅРµ РЅСѓР¶РЅС‹.

## РџСЂРѕРіСЂРµРІ РїРµСЂРµРґ Р·Р°С‰РёС‚РѕР№

Render Free web service РјРѕР¶РµС‚ Р·Р°СЃС‹РїР°С‚СЊ РїРѕСЃР»Рµ РїСЂРѕСЃС‚РѕСЏ. Р—Р° 10-15 РјРёРЅСѓС‚ РґРѕ РґРµРјРѕРЅСЃС‚СЂР°С†РёРё:

1. РћС‚РєСЂРѕР№ `/health`.
2. РћС‚РєСЂРѕР№ `/subscribers`.
3. Р’РѕР№РґРё РїРѕРґ `admin@operator.local`.
4. РџСЂРѕРІРµСЂСЊ `/monitoring/zabbix` Рё `/noc/incidents`.
5. РќРµ Р·Р°РєСЂС‹РІР°Р№ РІРєР»Р°РґРєСѓ РґРѕ РїРѕРєР°Р·Р°.

## Р РёСЃРєРё Render Free

- Cold start РїРѕСЃР»Рµ СЃРЅР° СЃРµСЂРІРёСЃР°.
- Р›РёРјРёС‚С‹ free web service Рё free database.
- Р‘РµСЃРїР»Р°С‚РЅР°СЏ Р±Р°Р·Р° РјРѕР¶РµС‚ РёРјРµС‚СЊ РѕРіСЂР°РЅРёС‡РµРЅРЅС‹Р№ СЃСЂРѕРє Р¶РёР·РЅРё Рё СЂРµСЃСѓСЂСЃС‹.
- Migrations РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ РІ start command, РїРѕСЌС‚РѕРјСѓ РѕС€РёР±РєР° РјРёРіСЂР°С†РёРё РѕСЃС‚Р°РЅРѕРІРёС‚ web service.
- Ephemeral filesystem: uploads/logs РЅРµ СЃС‡РёС‚Р°СЋС‚СЃСЏ РїРѕСЃС‚РѕСЏРЅРЅС‹Рј С…СЂР°РЅРёР»РёС‰РµРј.
- Р•СЃР»Рё native Python build РЅРµ РЅР°Р№РґС‘С‚ `npm`, fallback: РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ Docker-based Render service СЃ Dockerfile, РєРѕС‚РѕСЂС‹Р№ СЃРѕР±РёСЂР°РµС‚ frontend.

## Fallback

Р•СЃР»Рё Render Free РЅРµСЃС‚Р°Р±РёР»РµРЅ РїРµСЂРµРґ Р·Р°С‰РёС‚РѕР№:

- РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ СѓР¶Рµ РїРѕРґРіРѕС‚РѕРІР»РµРЅРЅС‹Р№ Yandex VM/Docker СЃС†РµРЅР°СЂРёР№;
- РґРµСЂР¶Р°С‚СЊ Р»РѕРєР°Р»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє РєР°Рє Р·Р°РїР°СЃРЅРѕР№;
- Р·Р°СЂР°РЅРµРµ СЃРґРµР»Р°С‚СЊ РєРѕСЂРѕС‚РєРёР№ СЃРєСЂРёРЅРєР°СЃС‚ demo flow.

## Defense readiness

Render Free РїРѕРґС…РѕРґРёС‚ С‚РѕР»СЊРєРѕ РґР»СЏ РґРµРјРѕРЅСЃС‚СЂР°С†РёРѕРЅРЅРѕРіРѕ СЃС‚РµРЅРґР°, РЅРµ РґР»СЏ РЅР°СЃС‚РѕСЏС‰РµРіРѕ production.
РџРµСЂРµРґ Р·Р°С‰РёС‚РѕР№ РѕС‚РєСЂРѕР№ СЃР°Р№С‚ Р·Р° 10-15 РјРёРЅСѓС‚, С‡С‚РѕР±С‹ СЂР°Р·Р±СѓРґРёС‚СЊ web service РїРѕСЃР»Рµ СЃРЅР°, Рё РїСЂРѕРіСЂРµР№ РєР»СЋС‡РµРІС‹Рµ СЃС‚СЂР°РЅРёС†С‹: `/health`, `/subscribers`, `/network/gpon`, `/monitoring/zabbix`, `/noc/incidents` Рё `/audit`.
Р”РµСЂР¶Рё Р»РѕРєР°Р»СЊРЅС‹Р№ Р·Р°РїСѓСЃРє РёР»Рё Yandex VM deployment РєР°Рє fallback РЅР° СЃР»СѓС‡Р°Р№ cold start, Р»РёРјРёС‚РѕРІ free database РёР»Рё РІСЂРµРјРµРЅРЅРѕР№ РЅРµРґРѕСЃС‚СѓРїРЅРѕСЃС‚Рё Render.

