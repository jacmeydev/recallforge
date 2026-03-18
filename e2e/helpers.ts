import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  apiKey: string;
}

async function waitForDevSettled(page: Page) {
  const compilingIndicator = page.getByText('Compiling').first();
  const isVisible = await compilingIndicator.isVisible().catch(() => false);
  if (isVisible) {
    await expect(compilingIndicator).toBeHidden({ timeout: 60_000 });
  }
}

export async function gotoStable(page: Page, url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await waitForDevSettled(page);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(750);
    }
  }
  throw lastError;
}

function parseSetCookieHeaders(requestBaseUrl: string, response: Awaited<ReturnType<APIRequestContext['get']>>) {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => {
      const [nameValue] = header.value.split(';');
      const separatorIndex = nameValue.indexOf('=');
      return {
        url: requestBaseUrl,
        name: nameValue.slice(0, separatorIndex),
        value: nameValue.slice(separatorIndex + 1),
      };
    });
}

export async function registerTestUser(request: APIRequestContext, prefix: string): Promise<TestUser> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${prefix}-${token}@recallforge.test`;
  const password = `Pass-${token}-1234`;
  const name = `E2E ${prefix}`;

  let response: Awaited<ReturnType<APIRequestContext['post']>> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await request.post('/api/auth/register', {
      data: { email, password, name },
    });
    if (response.ok()) break;
    if (response.status() < 500 && response.status() !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  expect(response?.ok()).toBeTruthy();

  const body = await response!.json() as { apiKey?: string };
  expect(body.apiKey).toBeTruthy();

  return {
    email,
    password,
    name,
    apiKey: body.apiKey as string,
  };
}

export async function loginViaUi(page: Page, user: TestUser) {
  await gotoStable(page, '/login');
  const emailInput = page.locator('#email');
  const passwordInput = page.locator('#password');

  await emailInput.click();
  await emailInput.fill(user.email);
  await expect(emailInput).toHaveValue(user.email);

  await passwordInput.click();
  await passwordInput.fill(user.password);
  await expect(passwordInput).toHaveValue(user.password);

  await waitForDevSettled(page);
  const submit = page.getByRole('button', { name: 'Log In' });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await submit.click();
    await waitForDevSettled(page);
    try {
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.waitForTimeout(1_000);
    }
  }

  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Iniciar sesión')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
}

export async function loginViaSession(page: Page, request: APIRequestContext, user: TestUser) {
  const baseUrl = 'http://127.0.0.1:3100';
  const csrfResponse = await request.get('/api/auth/csrf');
  expect(csrfResponse.ok()).toBeTruthy();
  const csrfBody = await csrfResponse.json() as { csrfToken: string };
  const csrfCookies = parseSetCookieHeaders(baseUrl, csrfResponse);

  const response = await request.post('/api/auth/callback/credentials', {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    },
    maxRedirects: 0,
    form: Object.fromEntries(new URLSearchParams({
      email: user.email,
      password: user.password,
      csrfToken: csrfBody.csrfToken,
      callbackUrl: 'http://127.0.0.1:3100/dashboard',
      json: 'true',
    })),
  });

  expect([200, 302]).toContain(response.status());
  const sessionCookies = parseSetCookieHeaders(baseUrl, response);
  await page.context().addCookies([...csrfCookies, ...sessionCookies]);
  await gotoStable(page, '/dashboard');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Iniciar sesión')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
}

export async function createOpenClawDraft(request: APIRequestContext, user: TestUser, front: string, back: string) {
  const response = await request.post('/api/openclaw/drafts', {
    headers: {
      Authorization: `Bearer ${user.apiKey}`,
    },
    data: {
      agentId: 'openclaw',
      context: {
        subject: 'Pendiente',
        defaultDeck: 'Inbox::Pendiente IA',
        reason: 'Playwright OpenClaw smoke test',
        ingestionId: `pw-openclaw-${Date.now()}`,
      },
      drafts: [
        {
          noteType: 'basic',
          deck: 'Inbox::Pendiente IA',
          fields: {
            Front: front,
            Back: back,
          },
          aiGenerated: true,
          aiReviewStatus: 'pending-review',
          tags: ['playwright', 'openclaw'],
        },
      ],
    },
  });

  expect(response.ok()).toBeTruthy();
}
