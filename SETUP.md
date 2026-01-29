# VoiceAd Platform - Local Setup Guide (Mac)

Complete guide to set up and run the VoiceAd AI audio production platform locally on Mac.

## Prerequisites Installation

### 1. Install Homebrew (if not already installed)
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Node.js (v18+)
```bash
brew install node@20
node --version  # Should show v20.x.x
```

### 3. Install MongoDB
```bash
# Add MongoDB tap
brew tap mongodb/brew

# Install MongoDB Community Edition
brew install mongodb-community

# Start MongoDB service
brew services start mongodb-community

# Verify MongoDB is running
brew services list | grep mongodb
# Should show: mongodb-community started

# Test connection
mongosh
# Type 'exit' to quit
```

### 4. Install Redis
```bash
# Install Redis
brew install redis

# Start Redis service
brew services start redis

# Test Redis
redis-cli ping
# Should return: PONG
```

### 5. Install FFmpeg (for audio mixing)
```bash
brew install ffmpeg
ffmpeg -version
```

## Project Setup

### Backend Setup

```bash
# Clone or navigate to project
cd /path/to/voice-ad/backend

# Install dependencies
npm install

# The .env file is already configured with:
# - MongoDB connection: mongodb://localhost:27017/voicead_db
# - Redis connection: redis://localhost:6379
# - Your API keys (ElevenLabs & OpenAI)
# - JWT secrets for authentication

# Generate Prisma Client for MongoDB
npx prisma generate

# Push schema to MongoDB (no migrations needed!)
npx prisma db push

# Create upload directories
mkdir -p uploads/audio uploads/music uploads/productions

# Start backend server
npm run dev
```

**Expected Output:**
```
✓ Database connected successfully
✓ Script generation worker started
✓ TTS generation worker started  
✓ Music generation worker started
✓ Audio mixing worker started
✓ Server running on port 5000
✓ Environment: development
```

### Frontend Setup (New Terminal Window)

```bash
# Navigate to frontend directory
cd /path/to/voice-ad/frontend

# Install dependencies
npm install

# Create environment file
cat > .env.local << 'ENVEOF'
VITE_API_URL=http://localhost:5000/api
VITE_APP_NAME=VoiceAd
ENVEOF

# Start frontend
npm run dev
```

**Expected Output:**
```
VITE v5.x.x ready in xxx ms

➜  Local:   http://localhost:3000/
➜  Network: use --host to expose
```

## Verify Installation

### Check All Services

```bash
# MongoDB status
brew services list | grep mongodb
mongosh --eval "db.version()"

# Redis status
redis-cli ping

# Backend
curl http://localhost:5000/health

# Frontend
open http://localhost:3000
```

## Using the Platform

### 1. Register & Login
- Open browser: http://localhost:3000
- Click "Register" 
- Create account with email and password
- Login

### 2. Create a Project
- Navigate to "Projects"
- Click "Create New Project"
- Enter name: "My First Ad Campaign"
- Add description (optional)

### 3. Generate AI Script
- Go to "Script Generator"
- Select your project
- Enter prompt: "Create a 30-second ad for a coffee shop called 'Java Heaven' targeting morning commuters"
- Set tone: "Friendly"
- Set length: "Short"
- Click "Generate Script"
- Wait for AI to generate (uses OpenAI GPT-4)

### 4. Convert to Speech
- Go to "TTS Generator" 
- Paste your script
- Browse available voices
- Select a voice (e.g., "Rachel" for professional female voice)
- Adjust voice settings if needed
- Click "Generate Audio"
- Listen to preview

### 5. Generate Background Music (Optional)
- Go to "Music Generator"
- Enter description: "upbeat cafe background music"
- Select mood: "Energetic"
- Select genre: "Electronic"
- Set duration: 30 seconds
- Click "Generate Music"
- Preview the music

### 6. Mix Production
- Go to "Production" page
- **Source Selection:**
  - Select your project
  - Select the script with generated voice
  - Select background music (optional)

- **Audio Settings:**
  - Voice Volume: 100%
  - Music Volume: 30%
  - Fade In: 2s
  - Fade Out: 2s
  - Audio Ducking: ON (automatically lowers music when voice plays)
  - Output Format: MP3

- Click "Mix Audio Production"
- Wait for processing (10-30 seconds)
- Listen to final production
- Download MP3 file

## MongoDB Management

