# VoiceAd - AI-Powered Audio Production Platform

An enterprise-grade audio advertisement production platform powered by AI, similar to AudioStack.ai. Generate ad scripts, convert text to speech, add background music, and mix everything together automatically.

## 🚀 Features

- **AI Script Generation**: Generate professional ad scripts using OpenAI GPT-4
- **Text-to-Speech**: High-quality voice synthesis using ElevenLabs
- **Music Generation**: Create custom background music for ads
- **Audio Mixing**: Automatically mix voice, music, and effects using FFmpeg
- **Project Management**: Organize productions by projects
- **User Authentication**: Secure JWT-based authentication
- **Usage Tracking**: Monitor API usage and costs

## 🏗️ Tech Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Queue System**: Redis with BullMQ
- **Audio Processing**: FFmpeg via fluent-ffmpeg
- **Authentication**: JWT with bcryptjs

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Library**: Material-UI (MUI)
- **State Management**: Zustand
- **Data Fetching**: TanStack React Query
- **Routing**: React Router v6
- **Audio Visualization**: WaveSurfer.js

### External APIs
- **ElevenLabs**: Text-to-Speech synthesis
- **OpenAI**: GPT-4 for script generation
- **Mubert/Stable Audio**: Music generation

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v18 or higher)
- PostgreSQL (v14 or higher)
- Redis (v6 or higher)
- FFmpeg (with libmp3lame support)
- npm or yarn

### Installing FFmpeg

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**MacOS:**
```bash
brew install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd voice-ad
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env and add your API keys and database credentials
nano .env

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Start development server
npm run dev
```

The backend will start on `http://localhost:5000`

### 3. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
```

The frontend will start on `http://localhost:3000`

## 🔧 Configuration

### Environment Variables

#### Backend (.env)

```env
# Server
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/voicead_db

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
JWT_REFRESH_SECRET=your-super-secret-refresh-key
JWT_REFRESH_EXPIRE=30d

# ElevenLabs
ELEVENLABS_API_KEY=your-elevenlabs-api-key

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Music API (Mubert or Stable Audio)
MUBERT_API_KEY=your-mubert-api-key
```

#### Frontend (.env)

```env
VITE_API_URL=http://localhost:5000/api
VITE_APP_NAME=VoiceAd
VITE_APP_VERSION=1.0.0
```

### Database Setup

1. Create a PostgreSQL database:
```bash
createdb voicead_db
```

2. Run migrations:
```bash
cd backend
npm run prisma:migrate
```

3. (Optional) Open Prisma Studio to view/edit data:
```bash
npm run prisma:studio
```

### Redis Setup

Make sure Redis is running:
```bash
# Check Redis status
redis-cli ping
# Should return: PONG
```

## 📚 API Documentation

### Authentication Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Get Profile
```http
GET /api/users/profile
Authorization: Bearer <token>
```

### Protected Routes

All other API routes require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## 🗂️ Project Structure

```
voice-ad/
├── backend/
│   ├── src/
│   │   ├── config/          # Configuration files
│   │   │   ├── database.ts  # Prisma client
│   │   │   ├── redis.ts     # Redis & queue setup
│   │   │   └── logger.ts    # Winston logger
│   │   ├── controllers/     # Route controllers
│   │   │   ├── auth.controller.ts
│   │   │   └── user.controller.ts
│   │   ├── middleware/      # Express middleware
│   │   │   ├── auth.ts      # JWT authentication
│   │   │   ├── validate.ts  # Input validation
│   │   │   └── errorHandler.ts
│   │   ├── models/          # Database models (Prisma)
│   │   ├── routes/          # API routes
│   │   │   ├── auth.routes.ts
│   │   │   ├── user.routes.ts
│   │   │   └── index.ts
│   │   ├── services/        # Business logic
│   │   │   ├── llm/         # OpenAI integration
│   │   │   ├── tts/         # ElevenLabs integration
│   │   │   ├── music/       # Music generation
│   │   │   └── audio/       # FFmpeg processing
│   │   ├── utils/           # Utility functions
│   │   │   ├── jwt.ts       # JWT helpers
│   │   │   └── password.ts  # Password hashing
│   │   ├── jobs/            # Background job processors
│   │   └── server.ts        # Express app entry
│   ├── prisma/
│   │   └── schema.prisma    # Database schema
│   ├── uploads/             # Temporary file storage
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   │   ├── Layout.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── pages/           # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── Projects.tsx
│   │   │   ├── ScriptGenerator.tsx
│   │   │   └── Production.tsx
│   │   ├── services/        # API service layer
│   │   │   ├── api.ts
│   │   │   └── auth.service.ts
│   │   ├── store/           # State management
│   │   │   └── authStore.ts
│   │   ├── types/           # TypeScript types
│   │   │   └── index.ts
│   │   ├── hooks/           # Custom hooks
│   │   ├── utils/           # Utility functions
│   │   ├── App.tsx          # Main app component
│   │   ├── main.tsx         # Entry point
│   │   ├── theme.ts         # MUI theme
│   │   └── index.css        # Global styles
│   ├── public/
│   └── package.json
│
└── README.md
```

## 🎯 Development Roadmap

### ✅ Phase 1: Foundation (COMPLETED)
- [x] Backend setup with Express & TypeScript
- [x] Frontend setup with React & Vite
- [x] PostgreSQL database with Prisma
- [x] Redis configuration with BullMQ
- [x] JWT authentication system
- [x] Basic API endpoints

### 📝 Phase 2: Script Generation (Next)
- [ ] OpenAI integration
- [ ] Script generation service
- [ ] Script CRUD operations
- [ ] Script editor UI
- [ ] Template management

### 🎤 Phase 3: Text-to-Speech
- [ ] ElevenLabs API integration
- [ ] Voice selection interface
- [ ] TTS generation queue
- [ ] Audio preview player

### 🎵 Phase 4: Music Generation
- [ ] Music API integration (Mubert/Stable Audio)
- [ ] Music library management
- [ ] Music preview & selection

### 🎛️ Phase 5: Audio Mixing
- [ ] FFmpeg audio processing
- [ ] Volume balancing
- [ ] Audio ducking
- [ ] Export functionality

### 📊 Phase 6: Project Management
- [ ] Project dashboard
- [ ] Asset management
- [ ] Version control
- [ ] Collaboration features

### 🔐 Phase 7: User Management
- [ ] User roles & permissions
- [ ] API key management
- [ ] Usage quotas
- [ ] Billing integration

### 🔌 Phase 8: API & Integrations
- [ ] REST API documentation
- [ ] Webhook support
- [ ] Third-party integrations
- [ ] Batch processing

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## 📦 Production Build

### Backend
```bash
cd backend
npm run build
npm start
```

### Frontend
```bash
cd frontend
npm run build
# Serve the dist/ folder with a web server
```

## 🐛 Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running: `sudo service postgresql status`
- Check DATABASE_URL in .env
- Verify database exists: `psql -l`

### Redis Connection Issues
- Ensure Redis is running: `redis-cli ping`
- Check REDIS_URL in .env

### FFmpeg Issues
- Verify FFmpeg is installed: `ffmpeg -version`
- Check FFmpeg has mp3 support: `ffmpeg -codecs | grep mp3`

### API Key Issues
- Ensure all API keys are valid in .env
- Check API key quotas/limits

## 📄 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📧 Support

For support, email support@voicead.com or open an issue on GitHub.
