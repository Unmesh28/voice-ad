#!/bin/bash
# Quick Database Services Startup Script

set -e

echo "=== Starting Database Services ==="

# Start MongoDB
echo "Starting MongoDB..."
if command -v mongod &> /dev/null; then
    sudo mongod --fork --logpath /var/log/mongodb.log --dbpath /var/lib/mongodb
    echo "✓ MongoDB started"
else
    echo "✗ MongoDB not installed. Installing..."
    sudo apt-get update
    sudo apt-get install -y mongodb
    sudo mkdir -p /var/lib/mongodb /var/log
    sudo mongod --fork --logpath /var/log/mongodb.log --dbpath /var/lib/mongodb
    echo "✓ MongoDB installed and started"
fi

# Start Redis
echo "Starting Redis..."
if command -v redis-server &> /dev/null; then
    if pgrep redis-server > /dev/null; then
        echo "Redis already running"
    else
        sudo redis-server /etc/redis/redis.conf --daemonize yes
        echo "✓ Redis started"
    fi

    # Fix Redis eviction policy for BullMQ
    echo "Configuring Redis eviction policy..."
    redis-cli CONFIG SET maxmemory-policy noeviction
    echo "✓ Redis eviction policy set to noeviction"
else
    echo "✗ Redis not installed. Installing..."
    sudo apt-get install -y redis-server
    sudo redis-server --daemonize yes
    redis-cli CONFIG SET maxmemory-policy noeviction
    echo "✓ Redis installed and configured"
fi

echo ""
echo "=== Service Status ==="
echo "MongoDB: $(pgrep mongod > /dev/null && echo '✓ Running' || echo '✗ Not running')"
echo "Redis: $(pgrep redis-server > /dev/null && echo '✓ Running' || echo '✗ Not running')"
echo ""
echo "Testing connections..."
echo -n "MongoDB: "
mongosh --eval "db.runCommand({ ping: 1 })" --quiet && echo "✓ Connected" || echo "✗ Connection failed"
echo -n "Redis: "
redis-cli ping && echo "✓ Connected" || echo "✗ Connection failed"

echo ""
echo "=== Setup Complete ==="
