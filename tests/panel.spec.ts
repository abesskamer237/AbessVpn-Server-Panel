import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  // The external Git update service is independent of the panel's data workflow.
  await page.route('**/api/v1/admin/system/update-status', route => route.fulfill({
    json: { isGitRepo: false, currentCommit: 'test', hasUpdate: false },
  }));
  await page.goto('/');
  await page.getByLabel('Adresse email', { exact: true }).fill(process.env.PANEL_TEST_EMAIL!);
  await page.getByLabel('Mot de passe', { exact: true }).fill(process.env.PANEL_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
  await expect(page.getByText('Données actualisées', { exact: true })).toBeVisible();
}

test('real login, dashboard, navigation and server logout', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page);
  await expect(page.getByText('Identifiants Configurés')).toHaveCount(0);
  const token = await page.evaluate(() => localStorage.getItem('abess_admin_token'));
  await page.getByRole('button', { name: 'Consulter les licences' }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Clients & Licences' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Heureux de vous revoir' })).toBeVisible();
  await expect.poll(async () => (await request.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('mobile layouts fit the viewport in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await page.getByRole('button', { name: 'Mode sombre', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/theme-light/);
  expect(await fits()).toBe(true);
  await login(page);
  expect(await fits()).toBe(true);
  await page.getByRole('button', { name: 'Mode clair', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/theme-light/);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: 'test-results/panel-mobile.png', fullPage: true, animations: 'disabled' });
});

test('keyboard labels, password visibility and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Mot de passe', { exact: true }).fill('a-local-test-value');
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click();
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Masquer le mot de passe' }).click();
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('type', 'password');
  const duration = await page.locator('.orbit-ring').first().evaluate(element => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(.01);
  await page.getByLabel('Adresse email', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Mot de passe', { exact: true })).toBeFocused();
});

test('statistics failure is shown instead of a successful sync', async ({ page }) => {
  await page.route('**/api/v1/admin/stats', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await loginWithoutSync(page);
  await expect(page.getByText('Connexion à vérifier', { exact: true })).toBeVisible();
  await expect(page.getByText('Les statistiques ne sont pas disponibles. Réessayez.', { exact: true })).toBeVisible();
  await expect(page.getByText('Données actualisées', { exact: true })).toHaveCount(0);
});

async function loginWithoutSync(page: Page) {
  await page.goto('/');
  await page.getByLabel('Adresse email', { exact: true }).fill(process.env.PANEL_TEST_EMAIL!);
  await page.getByLabel('Mot de passe', { exact: true }).fill(process.env.PANEL_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}