### View Database
```bash
# Open MongoDB shell
mongosh

# Switch to voicead database
use voicead_db

# Show all collections
show collections

# View users
db.users.find().pretty()

# View projects
db.projects.find().pretty()

# View scripts
db.scripts.find().pretty()

# Exit
exit
```

### Prisma Studio (GUI)
```bash
cd backend
npx prisma studio
# Opens at http://localhost:5555
```

## Troubleshooting

### MongoDB Issues

**MongoDB won't start:**
```bash
brew services restart mongodb-community
```

**Can't connect to MongoDB:**
```bash
# Check logs
tail -f /opt/homebrew/var/log/mongodb/mongo.log

# Test connection
mongosh mongodb://localhost:27017
```

**Reset database:**
```bash
cd backend
npx prisma db push --force-reset
```

### Redis Issues

**Redis not responding:**
```bash
brew services restart redis
redis-cli ping
```

### Backend Issues

**Port 5000 already in use:**
```bash
lsof -ti:5000 | xargs kill -9
```

**Prisma errors:**
```bash
cd backend
rm -rf node_modules
npm install
npx prisma generate
npx prisma db push
```

**API Key errors:**
Check your `.env` file:
```bash
cat backend/.env | grep API_KEY
```

### Frontend Issues

**Port 3000 already in use:**
```bash
lsof -ti:3000 | xargs kill -9
```

**Can't connect to backend:**
```bash
# Verify backend is running
curl http://localhost:5000/health

# Check frontend .env.local
cat frontend/.env.local
```

## Development Workflow

### Daily Development

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Terminal 3 - Database GUI (optional):**
```bash
cd backend
npx prisma studio
```

### Making Schema Changes

```bash
# Edit: backend/prisma/schema.prisma

# Regenerate client
npx prisma generate

# Push changes to MongoDB
npx prisma db push

# Restart backend
# (Ctrl+C in Terminal 1, then npm run dev)
```

## API Credentials

Your API keys are already configured in `backend/.env`:

- **ElevenLabs API Key:** For Text-to-Speech and Music Generation
- **OpenAI API Key:** For AI Script Generation

To check usage:
- ElevenLabs: https://elevenlabs.io/app/usage
- OpenAI: https://platform.openai.com/usage

## Tech Stack Summary

**Backend:**
- Node.js + Express + TypeScript
- MongoDB + Prisma ORM
- Redis + BullMQ (job queues)
- FFmpeg (audio processing)
- ElevenLabs API (TTS + Music)
- OpenAI API (Script generation)

**Frontend:**
- React 18 + TypeScript
- Vite (build tool)
- Material-UI (components)
- TanStack Query (data fetching)
- Zustand (state management)

## File Structure

```
voice-ad/
├── backend/
│   ├── src/
│   │   ├── controllers/     # Request handlers
│   │   ├── services/        # Business logic
│   │   ├── jobs/            # Background workers
│   │   ├── middleware/      # Express middleware
│   │   ├── routes/          # API routes
│   │   └── config/          # Configuration
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   ├── uploads/             # Audio files
│   ├── .env                 # Environment variables
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── pages/           # Page components
    │   ├── components/      # Reusable components
    │   ├── services/        # API services
    │   └── types/           # TypeScript types
    ├── .env.local           # Frontend environment
    └── package.json
```

## Useful Commands

```bash
# Backend
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Run production build

# Frontend  
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build

# Database
npx prisma generate  # Generate Prisma Client
npx prisma db push   # Sync schema with MongoDB
npx prisma studio    # Open database GUI

# Services
brew services start mongodb-community
brew services start redis
brew services stop mongodb-community
brew services restart redis
```

## Support

For issues or questions:
1. Check troubleshooting section above
2. Verify all services are running
3. Check logs in terminal output
4. Review `.env` configuration

## Production Deployment

For production deployment, you'll need to:
1. Set `NODE_ENV=production`
2. Use MongoDB Atlas (cloud MongoDB)
3. Use managed Redis (e.g., Redis Cloud)
4. Configure proper CORS settings
5. Use strong JWT secrets
6. Set up proper file storage (S3/CDN)
7. Enable SSL/HTTPS
8. Set up monitoring and logging

---

**Platform Ready!** 🎉

You can now create professional AI-powered audio advertisements with:
- AI script generation
- Multiple voice options
- Background music generation
- Professional audio mixing with ducking
- Multiple export formats (MP3, WAV, AAC)
