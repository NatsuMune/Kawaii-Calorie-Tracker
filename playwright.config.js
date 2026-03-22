const { defineConfig, devices } = require('@playwright/test');
const PORT = Number(process.env.PORT || 4174);

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        baseURL: `http://127.0.0.1:${PORT}`,
      },
    },
  ],
  webServer: {
    command: `PORT=${PORT} node server.js`,
    port: PORT,
    reuseExistingServer: true,
  },
});
