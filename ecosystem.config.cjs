module.exports = {
  apps: [
    {
      name: 'textilebilling',
      script: 'server/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 5000,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5023,
      },
    },
  ],
};
