/**
 * PM2 Ecosystem Configuration for VoiceAd Platform
 *
 * This configuration manages all backend processes with automatic restart,
 * monitoring, and log management.
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    // Main Backend Server
    {
      name: 'backend-server',
      script: './backend/dist/server.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      error_file: './logs/backend-server-error.log',
      out_file: './logs/backend-server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },

    // Script Generation Worker
    {
      name: 'worker-script-generation',
      script: './backend/dist/jobs/scriptGeneration.worker.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-script-error.log',
      out_file: './logs/worker-script-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },

    // TTS Generation Worker
    {
      name: 'worker-tts-generation',
      script: './backend/dist/jobs/ttsGeneration.worker.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-tts-error.log',
      out_file: './logs/worker-tts-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },

    // Music Generation Worker
    {
      name: 'worker-music-generation',
      script: './backend/dist/jobs/musicGeneration.worker.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-music-error.log',
      out_file: './logs/worker-music-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },

    // Audio Mixing Worker
    {
      name: 'worker-audio-mixing',
      script: './backend/dist/jobs/audioMixing.worker.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-mixing-error.log',
      out_file: './logs/worker-mixing-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },

    // Frontend Server
    {
      name: 'frontend-server',
      script: './frontend-server.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        FRONTEND_PORT: 3000,
      },
      error_file: './logs/frontend-server-error.log',
      out_file: './logs/frontend-server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],

  /**
   * Deployment Configuration (Optional)
   * Uncomment and configure if using PM2 deploy
   */
  // deploy: {
  //   production: {
  //     user: 'ubuntu',
  //     host: 'YOUR_EC2_IP',
  //     ref: 'origin/main',
  //     repo: 'https://github.com/YOUR_REPO/voice-ad.git',
  //     path: '/home/ubuntu/voice-ad',
  //     'pre-deploy-local': '',
  //     'post-deploy': 'cd backend && npm install && npm run build && pm2 reload ecosystem.config.js --env production',
  //     'pre-setup': '',
  //   },
  // },
};
