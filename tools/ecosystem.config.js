/**
 * PM2 Process Manager Configuration
 * 
 * This file tells PM2 (a process manager) how to run the OSC bridge tool.
 * PM2 keeps the bridge running in the background and restarts it if it crashes.
 * 
 * Think of this like instructions for a babysitter:
 * - What program to run (the OSC bridge)
 * - Where to store log files
 * - How many times to retry if it crashes
 * - What settings to use (ports, addresses, etc.)
 */

module.exports = {
  apps: [
    {
      // A friendly name for this process
      name: 'reactive-osc-bridge',
      
      // The script file to run (the OSC bridge server)
      script: './osc-bridge.js',
      
      // Environment variables (settings) that can be overridden
      // These control where the bridge listens and where it sends OSC messages
      env: {
        WS_HOST: process.env.WS_HOST || '127.0.0.1', // WebSocket listening address (default: localhost)
        WS_PORT: process.env.WS_PORT || '8090', // WebSocket listening port
        OSC_HOST: process.env.OSC_HOST || '127.0.0.1', // OSC destination address (default: localhost)
        OSC_PORT: process.env.OSC_PORT || '9000', // OSC destination port
        BRIDGE_HEARTBEAT_MS: process.env.BRIDGE_HEARTBEAT_MS || '5000', // How often to print status (5 seconds)
      },
      
      // Don't watch for file changes (we want it to stay running as-is)
      watch: false,
      
      // Automatically restart if the process crashes
      autorestart: true,
      
      // Maximum number of restart attempts before giving up
      max_restarts: 10,
      
      // Wait 2 seconds before restarting after a crash
      restart_delay: 2000,
      
      // Where to save normal output messages
      out_file: './logs/bridge.out.log',
      
      // Where to save error messages
      error_file: './logs/bridge.err.log',
      
      // Format for timestamps in log files
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};


