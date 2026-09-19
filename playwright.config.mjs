import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  use: {
    baseURL: 'http://127.0.0.1:43187',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--enable-blink-features=WebMCP'] },
  },
  webServer: {
    command: 'npm run example -- --port 43187 --strictPort',
    url: 'http://127.0.0.1:43187',
    reuseExistingServer: false,
  },
});
