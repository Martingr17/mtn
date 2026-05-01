.PHONY: help build up down logs shell migrate migrate-down seed test lint format clean backup restore

help:
	@echo "Available commands:"
	@echo "  make build      - Build Docker images"
	@echo "  make up         - Start all services"
	@echo "  make down       - Stop all services"
	@echo "  make logs       - View logs"
	@echo "  make shell      - Enter app container shell"
	@echo "  make migrate    - Run database migrations"
	@echo "  make migrate-down - Rollback last migration"
	@echo "  make seed       - Seed database with test data"
	@echo "  make test       - Run tests"
	@echo "  make lint       - Run linters"
	@echo "  make format     - Format code"
	@echo "  make clean      - Clean cache files"
	@echo "  make backup     - Create database backup"
	@echo "  make restore    - Restore database from backup"

build:
	docker-compose build

up:
	docker-compose up -d
	@echo "Services started. Access app at http://localhost:8000"

down:
	docker-compose down -v

logs:
	docker-compose logs -f

shell:
	docker-compose exec app /bin/bash

migrate:
	docker-compose exec app alembic upgrade head

migrate-down:
	docker-compose exec app alembic downgrade -1

seed:
	docker-compose exec app python scripts/seed_data.py

test:
	docker-compose exec app pytest tests/ -v --cov=app --cov-report=term-missing

test-unit:
	docker-compose exec app pytest tests/unit/ -v

test-integration:
	docker-compose exec app pytest tests/integration/ -v

lint:
	docker-compose exec app ruff check app/
	docker-compose exec app mypy app/ --ignore-missing-imports

format:
	docker-compose exec app black app/
	docker-compose exec app isort app/

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name ".coverage" -delete
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".mypy_cache" -exec rm -rf {} +

backup:
	@mkdir -p backups
	docker-compose exec -T postgres pg_dump -U operator operator_db > backups/backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "Backup created in backups/"

restore:
	@echo "Available backups:"
	@ls -1 backups/*.sql 2>/dev/null || echo "No backups found"
	@read -p "Enter backup filename: " filename; \
	docker-compose exec -T postgres psql -U operator -d operator_db < backups/$$filename
	@echo "Restore completed"

prod-up:
	docker-compose -f docker-compose.prod.yml up -d

prod-down:
	docker-compose -f docker-compose.prod.yml down

health:
	curl -f http://localhost:8000/health || echo "Health check failed"