# VoiceAd Platform - AWS EC2 Deployment Guide

Complete guide to deploy VoiceAd platform on AWS EC2 with automatic restart and recovery.

## Prerequisites

- AWS Account
- ElevenLabs API Key
- OpenAI API Key

## Step 1: Launch EC2 Instance

### Instance Configuration

1. **Go to AWS EC2 Console**
   - Navigate to EC2 Dashboard
   - Click "Launch Instance"

2. **Choose AMI**
   - Select: **Ubuntu Server 22.04 LTS (HVM), SSD Volume Type**
   - Architecture: 64-bit (x86)

3. **Choose Instance Type**
   - Recommended: **t3.medium** (2 vCPU, 4 GB RAM) or larger
   - For production: **t3.large** or **t3.xlarge**

4. **Configure Instance**
   - Network: Default VPC
   - Auto-assign Public IP: **Enable**
   - Storage: **30 GB** SSD (minimum, increase based on audio file storage needs)

5. **Configure Security Group**
   Create a new security group with these rules:

   | Type | Protocol | Port Range | Source | Description |
   |------|----------|------------|--------|-------------|
   | SSH | TCP | 22 | Your IP | SSH access |
   | HTTP | TCP | 80 | 0.0.0.0/0 | HTTP access |
   | Custom TCP | TCP | 5000 | 0.0.0.0/0 | Backend API |
   | Custom TCP | TCP | 3000 | 0.0.0.0/0 | Frontend (temp) |

6. **Create/Select Key Pair**
   - Create a new key pair or use existing
   - Download `.pem` file and keep it safe
   - Set permissions: `chmod 400 your-key.pem`

7. **Launch Instance**
   - Review and launch
   - Note down the **Public IPv4 Address**

## Step 2: Connect to EC2 Instance

```bash
# SSH into your EC2 instance
ssh -i /path/to/your-key.pem ubuntu@YOUR_EC2_IP_ADDRESS
```

## Step 3: Run Automated Setup Script

### Download and Execute Setup Script

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Download the setup script
wget https://raw.githubusercontent.com/YOUR_REPO/voice-ad/main/scripts/setup-ec2.sh

# Make it executable
chmod +x setup-ec2.sh

# Run the setup script
sudo ./setup-ec2.sh
```

**OR** if you have the repository cloned:

```bash
# Clone repository
git clone https://github.com/YOUR_REPO/voice-ad.git
cd voice-ad

# Make setup script executable
chmod +x scripts/setup-ec2.sh

# Run setup
sudo ./scripts/setup-ec2.sh
```

The setup script will automatically install:
- ✅ Node.js 20.x
- ✅ MongoDB 7.0
- ✅ Redis 7.x
- ✅ Nginx
- ✅ PM2 (Process Manager)
- ✅ FFmpeg (for audio processing)
- ✅ Build tools and dependencies

## Step 4: Configure Environment Variables

```bash
cd ~/voice-ad/backend

# Copy environment template
cp .env.example .env

# Edit environment file
nano .env
```

**Update these critical values:**

```bash
# Production Settings
NODE_ENV=production
PORT=5000
FRONTEND_URL=http://YOUR_EC2_IP_ADDRESS

# Database
DATABASE_URL=mongodb://localhost:27017/voicead_db

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secrets (CHANGE THESE!)
JWT_SECRET=your-super-secret-production-jwt-key-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-production-refresh-key-min-32-chars

# API Keys (REQUIRED)
ELEVENLABS_API_KEY=your_actual_elevenlabs_api_key
OPENAI_API_KEY=your_actual_openai_api_key

# File Storage
UPLOAD_DIR=./uploads
```

**For Frontend:**

```bash
cd ~/voice-ad/frontend

# Create environment file
nano .env
```

```bash
VITE_API_URL=http://YOUR_EC2_IP_ADDRESS:5000
```

## Step 5: Build and Deploy

```bash
# Install dependencies and build
cd ~/voice-ad

# Backend - Install all dependencies (including TypeScript for building)
cd backend
npm install
npm run build
npm prune --production  # Remove dev dependencies after building (saves disk space)

# Frontend
cd ../frontend
npm install
npm run build
```

## Step 6: Start with PM2 (Auto-Restart)

```bash
# Start applications with PM2
cd ~/voice-ad

# Start backend workers and server
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Setup PM2 to start on system boot
pm2 startup systemd
# Run the command that PM2 outputs

