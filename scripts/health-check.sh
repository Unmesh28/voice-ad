#!/bin/bash

################################################################################
# VoiceAd Platform - Health Check Script
#
# Checks the status of all services and dependencies
################################################################################

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check function
check_service() {
    local service=$1
    local status=$(systemctl is-active $service 2>/dev/null)

    if [ "$status" = "active" ]; then
        echo -e "  ${GREEN}✓${NC} $service: Running"
        return 0
    else
        echo -e "  ${RED}✗${NC} $service: Not running"
        return 1
    fi
}

# Check port function
check_port() {
    local port=$1
    local name=$2

    if nc -z localhost $port 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $name (port $port): Listening"
        return 0
    else
        echo -e "  ${RED}✗${NC} $name (port $port): Not listening"
        return 1
    fi
}

echo -e "${YELLOW}═══════════════════════════════════════════${NC}"
echo -e "${YELLOW}  VoiceAd Platform - Health Check${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════${NC}\n"

# System Services
echo -e "${YELLOW}System Services:${NC}"
check_service mongod
check_service redis-server
check_service nginx

# Port Checks
echo -e "\n${YELLOW}Port Availability:${NC}"
check_port 27017 "MongoDB"
check_port 6379 "Redis"
check_port 80 "Nginx"
check_port 5000 "Backend API"

# PM2 Processes
echo -e "\n${YELLOW}PM2 Processes:${NC}"
if command -v pm2 &> /dev/null; then
    pm2_list=$(pm2 jlist 2>/dev/null)
    if [ $? -eq 0 ] && [ "$pm2_list" != "[]" ]; then
        online_count=$(echo "$pm2_list" | jq -r '[.[] | select(.pm2_env.status == "online")] | length' 2>/dev/null || echo "0")
        stopped_count=$(echo "$pm2_list" | jq -r '[.[] | select(.pm2_env.status != "online")] | length' 2>/dev/null || echo "0")

        echo -e "  ${GREEN}✓${NC} PM2 is running"
        echo -e "    Online processes: $online_count"

        if [ "$stopped_count" -gt 0 ]; then
            echo -e "    ${RED}Stopped processes: $stopped_count${NC}"
        fi
    else
        echo -e "  ${YELLOW}⚠${NC} No PM2 processes found"
    fi
else
    echo -e "  ${RED}✗${NC} PM2 not installed"
fi

# Disk Space
echo -e "\n${YELLOW}Disk Usage:${NC}"
disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$disk_usage" -lt 80 ]; then
    echo -e "  ${GREEN}✓${NC} Disk usage: ${disk_usage}%"
else
    echo -e "  ${RED}⚠${NC} Disk usage: ${disk_usage}% (High)"
fi

# Memory Usage
echo -e "\n${YELLOW}Memory Usage:${NC}"
mem_usage=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$mem_usage" -lt 80 ]; then
    echo -e "  ${GREEN}✓${NC} Memory usage: ${mem_usage}%"
else
    echo -e "  ${YELLOW}⚠${NC} Memory usage: ${mem_usage}% (High)"
fi

# API Health Check
echo -e "\n${YELLOW}API Health Check:${NC}"
api_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health 2>/dev/null)
if [ "$api_response" = "200" ]; then
    echo -e "  ${GREEN}✓${NC} Backend API: Healthy (HTTP 200)"
else
    echo -e "  ${RED}✗${NC} Backend API: Unhealthy (HTTP $api_response)"
fi

echo -e "\n${YELLOW}═══════════════════════════════════════════${NC}\n"

# Summary
echo -e "${YELLOW}Quick Commands:${NC}"
echo -e "  View PM2 logs: pm2 logs"
echo -e "  Restart all: pm2 restart all"
echo -e "  Check MongoDB: sudo systemctl status mongod"
echo -e "  Check Redis: sudo systemctl status redis-server"
echo -e "  Check Nginx: sudo systemctl status nginx"
