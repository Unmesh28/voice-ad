#!/bin/bash

################################################################################
# Fix Redis Eviction Policy for BullMQ
#
# BullMQ requires Redis eviction policy to be "noeviction" to prevent
# job queue data from being evicted from memory
################################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Fixing Redis Eviction Policy...${NC}\n"

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    REDIS_CONF="/opt/homebrew/etc/redis.conf"
    if [ ! -f "$REDIS_CONF" ]; then
        REDIS_CONF="/usr/local/etc/redis.conf"
    fi
    REDIS_SERVICE="redis"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    REDIS_CONF="/etc/redis/redis.conf"
    if [ ! -f "$REDIS_CONF" ]; then
        REDIS_CONF="/etc/redis.conf"
    fi
    REDIS_SERVICE="redis-server"
else
    echo -e "${RED}Unsupported OS${NC}"
    exit 1
fi

# Check if Redis config exists
if [ ! -f "$REDIS_CONF" ]; then
    echo -e "${RED}Redis configuration file not found at: $REDIS_CONF${NC}"
    echo -e "${YELLOW}Please locate your redis.conf file and update it manually${NC}"
    exit 1
fi

echo -e "${GREEN}Found Redis config: $REDIS_CONF${NC}"

# Backup original config
echo -e "${YELLOW}Creating backup...${NC}"
sudo cp "$REDIS_CONF" "${REDIS_CONF}.backup.$(date +%Y%m%d_%H%M%S)"

# Check current eviction policy
CURRENT_POLICY=$(grep "^maxmemory-policy" "$REDIS_CONF" | awk '{print $2}')
echo -e "${YELLOW}Current eviction policy: ${CURRENT_POLICY:-not set}${NC}"

# Update eviction policy
echo -e "${YELLOW}Updating eviction policy to 'noeviction'...${NC}"

if grep -q "^maxmemory-policy" "$REDIS_CONF"; then
    # Policy exists, update it
    sudo sed -i.bak 's/^maxmemory-policy.*/maxmemory-policy noeviction/' "$REDIS_CONF"
else
    # Policy doesn't exist, add it
    echo "" | sudo tee -a "$REDIS_CONF" > /dev/null
    echo "# BullMQ requires noeviction policy" | sudo tee -a "$REDIS_CONF" > /dev/null
    echo "maxmemory-policy noeviction" | sudo tee -a "$REDIS_CONF" > /dev/null
fi

# Verify the change
NEW_POLICY=$(grep "^maxmemory-policy" "$REDIS_CONF" | awk '{print $2}')
echo -e "${GREEN}New eviction policy: $NEW_POLICY${NC}"

# Restart Redis
echo -e "${YELLOW}Restarting Redis...${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS with Homebrew
    brew services restart redis 2>/dev/null || {
        echo -e "${YELLOW}Homebrew services not available, trying manual restart...${NC}"
        redis-cli shutdown 2>/dev/null || true
        sleep 1
        redis-server "$REDIS_CONF" --daemonize yes
    }
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux with systemd
    sudo systemctl restart redis-server 2>/dev/null || sudo systemctl restart redis
fi

# Wait for Redis to start
sleep 2

# Verify Redis is running and check policy
echo -e "\n${YELLOW}Verifying Redis configuration...${NC}"
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis is running${NC}"

    # Check the actual running config
    RUNNING_POLICY=$(redis-cli CONFIG GET maxmemory-policy | tail -n 1)
    echo -e "${GREEN}✓ Running eviction policy: $RUNNING_POLICY${NC}"

    if [ "$RUNNING_POLICY" = "noeviction" ]; then
        echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}  Redis eviction policy fixed successfully!${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
        echo -e "${YELLOW}You can now restart your backend server.${NC}"
        echo -e "${YELLOW}The BullMQ warnings should be gone.${NC}\n"
    else
        echo -e "\n${RED}Warning: Policy in config file doesn't match running config${NC}"
        echo -e "${YELLOW}Try restarting Redis manually or your computer${NC}\n"
    fi
else
    echo -e "${RED}✗ Redis is not running${NC}"
    echo -e "${YELLOW}Please start Redis manually and try again${NC}"
    exit 1
fi
