FROM python:3.12-slim

WORKDIR /app

ENV PYTHONPATH=/app:/app/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads logs static \
    && chown -R appuser:appuser /app

EXPOSE 8000

# Default runtime is production-grade Gunicorn; docker-compose overrides this for local development.
CMD ["gunicorn", "app.main:app", "-c", "gunicorn.conf.py"]
