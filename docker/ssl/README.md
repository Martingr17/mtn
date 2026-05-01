Place production TLS certificates in this directory before running `docker compose -f docker-compose.prod.yml up`.

Required files:

- `fullchain.pem`
- `privkey.pem`

The production nginx config expects them at:

- `/etc/nginx/ssl/fullchain.pem`
- `/etc/nginx/ssl/privkey.pem`
