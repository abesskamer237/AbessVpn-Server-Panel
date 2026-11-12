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
  await expect(page.getByText('● Sans suivi distant', {exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Importer le compte',exact:true})).toBeDisabled();
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

test('imports an existing SSH account and exports its exact remote endpoint', async ({page, request}) => {
  const token = await login(page);
  const headers = {Authorization:`Bearer ${token}`};
  const response = await request.post('/api/v1/admin/nodes',{headers,data:{name:'Manual SSH browser',host:'ssh-browser.example.test'}});
  expect(response.status()).toBe(201);
  const node = await response.json();
  await page.getByRole('navigation').getByRole('button',{name:'Comptes SSH',exact:true}).click();
  await page.getByLabel('Serveur SSH').selectOption(node.id);
  const config={host:'ssh-browser.example.test',username:'browser_user',password:'browser-only-fixture-password',port:8443,transport:'wss-raw',tls:true,sni:'ssh-cert.example.test',path:'/existing-ssh',fingerprint:'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'};
  await page.getByLabel('Configuration SSH JSON').fill(JSON.stringify(config));
  await page.getByRole('button',{name:'Importer le compte',exact:true}).click();
  await expect(page.locator('td strong').filter({hasText:'browser_user'})).toBeVisible();
  const list = await (await request.get('/api/v1/admin/ssh',{headers})).json();
  const account = list.accounts.find((a:any)=>a.username==='browser_user');
  expect(account).toBeTruthy();
  const heartbeat=await request.post(`/api/v1/nodes/${node.id}/heartbeat`,{headers:{Authorization:`Bearer ${node.key}`},data:{ready:true,snapshot:{generation:'browser-ssh',observedAt:new Date().toISOString(),stat:[],accounts:[{id:account.id,usedBytes:2048,online:1}]}}});
  expect(heartbeat.status()).toBe(200);
  await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await expect(page.getByLabel('Transport SSH')).toHaveValue('wss-raw');
  await page.getByRole('button',{name:'Afficher les paramètres et identifiants',exact:true}).click();
  await expect(page.locator('pre')).toContainText('browser-only-fixture-password');
  await expect(page.locator('pre')).toContainText('"port": 8443');
  await expect(page.locator('pre')).toContainText('GET /existing-ssh HTTP/1.1');
  expect((await request.get('/api/v1/admin/ssh')).status()).toBe(401);
});

test('sells a TCP payload account and lets its reseller renew it', async ({page,request}) => {
  const adminToken=await login(page),headers={Authorization:`Bearer ${adminToken}`};
  const resellerPassword='browser-commercial-fixture-password';
  const resellerResponse=await request.post('/api/v1/admin/resellers',{headers,data:{name:'SSH Commerce',email:'ssh-commerce@example.test',password:resellerPassword,initialCredits:25}});
  expect(resellerResponse.status()).toBe(201);const reseller=await resellerResponse.json();
  const nodeResponse=await request.post('/api/v1/admin/nodes',{headers,data:{name:'TCP Payload Browser',host:'tcp-browser.example.test'}});const node=await nodeResponse.json();
  await page.getByRole('navigation').getByRole('button',{name:'Comptes SSH',exact:true}).click();
  await page.getByLabel('Serveur SSH').selectOption(node.id);
  await page.getByLabel('Revendeur SSH').selectOption(reseller.id);
  await page.getByLabel('Port SSH',{exact:true}).fill('8080');
  await page.getByLabel('Utilisateur SSH',{exact:true}).fill('tcp_buyer');
  await page.getByLabel('Mot de passe SSH',{exact:true}).fill('existing-vps-ssh-fixture');
  await page.getByLabel('Empreinte SSH').fill('SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const payload='CONNECT [host_port] [protocol][crlf]Host: [host][crlf][crlf]';
  await page.getByLabel('Payload SSH').fill(payload);
  await page.getByRole('button',{name:'Importer le compte',exact:true}).click();
  await expect(page.locator('td strong').filter({hasText:'tcp_buyer'})).toBeVisible();
  const accounts=(await (await request.get('/api/v1/admin/ssh',{headers})).json()).accounts;
  const account=accounts.find((a:any)=>a.username==='tcp_buyer');
  expect(account.resellerId).toBe(reseller.id);
  await request.post(`/api/v1/nodes/${node.id}/heartbeat`,{headers:{Authorization:`Bearer ${node.key}`},data:{ready:true,snapshot:{generation:'tcp-browser',observedAt:new Date().toISOString(),stat:[],accounts:[{id:account.id,usedBytes:1234,online:1}]}}});
  await page.getByRole('button',{name:'Déconnexion',exact:true}).click();
  await page.getByLabel('Adresse email',{exact:true}).fill('ssh-commerce@example.test');
  await page.getByLabel('Mot de passe',{exact:true}).fill(resellerPassword);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.getByRole('navigation').getByRole('button',{name:'Comptes SSH',exact:true}).click();
  await expect(page.getByRole('button',{name:'Importer le compte',exact:true})).toHaveCount(0);
  await expect(page.locator('td strong').filter({hasText:'browser_user'})).toHaveCount(0);
  await page.getByRole('button',{name:'Configurer',exact:true}).click();
  await page.getByRole('button',{name:'Afficher les paramètres et identifiants',exact:true}).click();
  await expect(page.locator('pre')).toContainText(payload);
  await page.getByRole('button',{name:'Renouveler',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Confirmer le renouvellement'}).click();
  await expect(dialog).toHaveCount(0);
  const ownerSession=await request.post('/api/v1/auth/login',{data:{email:'ssh-commerce@example.test',password:resellerPassword}});
  const ownerToken=(await ownerSession.json()).token;
  const owner=(await (await request.get('/api/v1/auth/me',{headers:{Authorization:`Bearer ${ownerToken}`}})).json());
  expect(owner.credits).toBe(5);
});


test('imports and exports a supplier account without any agent',async({page,request})=>{
  const token=await login(page);
  await page.getByRole('navigation').getByRole('button',{name:'Comptes SSH',exact:true}).click();
  await page.getByLabel('Hôte SSH',{exact:true}).fill('supplier-browser.example.test');
  await page.getByLabel('Utilisateur SSH',{exact:true}).fill('supplier_browser');
  await page.getByLabel('Mot de passe SSH',{exact:true}).fill('supplier-account-fixture-password');
  await page.getByLabel('Empreinte SSH').fill('SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  await page.getByRole('button',{name:'Importer le compte',exact:true}).click();
  const row=page.getByRole('row').filter({has:page.locator('strong').filter({hasText:'supplier_browser'})});
  await expect(row.getByRole('cell',{name:'Importé',exact:true})).toBeVisible();
  await expect(row).toContainText('— / 10.00 Go');
  await expect(row).toContainText('— / 1');
  await page.getByRole('button',{name:'Afficher les paramètres et identifiants',exact:true}).click();
  await expect(page.locator('pre')).toContainText('supplier-browser.example.test');
  await expect(page.locator('pre')).toContainText('"trafficVerified": false');
  const accounts=(await (await request.get('/api/v1/admin/ssh',{headers:{Authorization:`Bearer ${token}`}})).json()).accounts;
  const account=accounts.find((a:any)=>a.username==='supplier_browser');
  expect(account.nodeId).toBeUndefined();expect(account.usedBytes).toBeNull();expect(account.online).toBeNull();
});
