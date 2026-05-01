#!/bin/bash

# Database backup script
# Run daily via cron: 0 2 * * * /app/scripts/backup_db.sh

set -e

# Configuration
BACKUP_DIR="/backups"
DB_NAME="operator_db"
DB_USER="operator"
DB_HOST="postgres"
RETENTION_DAYS=30
S3_BUCKET="operator-backups"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Starting database backup at $(date)"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Generate backup filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

# Perform backup
echo "Creating backup: $BACKUP_FILE"
PGPASSWORD="${POSTGRES_PASSWORD:-securepassword}" pg_dump \
    -h $DB_HOST \
    -U $DB_USER \
    -d $DB_NAME \
    -F c \
    -f - | gzip > $BACKUP_FILE

# Check if backup was successful
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup created successfully${NC}"
    BACKUP_SIZE=$(du -h $BACKUP_FILE | cut -f1)
    echo "Backup size: $BACKUP_SIZE"
else
    echo -e "${RED}Backup failed${NC}"
    exit 1
fi

# Upload to S3 if configured
if [ ! -z "$AWS_ACCESS_KEY_ID" ] && [ ! -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "Uploading to S3..."
    aws s3 cp $BACKUP_FILE s3://$S3_BUCKET/backups/ --region ru-central1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Upload to S3 successful${NC}"
    else
        echo -e "${RED}Upload to S3 failed${NC}"
    fi
fi

# Clean old backups
echo "Cleaning backups older than $RETENTION_DAYS days"
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Log backup info
echo "Backup completed at $(date)" >> $BACKUP_DIR/backup.log
echo "File: $BACKUP_FILE" >> $BACKUP_DIR/backup.log

# Send notification to healthcheck (optional)
if [ ! -z "$HEALTHCHECK_URL" ]; then
    curl -fsS -m 10 --retry 5 -o /dev/null "$HEALTHCHECK_URL"
fi

echo -e "${GREEN}Backup process finished${NC}"