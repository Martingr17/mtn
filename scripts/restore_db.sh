#!/bin/bash

# Database restore script
# Usage: ./restore_db.sh <backup_file>

set -e

# Configuration
DB_NAME="operator_db"
DB_USER="operator"
DB_HOST="postgres"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$1" ]; then
    echo -e "${RED}Error: Please specify backup file${NC}"
    echo "Usage: $0 <backup_file>"
    echo "Available backups:"
    ls -1 /backups/backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

echo -e "${YELLOW}WARNING: This will overwrite the current database!${NC}"
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

echo "Starting database restore from $BACKUP_FILE"

# Drop and recreate database
echo "Dropping existing database..."
PGPASSWORD="${POSTGRES_PASSWORD:-securepassword}" dropdb -h $DB_HOST -U $DB_USER --if-exists $DB_NAME
PGPASSWORD="${POSTGRES_PASSWORD:-securepassword}" createdb -h $DB_HOST -U $DB_USER $DB_NAME

# Restore from backup
echo "Restoring data..."
gunzip -c $BACKUP_FILE | PGPASSWORD="${POSTGRES_PASSWORD:-securepassword}" pg_restore \
    -h $DB_HOST \
    -U $DB_USER \
    -d $DB_NAME \
    --clean \
    --if-exists \
    --no-owner

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Database restore completed successfully${NC}"
else
    echo -e "${RED}Database restore failed${NC}"
    exit 1
fi

# Run migrations to ensure schema is up to date
echo "Running migrations..."
alembic upgrade head

echo -e "${GREEN}Restore process finished${NC}"