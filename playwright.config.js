const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        baseURL: 'http://127.0.0.1:4174',
      },
    },
  ],
  webServer: {
    command: 'python3 -m http.server 4174 --bind 127.0.0.1',
    port: 4174,
    reuseExistingServer: true,
  },
});
