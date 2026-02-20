#!/bin/bash
# Nginx Setup Script for VoiceAd Platform

set -e

echo "=== Setting up Nginx for VoiceAd ===" # 1. Create web root directory if it doesn't exist
sudo mkdir -p /var/www/html

# 2. Copy frontend build files
echo "Copying frontend build files..."
sudo cp -r /home/user/voice-ad/frontend/dist/* /var/www/html/

# 3. Create Nginx configuration
echo "Creating Nginx configuration..."
sudo tee /etc/nginx/conf.d/voice-ad.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    # Frontend - React App
    root /var/www/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Frontend routes (React Router)
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    # Static assets caching
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://localhost:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long-running requests
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Serve uploaded audio files and generated content
    location /uploads/ {
        alias /home/user/voice-ad/backend/uploads/;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
        add_header Cache-Control "public, max-age=3600";

        # Support audio streaming
        add_header Accept-Ranges bytes;
        types {
            audio/mpeg mp3;
            audio/wav wav;
            application/json json;
        }
    }
}
EOF

# 4. Test Nginx configuration
echo "Testing Nginx configuration..."
sudo nginx -t

# 5. Restart Nginx
echo "Restarting Nginx..."
sudo service nginx restart || sudo systemctl restart nginx || sudo nginx -s reload

echo "=== Nginx setup complete! ==="
echo "Your app should now be available at: http://YOUR_SERVER_IP"
echo "Backend API: http://YOUR_SERVER_IP/api/"
echo "Frontend: http://YOUR_SERVER_IP/"