# Check status
pm2 status
pm2 logs
```

## Step 7: Configure Nginx (Optional but Recommended)

```bash
# Copy nginx configuration
sudo cp ~/voice-ad/scripts/nginx-voice-ad.conf /etc/nginx/sites-available/voice-ad

# Enable site
sudo ln -s /etc/nginx/sites-available/voice-ad /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## Step 8: Access Your Application

Open your browser and navigate to:

- **Frontend**: `http://YOUR_EC2_IP_ADDRESS`
- **Backend API**: `http://YOUR_EC2_IP_ADDRESS:5000`
- **Health Check**: `http://YOUR_EC2_IP_ADDRESS:5000/health`

## Auto-Restart Configuration

PM2 automatically handles:
- ✅ Process crashes → Auto restart
- ✅ Server reboot → Auto start all processes
- ✅ Memory limits → Auto restart if exceeded
- ✅ Log rotation → Prevents disk space issues

### Monitor Processes

```bash
# View all processes
pm2 status

# View logs (real-time)
pm2 logs

# View specific app logs
pm2 logs backend-server
pm2 logs backend-worker-script
pm2 logs backend-worker-tts
pm2 logs backend-worker-music
pm2 logs backend-worker-mixing

# Monitor CPU/Memory
pm2 monit

# Restart specific app
pm2 restart backend-server

# Restart all apps
pm2 restart all

# Stop all apps
pm2 stop all

# Delete all apps
pm2 delete all
```

## Troubleshooting

### Check Service Status

```bash
# MongoDB
sudo systemctl status mongod
sudo systemctl restart mongod

# Redis
sudo systemctl status redis
sudo systemctl restart redis

# Nginx
sudo systemctl status nginx
sudo systemctl restart nginx

# PM2 Processes
pm2 status
pm2 logs --err
```

### Check Logs

```bash
# Backend logs
pm2 logs backend-server

# Worker logs
pm2 logs backend-worker-script

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# Redis logs
sudo tail -f /var/log/redis/redis-server.log
```

### Common Issues

**Issue: Port 5000 already in use**
```bash
# Find process using port
sudo lsof -i :5000

# Kill process
sudo kill -9 PID
```

**Issue: MongoDB connection failed**
```bash
# Start MongoDB
sudo systemctl start mongod

# Check status
sudo systemctl status mongod
```

**Issue: Out of disk space**
```bash
# Check disk usage
df -h

# Clean old logs
pm2 flush
```

**Issue: PM2 processes not starting**
```bash
# Delete all processes and restart
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

## Maintenance Commands

```bash
# Update application
cd ~/voice-ad
git pull
cd backend && npm install && npm run build
cd ../frontend && npm install && npm run build
pm2 restart all

# Clear logs
pm2 flush

# Reset PM2
pm2 kill
pm2 start ecosystem.config.js
pm2 save

# Backup database
mongodump --db voicead_db --out ~/backups/$(date +%Y%m%d)
```

## Security Recommendations

1. **Change default ports** (configure in Security Group)
2. **Use SSH key authentication only** (disable password auth)
3. **Enable UFW firewall**
   ```bash
   sudo ufw allow ssh
   sudo ufw allow http
   sudo ufw allow 5000
   sudo ufw enable
   ```
4. **Regular updates**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
5. **Monitor logs regularly**
6. **Set up CloudWatch** for monitoring
7. **Create AMI backups** regularly

## Production Checklist

- [ ] EC2 instance launched with appropriate size
- [ ] Security group configured correctly
- [ ] SSH key pair created and secured
- [ ] Setup script executed successfully
- [ ] Environment variables configured
- [ ] API keys added (ElevenLabs, OpenAI)
- [ ] MongoDB running and accessible
- [ ] Redis running and accessible
- [ ] Backend built and running via PM2
- [ ] Frontend built and served
- [ ] Nginx configured (if using)
- [ ] PM2 startup script configured
- [ ] Application accessible via browser
- [ ] Auto-restart tested
- [ ] Logs monitored
- [ ] Firewall configured

## Next Steps (Optional)

1. **Set up domain name** with Route 53
2. **Add SSL certificate** with Let's Encrypt
3. **Set up S3** for audio file storage
4. **Configure CloudWatch** for monitoring
5. **Set up RDS** for managed MongoDB (optional)
6. **Add load balancer** for high availability
7. **Configure auto-scaling**

## Support

For issues or questions, refer to the main README.md or create an issue in the repository.
