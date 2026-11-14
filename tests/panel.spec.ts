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

test('billing: super admin publishes an offer, reseller orders and declares a Mobile Money payment',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
  await login(page);
  await page.locator('.side-nav').getByRole('button',{name:'Facturation'}).click();
  await expect(page.getByRole('heading',{level:1,name:'Facturation'})).toBeVisible();
  await page.getByRole('button',{name:'Nouvelle offre'}).click();
  await page.getByLabel('Nom de l’offre').fill('Pack Test 50 Go');
  await page.getByLabel('Prix (XAF)').fill('5000');
  await page.getByLabel('Crédits (Go)').fill('50');
  await page.getByRole('button',{name:'Enregistrer l’offre'}).click();
  await expect(page.getByText('Pack Test 50 Go',{exact:true})).toBeVisible();

  const resellerEmail='reseller-'+Date.now()+'@example.test',resellerPassword='Reseller-password-'+Date.now();
  const created=await page.evaluate(async([email,password])=>{
    const r=await fetch('/api/v1/admin/resellers',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Boutique Test',email,password,initialCredits:0})});
    return r.status;
  },[resellerEmail,resellerPassword]);
  expect(created).toBeLessThan(300);

  const context=await browser.newContext();const reseller=await context.newPage();
  reseller.on('pageerror',err=>errors.push(err.message));
  await reseller.goto('/');
  await reseller.getByLabel('Adresse email',{exact:true}).fill(resellerEmail);
  await reseller.getByLabel('Mot de passe',{exact:true}).fill(resellerPassword);
  await reseller.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(reseller.getByRole('heading',{level:1,name:'Vue d’ensemble'})).toBeVisible();
  await expect(reseller.getByRole('button',{name:'Serveurs'})).toHaveCount(0);
  await expect(reseller.getByRole('button',{name:'Journal d’audit'})).toHaveCount(0);
  await reseller.locator('.side-nav').getByRole('button',{name:'Facturation'}).click();
  await expect(reseller.getByText('Coordonnées de paiement')).toBeVisible();
  await reseller.locator('.plan-card',{hasText:'Pack Test 50 Go'}).getByRole('button',{name:'Commander'}).click();
  await expect(reseller.locator('.modal').getByText('Déclarer le paiement',{exact:true})).toBeVisible();
  await reseller.getByLabel('Référence de la transaction').fill('MP260101.1234.TEST01');
  await reseller.getByRole('button',{name:'Envoyer la déclaration'}).click();
  await expect(reseller.locator('td').getByText('Paiement déclaré',{exact:true})).toBeVisible();
  await context.close();

  await page.reload();
  await page.locator('.side-nav').getByRole('button',{name:'Facturation'}).click();
  await expect(page.locator('tr',{hasText:'Boutique Test'}).getByRole('button',{name:'Vérifier'})).toBeVisible();
  await page.locator('.side-nav').getByRole('button',{name:'Journal d’audit'}).click();
  await expect(page.getByRole('heading',{level:1,name:'Journal d’audit'})).toBeVisible();
  await expect(page.getByText('PAYMENT DECLARED').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('command palette navigates with the keyboard and the sidebar collapses',async({page})=>{
  await login(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog',{name:'Palette de commandes'})).toBeVisible();
  await page.getByLabel('Rechercher une commande').fill('factur');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{level:1,name:'Facturation'})).toBeVisible();
  await page.getByLabel('Replier la barre latérale').click();
  await expect(page.locator('.panel-shell.collapsed')).toBeVisible();
  await page.getByLabel('Déplier la barre latérale').click();
});
