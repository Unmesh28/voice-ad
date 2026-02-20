/**
 * Simple Node.js server to serve the React frontend
 * and proxy API requests to the backend
 */

const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.FRONTEND_PORT || 3000;
const BACKEND_URL = 'http://localhost:5000';

// API Proxy - Forward all /api requests to backend
app.use('/api', createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[PROXY] ${req.method} /api${req.url} -> ${BACKEND_URL}/api${req.url}`);
  },
  onError: (err, req, res) => {
    console.error('[PROXY ERROR]', err.message);
    res.status(502).json({ error: 'Backend service unavailable' });
  }
}));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'backend/uploads'), {
  setHeaders: (res, filePath) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Accept-Ranges', 'bytes');

    if (filePath.endsWith('.mp3')) {
      res.set('Content-Type', 'audio/mpeg');
    } else if (filePath.endsWith('.wav')) {
      res.set('Content-Type', 'audio/wav');
    }
  }
}));

// Serve static files from React build
app.use(express.static(path.join(__dirname, 'frontend/dist'), {
  setHeaders: (res, filePath) => {
    // Cache static assets
    if (filePath.includes('/assets/')) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.set('Cache-Control', 'no-cache');
    }
  }
}));

// Handle React Router - return index.html for all other routes
app.get(/.+/, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🎵  VoiceAd Platform - Frontend Server                  ║
║                                                            ║
║   Frontend:  http://localhost:${PORT}                     ║
║   Backend:   ${BACKEND_URL}                          ║
║                                                            ║
║   Access your app at: http://YOUR_SERVER_IP:${PORT}       ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully');
  process.exit(0);
});
