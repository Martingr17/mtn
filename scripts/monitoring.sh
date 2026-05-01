#!/bin/bash

# Monitoring script for health checks
# Run every minute via cron: * * * * * /app/scripts/monitoring.sh

set -e

APP_URL="http://localhost:8000/health"
WEBHOOK_URL="${ALERT_WEBHOOK_URL}"

check_health() {
    response=$(curl -s -o /dev/null -w "%{http_code}" $APP_URL)
    
    if [ "$response" != "200" ]; then
        echo "Health check failed with status: $response"
        
        # Send alert
        if [ ! -z "$WEBHOOK_URL" ]; then
            curl -X POST $WEBHOOK_URL \
                -H "Content-Type: application/json" \
                -d "{\"text\": \"⚠️ Operator App Health Check Failed! Status: $response\"}"
        fi
        
        return 1
    fi
    
    return 0
}

check_disk_space() {
    usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ $usage -gt 90 ]; then
        echo "Disk space critical: $usage%"
        
        if [ ! -z "$WEBHOOK_URL" ]; then
            curl -X POST $WEBHOOK_URL \
                -H "Content-Type: application/json" \
                -d "{\"text\": \"⚠️ Disk Space Critical: $usage%\"}"
        fi
    fi
}

check_memory() {
    mem_available=$(free -m | awk 'NR==2 {print $7}')
    mem_total=$(free -m | awk 'NR==2 {print $2}')
    mem_percent=$(( (mem_total - mem_available) * 100 / mem_total ))
    
    if [ $mem_percent -gt 90 ]; then
        echo "Memory usage critical: $mem_percent%"
        
        if [ ! -z "$WEBHOOK_URL" ]; then
            curl -X POST $WEBHOOK_URL \
                -H "Content-Type: application/json" \
                -d "{\"text\": \"⚠️ Memory Usage Critical: $mem_percent%\"}"
        fi
    fi
}

# Run checks
check_health
check_disk_space
check_memory

echo "Monitoring check completed at $(date)"