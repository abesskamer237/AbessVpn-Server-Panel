import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const data = await mkdtemp(path.join(tmpdir(),'abess-mobile-'));
const env = {...process.env,DATA_DIR:data,PORT:'3187',NODE_ENV:'production',ALLOW_JSON_STORAGE:'true',ALLOW_INSECURE_TCP:'true',DATABASE_URL:'',VPN_DOMAIN:'vpn.example.test',ADMIN_EMAIL:'ci-admin@example.test',ADMIN_INITIAL_PASSWORD:'ci-only-password-please-ignore-123',MASTER_SECRET:'ci-only-master-secret-0123456789abcdef0123456789abcdef',TELEGRAM_BOT_TOKEN:''};
const server = spawn(process.execPath,['--import','tsx','server.ts'],{env,stdio:'ignore'});
try {
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null)throw Error('API exited');
    try {if((await fetch('http://127.0.0.1:3187/api/v1/ping')).ok)break;} catch {}
    await delay(100);
  }
  const test=spawn(process.execPath,['--import','tsx','scripts/mobile-contract-checks.mjs'],{env,stdio:'inherit'});
  const code=await new Promise(resolve=>test.once('close',resolve));
  if(code)throw Error('Mobile contract failed');
} finally {
  server.kill();await new Promise(resolve=>server.once('close',resolve));
  await rm(data,{recursive:true,force:true});
}
