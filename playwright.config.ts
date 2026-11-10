import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 3210;
const baseURL = `http://127.0.0.1:${port}`;
process.env.PANEL_TEST_EMAIL ||= 'panel-test@example.test';
process.env.PANEL_TEST_PASSWORD ||= randomBytes(24).toString('hex');
process.env.PANEL_TEST_DATA_DIR ||= mkdtempSync(path.join(tmpdir(), 'abess-panel-test-'));

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalTeardown: './tests/cleanup.ts',
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx server.ts',
    url: `${baseURL}/api/v1/ping`,
    reuseExistingServer: false,
    env: {
      ALLOW_JSON_STORAGE:'true', NODE_ENV: 'production', COOKIE_SECURE:'false', PORT: String(port), VPN_DOMAIN: 'vpn.example.test',
      DATA_DIR: process.env.PANEL_TEST_DATA_DIR,
      ADMIN_EMAIL: process.env.PANEL_TEST_EMAIL,
      ADMIN_INITIAL_PASSWORD: process.env.PANEL_TEST_PASSWORD,
      MASTER_SECRET: randomBytes(32).toString('hex'),
      CORS_ALLOWED_ORIGINS: baseURL,
      TELEGRAM_BOT_TOKEN: '', TELEGRAM_ADMIN_IDS: '',
    },
  },
});
