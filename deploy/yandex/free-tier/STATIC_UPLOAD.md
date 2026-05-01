# Static Upload

Use `upload_static_site.py` to publish `frontend/dist` to Yandex Object Storage.

Why this exists:

- The default recursive bucket copy can leave `.js` files with `Content-Type: text/plain`
- Browsers then block Vite chunks with `Failed to load module script`
- The site appears as an empty background because React never boots

Publish command:

```powershell
cd deploy\yandex\free-tier
python .\upload_static_site.py `
  --bucket mtn `
  --source ..\..\..\frontend\dist `
  --website-url https://mtn.website.yandexcloud.net/ `
  --oauth-token <YANDEX_OAUTH_TOKEN>
```

What the script does:

- uploads every file with an explicit MIME type
- applies `immutable` cache headers to `assets/*`
- applies `no-cache` to `index.html`
- publishes SPA route aliases such as `/login`, `/dashboard` and `/admin/dashboard`
- verifies the public site and fails if JS is not served as JavaScript
- verifies that public SPA routes are reachable after upload
