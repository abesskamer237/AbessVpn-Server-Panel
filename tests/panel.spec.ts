import {test,expect,type Page} from '@playwright/test';

async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('Adresse email',{exact:true}).fill(process.env.PANEL_TEST_EMAIL!);
  await page.getByLabel('Mot de passe',{exact:true}).fill(process.env.PANEL_TEST_PASSWORD!);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByRole('heading',{level:1,name:'Vue d’ensemble'})).toBeVisible();
}

test('professional panel authenticates with HttpOnly cookie and logs out',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
  await login(page);
  await expect(page.getByText('SSH-WSS ONLY',{exact:true})).toBeVisible();
  await expect(page.getByText('Clients actifs',{exact:true})).toBeVisible();
  const cookies=await page.context().cookies();
  expect(cookies.find(c=>c.name==='abess_session')?.httpOnly).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('abess_admin_token'))).toBeNull();
  await page.getByLabel('Se déconnecter').click();
  await expect(page.getByRole('heading',{name:'Bienvenue'})).toBeVisible();
  expect(errors).toEqual([]);
  expect((await request.get('/api/v1/auth/me')).status()).toBe(401);
});

test('client center exposes only managed SSH-WSS workflows and no legacy VPN protocols',async({page})=>{
  await login(page);
  await page.getByRole('button',{name:/Clients/}).first().click();
  await expect(page.getByRole('heading',{level:1,name:'Clients'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Nouveau client'}).last()).toBeVisible();
  await expect(page.getByText('VLESS',{exact:true})).toHaveCount(0);
  await expect(page.getByText('VMess',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Trojan',{exact:true})).toHaveCount(0);
  await expect(page.getByText('WireGuard',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Nouveau client'}).last().click();
  await expect(page.getByText('Nouveau client SSH-WSS')).toBeVisible();
  await expect(page.getByText('Sessions simultanées',{exact:true})).toBeVisible();
  await expect(page.getByText('Quota (Go)',{exact:true})).toBeVisible();
});

test('mobile sidebar, dashboard and reseller center fit the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page);
  const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);
  expect(await fits()).toBe(true);
  await page.getByLabel('Ouvrir le menu').click();
  await page.getByRole('button',{name:'Revendeurs'}).click();
  await expect(page.getByRole('heading',{level:1,name:'Revendeurs'})).toBeVisible();
  expect(await fits()).toBe(true);
  await page.getByRole('button',{name:'Nouveau revendeur'}).click();
  await expect(page.getByText('Nouveau revendeur',{exact:true}).last()).toBeVisible();
  expect(await fits()).toBe(true);
});

test('transactions, security and server supervision are reachable for super admin',async({page})=>{
  await login(page);
  await page.getByRole('button',{name:'Transactions'}).click();
  await expect(page.getByRole('heading',{level:1,name:'Transactions'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Imprimer / PDF'})).toBeVisible();
  await page.getByRole('button',{name:'Serveurs'}).click();
  await expect(page.getByRole('heading',{level:1,name:'Serveurs'})).toBeVisible();
  await expect(page.getByText('VPS gérés',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sécurité'}).click();
  await expect(page.getByRole('heading',{name:'Sécurité de votre compte'})).toBeVisible();
  await expect(page.getByText('Cette session',{exact:true})).toBeVisible();
});
