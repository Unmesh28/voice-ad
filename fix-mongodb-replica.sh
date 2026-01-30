#!/bin/bash
# Quick fix to configure MongoDB as replica set

echo "🔧 Configuring MongoDB as replica set..."

# Find MongoDB config file
if [ -f /etc/mongod.conf ]; then
    CONFIG_FILE=/etc/mongod.conf
elif [ -f /etc/mongodb.conf ]; then
    CONFIG_FILE=/etc/mongodb.conf
else
    echo "Creating default config at /etc/mongod.conf..."
    sudo tee /etc/mongod.conf > /dev/null <<'MONGOCONF'
storage:
  dbPath: /var/lib/mongodb
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 127.0.0.1
replication:
  replSetName: rs0
MONGOCONF
    CONFIG_FILE=/etc/mongod.conf
fi

echo "Found config: $CONFIG_FILE"

# Backup existing config
sudo cp $CONFIG_FILE ${CONFIG_FILE}.backup

# Add replication config if not present
if ! grep -q "replSetName" $CONFIG_FILE; then
    echo "Adding replica set configuration..."
    sudo tee -a $CONFIG_FILE > /dev/null <<'REPLCONF'

# Replication configuration for Prisma
replication:
  replSetName: rs0
REPLCONF
    echo "✓ Config updated"
else
    echo "✓ Replication config already exists"
fi

# Restart MongoDB
echo "Restarting MongoDB..."
if command -v systemctl &> /dev/null; then
    sudo systemctl restart mongod
elif command -v service &> /dev/null; then
    sudo service mongod restart
else
    sudo pkill mongod
    sleep 2
    sudo mongod --config $CONFIG_FILE --fork
fi

sleep 3

# Initialize replica set
echo "Initializing replica set..."
mongosh --quiet --eval 'try { rs.status(); print("✓ Replica set already initialized"); } catch(e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] }); print("✓ Replica set initialized"); }'

echo ""
echo "✅ MongoDB is now configured as a replica set!"
echo ""
echo "Restart your backend with: npm run dev"
