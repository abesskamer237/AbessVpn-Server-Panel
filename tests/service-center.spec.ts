import {test,expect,type Page} from '@playwright/test';
async function login(page:Page,email=process.env.PANEL_TEST_EMAIL!,password=process.env.PANEL_TEST_PASSWORD!){await page.goto('/');await page.getByLabel('Adresse email',{exact:true}).fill(email);await page.getByLabel('Mot de passe',{exact:true}).fill(password);await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page.getByRole('heading',{level:1,name:'Vue d’ensemble'})).toBeVisible()}
const nav=(page:Page,label:string)=>page.locator('.sidebar-navigation').getByRole('button',{name:label,exact:true}).click();

test('announcements: draft, preview, targeted publication and unique acknowledgement',async({page,browser})=>{
  await login(page);const stamp=Date.now(),title='Maintenance ciblée '+stamp;
  const email='notice-'+stamp+'@example.test',password='Reseller-notice-'+stamp;
  const created=await page.request.post('/api/v1/admin/resellers',{data:{name:'Annonce Shop',email,password,initialCredits:10}});expect(created.status()).toBe(201);
  await nav(page,'Annonces');await page.getByRole('button',{name:'Nouvelle annonce',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Nouvelle annonce'});
  await editor.getByLabel('Titre',{exact:true}).fill(title);await editor.getByLabel('Message',{exact:true}).fill('Maintenance annoncée à nos revendeurs.\nLes licences restent conservées.');
  await editor.getByLabel('Demander un accusé de lecture').check();await editor.getByRole('button',{name:'Aperçu',exact:true}).click();await expect(editor.getByRole('heading',{name:title})).toBeVisible();
  await editor.getByRole('button',{name:'Enregistrer l’annonce'}).click();await expect(editor).not.toBeVisible();
  const row=page.locator('article.announcement-row').filter({has:page.getByRole('heading',{name:title,exact:true})});await expect(row.getByText('Brouillon',{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Modifier',exact:true}).click();const edit=page.getByRole('dialog',{name:'Modifier l’annonce'});
  await edit.getByLabel('Statut',{exact:true}).selectOption('PUBLISHED');await edit.getByRole('button',{name:'Enregistrer l’annonce'}).click();await expect(edit).not.toBeVisible();await expect(row.getByText('Publiée',{exact:true})).toBeVisible();
  const publicFeed=await (await page.request.get('/api/v1/app/announcements?platform=web')).json();expect(publicFeed.announcements.some((a:any)=>a.title===title)).toBe(false);
  const context=await browser.newContext(),r=await context.newPage();await login(r,email,password);await nav(r,'Annonces');const notice=r.locator('article.announcement-row').filter({has:r.getByRole('heading',{name:title,exact:true})});await notice.getByRole('button',{name:'Lire',exact:true}).click();
  const reader=r.getByRole('dialog',{name:'Lecture de l’annonce'});await expect(reader.getByRole('heading',{name:title})).toBeVisible();await expect(reader.getByLabel('Fermer l’annonce')).toBeDisabled();await reader.getByRole('button',{name:'J’ai lu'}).click();await expect(reader).not.toBeVisible();
  const announcements=await (await page.request.get('/api/v1/admin/announcements')).json();expect(announcements.announcements.find((a:any)=>a.title===title).stats.acknowledged).toBe(1);await context.close();
});

test('support: ticket creation, reply, closure and persistence',async({page})=>{
  await login(page);await nav(page,'Support');await page.getByRole('button',{name:'Nouveau ticket'}).click();const modal=page.getByRole('dialog',{name:'Nouveau ticket'});const subject='Aide réseau '+Date.now();
  await modal.getByLabel('Objet',{exact:true}).fill(subject);await modal.getByLabel('Message',{exact:true}).fill('La connexion est lente sur mon réseau mobile.');await modal.getByRole('button',{name:'Créer le ticket'}).click();
  const thread=page.getByRole('dialog',{name:'Conversation du support'});await expect(thread.getByText('La connexion est lente sur mon réseau mobile.')).toBeVisible();await thread.getByLabel('Réponse',{exact:true}).fill('Nous vérifions votre demande.');await thread.getByRole('button',{name:'Envoyer la réponse'}).click();await expect(thread.getByText('Nous vérifions votre demande.')).toBeVisible();
  await thread.getByLabel('Statut',{exact:true}).selectOption('CLOSED');await expect(thread.getByLabel('Réponse',{exact:true})).toHaveCount(0);await thread.getByLabel('Fermer la conversation').click();await page.reload();await nav(page,'Support');const row=page.getByRole('row').filter({hasText:subject});await expect(row.getByText('Fermé',{exact:true})).toBeVisible();
});

test('history and notifications remain accessible on mobile; unconfigured e-mail is disabled',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);await page.getByLabel('Ouvrir le menu').click();await nav(page,'Consommation & réseau');await expect(page.getByRole('heading',{level:1,name:'Consommation & réseau'})).toBeVisible();await expect(page.getByLabel('Période de consommation')).toBeVisible();
  await page.getByLabel('Ouvrir le menu').click();await nav(page,'Notifications');await expect(page.getByRole('heading',{level:1,name:'Notifications'})).toBeVisible();await expect(page.getByLabel('E-mail · Service d’envoi à configurer')).toBeDisabled();
  await page.getByLabel('Rappel avant expiration (heures)').fill('48');await page.getByRole('button',{name:'Enregistrer les préférences'}).click();await expect(page.getByText('Préférences enregistrées.')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('fleet capacity and customer portal use real isolated application sessions',async({page,browser})=>{
  await login(page);const stamp=Date.now(),host='node-'+stamp+'.example.test';
  const node=await (await page.request.post('/api/v1/admin/nodes',{data:{name:'VPS Portail',host}})).json();expect(node.key).toBeTruthy();
  expect((await page.request.put('/api/v1/admin/nodes/'+node.id+'/ssh-ws',{data:{enabled:true,fingerprint:'SHA256:'+'a'.repeat(43),sni:host,port:443,path:'/ssh-ws'}})).ok()).toBe(true);
  expect((await page.request.post('/api/v1/nodes/'+node.id+'/ssh-ws/status',{headers:{Authorization:'Bearer '+node.key},data:{reports:[]}})).ok()).toBe(true);
  await nav(page,'Parc & migrations');const row=page.getByRole('row').filter({hasText:'VPS Portail'});await row.getByRole('button',{name:'Configurer'}).click();const policy=page.getByRole('dialog',{name:'Politique du serveur'});await policy.getByLabel('Capacité maximale de clients').fill('120');await policy.getByRole('button',{name:'Enregistrer la politique'}).click();await expect(policy).not.toBeVisible();await expect(row.getByText('0 / 120',{exact:true})).toBeVisible();
  const username='abv_portal'+stamp,password='Portal-safe-'+stamp;
  const response=await page.request.post('/api/v1/admin/ssh/managed',{data:{nodeId:'auto',label:'Client Portail',username,password,days:30,quotaGb:10,maxConnections:1}});expect(response.status()).toBe(202);const account=await response.json();
  expect((await page.request.post('/api/v1/nodes/'+node.id+'/ssh-ws/status',{headers:{Authorization:'Bearer '+node.key},data:{reports:[{id:account.id,state:'active',usedBytes:100,online:1}]}})).ok()).toBe(true);
  const context=await browser.newContext(),client=await context.newPage();await client.goto('/client');await client.getByLabel('Identifiant SSH').fill(username);await client.getByLabel('Mot de passe SSH',{exact:true}).fill(password);await client.getByRole('button',{name:'Accéder à mon espace'}).click();await expect(client.getByRole('heading',{name:'Bonjour Client Portail'})).toBeVisible();
  const cookies=await context.cookies();expect(cookies.find(c=>c.name==='abess_client')?.httpOnly).toBe(true);expect(cookies.some(c=>c.name==='abess_session')).toBe(false);
  const downloadPromise=client.waitForEvent('download');await client.getByRole('button',{name:'Télécharger ma configuration'}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toContain(username);
  await client.getByLabel('Catégorie',{exact:true}).selectOption('RENEWAL');await client.getByLabel('Objet',{exact:true}).fill('Mon renouvellement portail');await client.getByLabel('Message',{exact:true}).fill('Je souhaite renouveler ma licence.');await client.getByRole('button',{name:'Envoyer ma demande'}).click();await expect(client.getByRole('button',{name:/Mon renouvellement portail/})).toBeVisible();
  expect((await client.request.get('/api/v1/admin/ssh')).status()).toBe(401);await context.close();
});
