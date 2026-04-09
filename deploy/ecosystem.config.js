// deploy/ecosystem.config.js
// ReferralBuddy — PM2 process manager configuration
// Usage:  pm2 start deploy/ecosystem.config.js
//         pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name:        'referralbuddy',
      script:      './src/index.js',
      cwd:         '../',            // relative to this file — adjust if needed
      instances:   1,               // Discord bots must run as a single instance
      autorestart: true,
      watch:       false,
      max_memory_restart: '256M',

      // Load .env automatically
      env_file: '.env',

      env: {
        NODE_ENV: 'production',
      },

      // Log rotation
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file:  './logs/out.log',
      error_file:'./logs/error.log',
      merge_logs: true,
    },
  ],
};
