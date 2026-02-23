# Local development setup

The backend needs **MongoDB** and **Redis** to be running. If they aren’t, the server will exit with a connection error and the frontend will see `ECONNREFUSED` when calling the API.

## 1. Start MongoDB

**macOS (Homebrew):**
```bash
# If not installed: brew tap mongodb/brew && brew install mongodb-community
brew services start mongodb-community
# Or run in foreground: mongod --config /opt/homebrew/etc/mongod.conf
```

**Docker:**
```bash
docker run -d -p 27017:27017 --name mongo mongo:latest
```

**Windows:** Install from [mongodb.com](https://www.mongodb.com/try/download/community) and start the MongoDB service.

## 2. Start Redis

**macOS (Homebrew):**
```bash
# If not installed: brew install redis
brew services start redis
# Or run in foreground: redis-server
```

**Docker:**
```bash
docker run -d -p 6379:6379 --name redis redis:alpine
```

## 3. Backend .env

The backend loads `.env` from either **backend/** or the **project root** (one level above backend). So you can have:
- `backend/.env`, or
- `voice-ad/.env` (repo root)

Copy from `backend/.env.example` and set at least:

- `DATABASE_URL=mongodb://localhost:27017/voicead_db` (or your MongoDB URL)
- `REDIS_URL=redis://localhost:6379` (or your Redis URL)
- `JWT_SECRET` and `JWT_REFRESH_SECRET` (any long random strings for dev)

Optional for full features: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.

## 4. Start the app

1. From `backend`: `npm run dev` (or `npm start`).
2. From `frontend`: `npm run dev`.

The frontend proxies `/api/*` to the backend (default port 5011). If the backend isn’t running or MongoDB/Redis are down, you’ll see **ECONNREFUSED** on API calls.
