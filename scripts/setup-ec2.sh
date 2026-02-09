#!/bin/bash

################################################################################
# VoiceAd Platform - EC2 Automated Setup Script
#
# This script sets up a complete production environment for VoiceAd on Ubuntu
# Includes: Node.js, MongoDB, Redis, Nginx, PM2, FFmpeg, and dependencies
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${GREEN}===================================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}===================================================${NC}\n"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root (use sudo)"
   exit 1
fi

log_step "Starting VoiceAd Platform Setup"

################################################################################
# Step 1: System Update
################################################################################

log_step "Step 1: Updating System Packages"
apt update && apt upgrade -y
log_info "System updated successfully"

################################################################################
# Step 2: Install Essential Tools
################################################################################

log_step "Step 2: Installing Essential Tools"
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

log_info "Essential tools installed"

################################################################################
# Step 3: Install Node.js 20.x
################################################################################

log_step "Step 3: Installing Node.js 20.x"

# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install Node.js
apt install -y nodejs

# Verify installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)

log_info "Node.js $NODE_VERSION installed"
log_info "npm $NPM_VERSION installed"

################################################################################
# Step 4: Install MongoDB 7.0
################################################################################

log_step "Step 4: Installing MongoDB 7.0"

# Import MongoDB GPG key
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
   gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
   --dearmor

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
    tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Update and install
apt update
apt install -y mongodb-org

# Start and enable MongoDB
systemctl start mongod
systemctl enable mongod

# Verify installation
MONGO_VERSION=$(mongod --version | head -n 1)
log_info "MongoDB installed: $MONGO_VERSION"
log_info "MongoDB status: $(systemctl is-active mongod)"

################################################################################
# Step 5: Install Redis 7.x
################################################################################

log_step "Step 5: Installing Redis 7.x"

# Add Redis repository
add-apt-repository -y ppa:redislabs/redis

# Install Redis
apt update
apt install -y redis

# Start and enable Redis
systemctl start redis-server
systemctl enable redis-server

# Verify installation
REDIS_VERSION=$(redis-server --version | awk '{print $3}')
log_info "Redis installed: v$REDIS_VERSION"
log_info "Redis status: $(systemctl is-active redis-server)"

################################################################################
# Step 6: Install Nginx
################################################################################

log_step "Step 6: Installing Nginx"

apt install -y nginx

# Start and enable Nginx
systemctl start nginx
systemctl enable nginx

# Verify installation
NGINX_VERSION=$(nginx -v 2>&1 | awk -F/ '{print $2}')
log_info "Nginx installed: $NGINX_VERSION"
log_info "Nginx status: $(systemctl is-active nginx)"

################################################################################
# Step 7: Install FFmpeg
################################################################################

log_step "Step 7: Installing FFmpeg"

apt install -y ffmpeg

# Verify installation
FFMPEG_VERSION=$(ffmpeg -version | head -n 1 | awk '{print $3}')
log_info "FFmpeg installed: $FFMPEG_VERSION"

################################################################################
# Step 8: Install PM2 (Process Manager)
################################################################################

log_step "Step 8: Installing PM2 Process Manager"

npm install -g pm2

# Verify installation
PM2_VERSION=$(pm2 --version)
log_info "PM2 installed: v$PM2_VERSION"

################################################################################
# Step 9: Configure UFW Firewall
################################################################################

log_step "Step 9: Configuring UFW Firewall"

# Install UFW if not present
apt install -y ufw

# Allow SSH (important!)
ufw allow OpenSSH

# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow backend API
ufw allow 5000/tcp

# Allow frontend (temporary)
ufw allow 3000/tcp

log_warn "Firewall rules configured but NOT enabled yet"
log_warn "To enable firewall, run: sudo ufw enable"
log_info "Make sure SSH is working before enabling firewall!"

################################################################################
# Step 10: Create Application User (Optional but Recommended)
################################################################################

