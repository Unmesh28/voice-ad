# Deployment Scripts

This directory contains all deployment and maintenance scripts for the VoiceAd platform.

## Scripts Overview

### 1. setup-ec2.sh
**Purpose**: Automated setup script for fresh Ubuntu EC2 instance

**What it installs**:
- Node.js 20.x
- MongoDB 7.0
- Redis 7.x
- Nginx
- PM2
- FFmpeg
- Essential build tools

**Usage**:
```bash
sudo ./setup-ec2.sh
```

**Duration**: 5-10 minutes

---

### 2. quick-start.sh
**Purpose**: Start all VoiceAd services using PM2

**Usage**:
```bash
./quick-start.sh
```

**What it does**:
- Stops existing PM2 processes
- Starts all backend workers and server
- Saves PM2 configuration
- Displays service status

---

### 3. health-check.sh
**Purpose**: Check status of all services and system health

**Usage**:
```bash
./health-check.sh
```

**Checks**:
- MongoDB status
- Redis status
- Nginx status
- PM2 processes
- Port availability
- Disk usage
- Memory usage
- API health

---

### 4. nginx-voice-ad.conf
**Purpose**: Nginx reverse proxy configuration

**Installation**:
```bash
sudo cp nginx-voice-ad.conf /etc/nginx/sites-available/voice-ad
sudo ln -s /etc/nginx/sites-available/voice-ad /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Quick Start Guide

### Initial Setup (First Time)

1. **Launch EC2 Instance** (Ubuntu 22.04)
2. **Connect to instance**:
   ```bash
   ssh -i your-key.pem ubuntu@YOUR_EC2_IP
   ```
3. **Run setup script**:
   ```bash
   wget https://raw.githubusercontent.com/YOUR_REPO/voice-ad/main/scripts/setup-ec2.sh
   chmod +x setup-ec2.sh
   sudo ./setup-ec2.sh
   ```
4. **Clone repository**:
   ```bash
   cd ~
   git clone YOUR_REPO_URL voice-ad
   cd voice-ad
   ```
5. **Configure environment**:
   ```bash
   cp backend/.env.production backend/.env
   nano backend/.env  # Update API keys and IP
   ```
6. **Build applications**:
   ```bash
   cd backend && npm install && npm run build
   cd ../frontend && npm install && npm run build
   ```
7. **Start services**:
   ```bash
   ./scripts/quick-start.sh
   ```
8. **Setup PM2 startup**:
   ```bash
   pm2 save
   pm2 startup
   ```

### Daily Operations

**Check service health**:
```bash
./scripts/health-check.sh
```

**View logs**:
```bash
pm2 logs
pm2 logs backend-server
```

**Restart services**:
```bash
pm2 restart all
```

**Update application**:
```bash
git pull
cd backend && npm install && npm run build
cd ../frontend && npm install && npm run build
pm2 restart all
```

## Troubleshooting

### Services not starting

```bash
# Check PM2 status
pm2 status

# View error logs
pm2 logs --err

# Restart specific service
pm2 restart backend-server
```

### MongoDB connection failed

```bash
# Check MongoDB status
sudo systemctl status mongod

# Restart MongoDB
sudo systemctl restart mongod

# View MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log
```

### Nginx errors

```bash
# Test configuration
sudo nginx -t

# Check status
sudo systemctl status nginx

# View logs
sudo tail -f /var/log/nginx/error.log
```

## Notes

- All scripts must be run from the repository root directory
- Setup script requires sudo privileges
- Quick start script assumes backend is built
- Health check script requires `jq` and `nc` (netcat)
