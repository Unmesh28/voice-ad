#!/bin/bash
# Configure MongoDB as a single-node replica set for Prisma

echo "🔧 Configuring MongoDB as replica set for Prisma..."

# Stop MongoDB if running
sudo pkill mongod 2>/dev/null || true
sleep 2

# Create MongoDB config file with replica set
sudo tee /etc/mongod.conf > /dev/null <<'EOF'
# mongod.conf - MongoDB configuration for VoiceAd

storage:
  dbPath: /data/db
  journal:
    enabled: true

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb.log

net:
  port: 27017
  bindIp: 127.0.0.1

replication:
  replSetName: rs0
EOF

# Create data directory
sudo mkdir -p /data/db
sudo chown -R $USER:$USER /data/db

# Start MongoDB with replica set config
echo "Starting MongoDB with replica set configuration..."
sudo mongod --config /etc/mongod.conf --fork

sleep 3

# Initialize replica set
echo "Initializing replica set..."
mongosh --eval 'rs.initiate({
  _id: "rs0",
  members: [{ _id: 0, host: "localhost:27017" }]
})' --quiet

sleep 2

# Check status
echo ""
echo "✅ MongoDB configured as replica set!"
echo ""
mongosh --eval "rs.status()" --quiet | head -20