log_step "Step 10: Creating Application User"

# Create voicead user if doesn't exist
if ! id -u voicead > /dev/null 2>&1; then
    useradd -m -s /bin/bash voicead
    usermod -aG sudo voicead
    log_info "User 'voicead' created"
else
    log_info "User 'voicead' already exists"
fi

################################################################################
# Step 11: Create Application Directories
################################################################################

log_step "Step 11: Creating Application Directories"

# Create necessary directories
mkdir -p /var/www/voice-ad
mkdir -p /var/log/voice-ad
mkdir -p /home/ubuntu/voice-ad/backend/uploads/{audio,music,mixed}

# Set permissions
chown -R ubuntu:ubuntu /home/ubuntu/voice-ad
chown -R www-data:www-data /var/www/voice-ad
chown -R ubuntu:ubuntu /var/log/voice-ad

log_info "Application directories created"

################################################################################
# Step 12: Configure MongoDB for Production
################################################################################

log_step "Step 12: Configuring MongoDB for Production"

# Backup original config
cp /etc/mongod.conf /etc/mongod.conf.backup

# Configure MongoDB
cat > /etc/mongod.conf << 'EOF'
# MongoDB Configuration for Production

storage:
  dbPath: /var/lib/mongodb
  journal:
    enabled: true

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1

processManagement:
  timeZoneInfo: /usr/share/zoneinfo
EOF

# Restart MongoDB
systemctl restart mongod

log_info "MongoDB configured for production"

################################################################################
# Step 13: Configure Redis for Production
################################################################################

log_step "Step 13: Configuring Redis for Production"

# Backup original config
cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# Configure Redis for BullMQ
cat >> /etc/redis/redis.conf << 'EOF'

# Custom Configuration for VoiceAd + BullMQ
maxmemory 256mb
maxmemory-policy noeviction
save 900 1
save 300 10
save 60 10000
EOF

# Restart Redis
systemctl restart redis-server

log_info "Redis configured for production with noeviction policy"

################################################################################
# Step 14: Install and Configure Logrotate
################################################################################

log_step "Step 14: Configuring Log Rotation"

cat > /etc/logrotate.d/voice-ad << 'EOF'
/var/log/voice-ad/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
}
EOF

log_info "Log rotation configured"

################################################################################
# Summary
################################################################################

log_step "Installation Complete!"

echo -e "${GREEN}Installed Components:${NC}"
echo -e "  ✓ Node.js: $NODE_VERSION"
echo -e "  ✓ npm: v$NPM_VERSION"
echo -e "  ✓ MongoDB: Running on port 27017"
echo -e "  ✓ Redis: Running on port 6379"
echo -e "  ✓ Nginx: Running on port 80"
echo -e "  ✓ FFmpeg: $FFMPEG_VERSION"
echo -e "  ✓ PM2: v$PM2_VERSION"

echo -e "\n${GREEN}Service Status:${NC}"
echo -e "  MongoDB: $(systemctl is-active mongod)"
echo -e "  Redis: $(systemctl is-active redis-server)"
echo -e "  Nginx: $(systemctl is-active nginx)"

echo -e "\n${YELLOW}Next Steps:${NC}"
echo -e "  1. Clone your repository: cd ~ && git clone YOUR_REPO_URL voice-ad"
echo -e "  2. Configure environment variables: cd voice-ad/backend && cp .env.example .env && nano .env"
echo -e "  3. Install dependencies: cd backend && npm install && cd ../frontend && npm install"
echo -e "  4. Build applications: cd backend && npm run build && cd ../frontend && npm run build"
echo -e "  5. Start with PM2: pm2 start ecosystem.config.js"
echo -e "  6. Save PM2 configuration: pm2 save && pm2 startup"
echo -e "  7. (Optional) Enable firewall: sudo ufw enable"

echo -e "\n${GREEN}Setup script completed successfully!${NC}\n"
