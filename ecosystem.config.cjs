/**
 * ecosystem.config.cjs — PM2 ecosystem configuration
 *
 * Usage on VPS:
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload ecosystem.config.cjs   # zero-downtime restart
 *   pm2 save                          # persist across reboots
 *   pm2 startup                       # generate systemd unit
 */

module.exports = {
  apps: [
    {
      name:        'ip-du',
      script:      'src/server.js',
      cwd:         '/www/ip-du',
      instances:   1,             // Single instance; increase for multi-core (needs sticky sessions)
      exec_mode:   'fork',        // Use 'cluster' if instances > 1
      interpreter: 'node',

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Logging
      out_file:    '/www/ip-du/logs/out.log',
      error_file:  '/www/ip-du/logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:  true,

      // Auto-restart
      watch:          false,   // Set true only in dev; avoid in production
      max_memory_restart: '384M',
      restart_delay:  3000,
      max_restarts:   10,

      // Graceful shutdown
      kill_timeout:   5000,
      wait_ready:     false,
      listen_timeout: 8000,
    },
  ],
};
