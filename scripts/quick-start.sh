#!/bin/bash

################################################################################
# VoiceAd Platform - Quick Start Script
#
# Run this after initial setup to start all services
################################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting VoiceAd Platform...${NC}\n"

# Check if we're in the right directory
if [ ! -f "ecosystem.config.js" ]; then
    echo -e "${RED}Error: ecosystem.config.js not found${NC}"
    echo -e "${YELLOW}Please run this script from the voice-ad root directory${NC}"
    exit 1
fi

# Create logs directory
echo -e "${YELLOW}Creating logs directory...${NC}"
mkdir -p logs

# Check environment file
if [ ! -f "backend/.env" ]; then
    echo -e "${RED}Error: backend/.env not found${NC}"
    echo -e "${YELLOW}Please create backend/.env from backend/.env.example${NC}"
    exit 1
fi

# Stop any existing PM2 processes
echo -e "${YELLOW}Stopping existing PM2 processes...${NC}"
pm2 delete all 2>/dev/null || true

# Start all processes with PM2
echo -e "${YELLOW}Starting backend services with PM2...${NC}"
pm2 start ecosystem.config.js

# Save PM2 process list
echo -e "${YELLOW}Saving PM2 configuration...${NC}"
pm2 save

# Display status
echo -e "\n${GREEN}Services started successfully!${NC}\n"
pm2 status

# Display logs command
echo -e "\n${YELLOW}Useful commands:${NC}"
echo -e "  View logs: pm2 logs"
echo -e "  Monitor: pm2 monit"
echo -e "  Restart: pm2 restart all"
echo -e "  Stop: pm2 stop all"

echo -e "\n${GREEN}VoiceAd Platform is now running!${NC}"
echo -e "Backend API: http://localhost:5011"
echo -e "Health check: http://localhost:5011/health"
