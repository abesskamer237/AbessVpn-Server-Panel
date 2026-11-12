import {test,expect,type Page} from '@playwright/test';

async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('Adresse email',{exact:true}).fill(process.env.PANEL_TEST_EMAIL!);
  await page.getByLabel('Mot de passe',{exact:true}).fill(process.env.PANEL_TEST_PASSWORD!);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByRole('heading',{level:1,name:'Comptes SSH-WSS'})).toBeVisible();
}

test('the SSH-WSS panel authenticates with HttpOnly cookies and logs out',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
  await login(page);
  await expect(page.getByText('SSH-WSS uniquement')).toBeVisible();
  const cookies=await page.context().cookies();
  expect(cookies.find(c=>c.name==='abess_session')?.httpOnly).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('abess_admin_token'))).toBeNull();
  await page.getByRole('button',{name:'Déconnexion'}).click();
  await expect(page.getByRole('heading',{name:'Connexion au panneau'})).toBeVisible();
  expect(errors).toEqual([]);
  expect((await request.get('/api/v1/auth/me')).status()).toBe(401);
});

test('only managed SSH WebSocket accounts are visible; no legacy TCP/VLESS/VMess/Trojan selectors',async({page})=>{
  await login(page);
  await expect(page.getByRole('heading',{level:1,name:'Comptes SSH-WSS'})).toBeVisible();
  await expect(page.getByText('Moteur SSH sur WebSocket sécurisé (WSS)')).toBeVisible();
  await expect(page.getByRole('button',{name:'Créer le compte SSH-WSS'})).toBeVisible();
  await expect(page.getByLabel('Connexions SSH-WS simultanées')).toHaveCount(0);
  await expect(page.getByLabel('Serveur administré SSH-WSS')).toBeVisible();
  await expect(page.getByText('VLESS',{exact:true})).toHaveCount(0);
  await expect(page.getByText('VMess',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Trojan',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Mode SSH')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Importer le compte'})).toHaveCount(0);
  await expect(page.getByText(/SSH-WSS : agent/)).toHaveCount(0);
});

test('mobile dashboard and reduced menu fit viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page);
  const fit=()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);
  expect(await fit()).toBe(true);
  await expect(page.getByRole('navigation').getByRole('button',{name:'SSH-WSS'})).toHaveAttribute('aria-current','page');
  await page.getByRole('navigation').getByRole('button',{name:'Revendeurs & crédits'}).click();
  await expect(page.getByText('Créer un revendeur SSH-WSS')).toBeVisible();
  expect(await fit()).toBe(true);
  await page.getByRole('button',{name:'Basculer le thème'}).click();
  expect(await fit()).toBe(true);
});

test('reseller credits and account security remain available',async({page})=>{
  await login(page);
  const nav=page.getByRole('navigation');
  await nav.getByRole('button',{name:'Revendeurs & crédits'}).click();
  await expect(page.getByLabel('Nom du revendeur')).toBeVisible();
  await nav.getByRole('button',{name:'Sécurité'}).click();
  await expect(page.getByRole('heading',{name:'Sécurité de votre compte'})).toBeVisible();
  await expect(page.getByText('Cette session',{exact:true})).toBeVisible();
});
