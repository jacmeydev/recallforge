import { test, expect } from '@playwright/test';
import { createOpenClawDraft, gotoStable, loginViaUi, registerTestUser } from './helpers';

test('login screen and settings render critical beta-private status', async ({ page, request }) => {
  const user = await registerTestUser(request, 'settings');

  await gotoStable(page, '/login');
  await expect(page.getByRole('heading', { name: 'RecallForge' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  await loginViaUi(page, user);
  await gotoStable(page, '/settings');

  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cuenta' }).click();
  await expect(page.getByRole('heading', { name: 'Estado del sistema' })).toBeVisible();
  await expect(page.getByText(/Rotar API Key|API Key/)).toBeVisible();

  await page.getByRole('tab', { name: 'Respaldos' }).click();
  await expect(page.getByText('Checklist de resiliencia')).toBeVisible();

  await gotoStable(page, '/ai-import');
  await expect(page.getByRole('heading', { name: 'Importación IA por Lote' })).toBeVisible();
});

test('server import can seed a study session through the visible UI flow', async ({ page, request }) => {
  const user = await registerTestUser(request, 'study');
  const importResponse = await request.post('/api/agent/import', {
    headers: {
      Authorization: `Bearer ${user.apiKey}`,
    },
    data: {
      items: [
        {
          noteType: 'basic',
          deck: 'Playwright::Study',
          fields: {
            Front: '¿Cuál es la capital de Paraguay?',
            Back: 'Asunción.',
          },
          tags: ['playwright', 'study'],
        },
      ],
      options: {
        agentId: 'playwright',
        duplicateStrategy: 'skip',
      },
    },
  });
  expect(importResponse.ok()).toBeTruthy();

  const importBody = await importResponse.json() as {
    itemResults?: Array<{ deckId?: string }>;
  };
  const deckId = importBody.itemResults?.[0]?.deckId;
  expect(deckId).toBeTruthy();

  await loginViaUi(page, user);
  await expect(page.getByText('Sincronizado')).toBeVisible({ timeout: 30_000 });
  await gotoStable(page, `/study/${deckId}`);

  await expect(page.getByText('¿Cuál es la capital de Paraguay?')).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar Respuesta' }).click();
  await expect(page.getByText('Asunción.')).toBeVisible();
  await page.getByRole('button', { name: 'Fácil' }).click();

  await expect(
    page.getByText('¡Sesión Completada!').or(page.getByText('Sin tarjetas para estudiar'))
  ).toBeVisible();
});

test('openclaw receiver creates drafts that are visible and reviewable in Copilot', async ({ page, request }) => {
  const user = await registerTestUser(request, 'copilot');
  await createOpenClawDraft(
    request,
    user,
    '¿Qué hormona regula la glucemia?',
    'La insulina es una de las principales hormonas reguladoras.'
  );

  await loginViaUi(page, user);
  await gotoStable(page, '/copilot');
  await expect(page.getByRole('heading', { name: 'Study Copilot' })).toBeVisible();

  const draftsResponse = page.waitForResponse((response) => response.url().includes('/api/copilot/drafts') && response.ok());
  await page.getByRole('tab', { name: 'Borradores' }).click();
  await draftsResponse;
  await expect(page.getByRole('tab', { name: 'Borradores' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('¿Qué hormona regula la glucemia?')).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar' }).click();

  await expect(page.getByText(/imported|approved/)).toBeVisible();
});

test('optimizer page loads without breaking the beta-private shell', async ({ page, request }) => {
  const user = await registerTestUser(request, 'optimizer');
  await loginViaUi(page, user);

  await gotoStable(page, '/optimizer');
  await expect(page.getByRole('heading', { name: 'Optimizador FSRS' })).toBeVisible();
  await expect(
    page.getByText('Parámetros Actuales (W)').or(page.getByText('Cómo probar el optimizador'))
  ).toBeVisible();
});
