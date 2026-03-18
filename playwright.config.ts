import path from 'path';
import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3100';
const tempRoot = path.join(__dirname, '.tmp', 'playwright');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  globalSetup: './playwright.global-setup.ts',
  outputDir: path.join(tempRoot, 'results'),
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'bash -lc "rm -f .next/lock && npm run build && PORT=3100 HOSTNAME=127.0.0.1 ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3100"',
    url: `${baseURL}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_PATH: path.join(tempRoot, 'recallforge-playwright.db'),
      PORT: '3100',
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      AUTH_SECRET: 'recallforge-playwright-secret',
      NEXTAUTH_SECRET: 'recallforge-playwright-secret',
      NEXTAUTH_URL: baseURL,
      AUTH_URL: baseURL,
      BASE_URL: baseURL,
      AUTH_TRUST_HOST: 'true',
      TRUST_HOST: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
      RATE_LIMIT_AUTH_MAX: '200',
      RATE_LIMIT_API_MAX: '500',
      LOG_LEVEL: 'warn',
      RECALLFORGE_TEST_DB_FIXED: '1',
    },
  },
});
