#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/mtn-app"
VENV_DIR="$APP_DIR/.venv"

sudo apt-get update
sudo apt-get install -y \
  python3.12 \
  python3.12-venv \
  python3-pip \
  nginx \
  redis-server \
  postgresql \
  postgresql-contrib

sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"

python3.12 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

if [[ ! -f .env ]]; then
  cp .env.production.example .env
  echo "Created .env from .env.production.example. Fill in real secrets before starting services."
fi

alembic -c alembic.ini upgrade head

echo "System packages installed."
echo "Next steps:"
echo "  1. Edit $APP_DIR/.env with production secrets"
echo "  2. Install deploy/nginx/mtn.conf and systemd units from deploy/systemd/"
echo "  3. Start Gunicorn, Celery worker and Celery beat"
