#!/bin/bash
# Pre-dev script to ensure databases are running

echo "🔍 Checking database services..."

# Check Redis
if ! redis-cli ping > /dev/null 2>&1; then
    echo "⚠️  Redis not running. Starting Redis..."
    sudo redis-server --daemonize yes
    sleep 1
    redis-cli CONFIG SET maxmemory-policy noeviction > /dev/null 2>&1
    echo "✓ Redis started"
else
    echo "✓ Redis is running"
    redis-cli CONFIG SET maxmemory-policy noeviction > /dev/null 2>&1
fi

# Check MongoDB
if ! mongosh --eval "db.runCommand({ ping: 1 })" --quiet > /dev/null 2>&1; then
    echo "⚠️  MongoDB not running."

    # Try to start MongoDB if installed
    if command -v mongod &> /dev/null; then
        echo "  Starting MongoDB..."
        sudo mkdir -p /data/db
        sudo mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db > /dev/null 2>&1
        sleep 2
        echo "✓ MongoDB started"
    else
        echo ""
        echo "❌ MongoDB is not installed!"
        echo ""
        echo "Quick setup options:"
        echo ""
        echo "1. Use MongoDB Atlas (Recommended - Free & No installation):"
        echo "   - Visit: https://cloud.mongodb.com/"
        echo "   - Create free account and cluster"
        echo "   - Get connection string"
        echo "   - Update DATABASE_URL in backend/.env"
        echo ""
        echo "2. Install MongoDB locally:"
        echo "   curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -"
        echo "   echo \"deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse\" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list"
        echo "   sudo apt-get update && sudo apt-get install -y mongodb-org"
        echo "   sudo mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db"
        echo ""
        exit 1
    fi
else
    echo "✓ MongoDB is running"
fi

echo "✅ All databases ready!"
