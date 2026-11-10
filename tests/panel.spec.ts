import { test, expect, type Page } from '@playwright/test';
import { totp } from '../modules/security';

async function login(page: Page) {
  // The external Git update service is independent of the panel's data workflow.
  await page.route('**/api/v1/admin/system/update-status', route => route.fulfill({
    json: { isGitRepo: false, currentCommit: 'test', hasUpdate: false },
  }));
  await page.goto('/');
  await page.getByLabel('Adresse email', { exact: true }).fill(process.env.PANEL_TEST_EMAIL!);
  await page.getByLabel('Mot de passe', { exact: true }).fill(process.env.PANEL_TEST_PASSWORD!);
  const responsePromise=page.waitForResponse('**/api/v1/auth/login');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  const loginResponse=await (await responsePromise).json();
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
  await expect(page.getByText('Données actualisées', { exact: true })).toBeVisible();
  return loginResponse.token as string;
}

test('real login, dashboard, navigation and server logout', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const token=await login(page);
  await expect(page.getByText('Identifiants Configurés')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('abess_admin_token'))).toBeNull();
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

test('security, payment and operations pages use protected APIs',async({page})=>{
  await login(page);
  const nav=page.getByRole('navigation');
  await nav.getByRole('button',{name:'Sécurité',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sécurité de votre compte'})).toBeVisible();
  await expect(page.getByText('Cette session',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('abess_admin_token'))).toBeNull();
  const cookies=await page.context().cookies();
  expect(cookies.find(cookie=>cookie.name==='abess_session')?.httpOnly).toBe(true);
  await nav.getByRole('button',{name:'Paiements',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Paiements manuels et factures'})).toBeVisible();
  await expect(page.getByText('681328753',{exact:true})).toBeVisible();
  await expect(page.getByText('695140419',{exact:true})).toBeVisible();
  await expect(page.getByText('Bénéficiaire : manga Ghislain',{exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'Exploitation',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Exploitation et infrastructure'})).toBeVisible();
  await expect(page.getByText('json-development',{exact:true})).toBeVisible();
});

test('SSH generator shows actual availability and protects credential export', async ({page}) => {
  await login(page);
  await page.getByRole('navigation').getByRole('button', {name:'Comptes SSH',exact:true}).click();
  await expect(page.getByRole('heading', {name:'Comptes et tunnels SSH'})).toBeVisible();
  await expect(page.getByText('● Passerelle indisponible', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Créer le compte',exact:true})).toBeDisabled();
  await expect(page.getByRole('button', {name:'Afficher les paramètres et identifiants',exact:true})).toBeDisabled();
  await page.getByLabel('Transport SSH').selectOption('wss-alt');
  await expect(page.getByText(/Sélectionnez un compte et un transport/)).toBeVisible();
});

test('MFA enrollment and recovery login work through the browser',async({page})=>{
  const adminToken=await login(page);
  const password='ui-test-'+crypto.randomUUID();const email=crypto.randomUUID()+'@example.test';
  const created=await page.request.post('/api/v1/admin/resellers',{headers:{Authorization:`Bearer ${adminToken}`},data:{email,password,name:'UI Security Test',initialCredits:0}});
  expect(created.status()).toBe(201);
  await page.getByRole('button',{name:'Déconnexion',exact:true}).click();
  await page.getByLabel('Adresse email',{exact:true}).fill(email);
  await page.getByLabel('Mot de passe',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Bonjour/})).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'Sécurité',exact:true}).click();
  await page.getByLabel('Mot de passe actuel',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Configurer la double authentification',exact:true}).click();
  await expect(page.getByAltText('QR code à scanner dans votre application d’authentification')).toBeVisible();
  const secret=await page.locator('.settings-card code').innerText();
  await page.getByLabel('Code de sécurité ou de récupération',{exact:true}).fill(totp(secret));
  await page.getByRole('button',{name:'Confirmer l’activation',exact:true}).click();
  await expect(page.getByText('Activée',{exact:true})).toBeVisible();
  const recovery=(await page.locator('.notice pre').innerText()).split('\n');expect(recovery.length).toBe(8);
  await page.getByRole('button',{name:'Déconnexion',exact:true}).click();
  await page.getByLabel('Adresse email',{exact:true}).fill(email);
  await page.getByLabel('Mot de passe',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.getByLabel('Code de double authentification ou de récupération',{exact:true}).fill(recovery[0]);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Bonjour/})).toBeVisible();
});
