// Creates/revokes a short-lived verification session. JSON is captured only
// by the root host verifier, never printed into the deployment log.
import crypto from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DocumentStore} from '../modules/store.ts';
import {SecurityService} from '../modules/security.ts';
const dir=process.env.DATA_DIR||'/app/data',file=path.join(dir,'security.json');
if(!process.env.DATABASE_URL||!process.env.MASTER_SECRET)throw Error('Production credentials required');
const store=new DocumentStore(dir,process.env.DATABASE_URL);
const security=new SecurityService(()=>store.exists(file)?store.read(file):{mfa:{},sessions:{}},v=>store.write(file,v),()=>process.env.MASTER_SECRET);
try{
  if(process.argv[2]==='create'){
    const result=await store.transaction(()=>{
      const admin=store.read(path.join(dir,'users.json')).find(u=>u.role==='SUPER_ADMIN'&&u.status==='active');assert(admin);
      if(process.env.REQUIRE_ADMIN_MFA==='true')assert(security.enabled(admin.id));
      const token='sess_'+crypto.randomBytes(32).toString('hex');
      security.sessions.set(token,{userId:admin.id,role:admin.role,email:admin.email,createdAt:Date.now()-24*3600000+5*60000,agent:'ABESS strict quota verification'});
      return {token};
    });
    process.stdout.write(JSON.stringify(result));
  }else if(process.argv[2]==='revoke'){
    let input='';for await(const chunk of process.stdin)input+=chunk;
    const {token}=JSON.parse(input);await store.transaction(()=>security.sessions.delete(token));
  }else throw Error('Unknown verification command');
}finally{await store.pool.end();}
