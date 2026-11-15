// Public endpoint DNS checks. Prints counts/status, never addresses or secrets.
import fs from 'node:fs';
import dns from 'node:dns/promises';
const names=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
names.push(process.argv[4]);
for(const name of [...new Set(names)]){
  if(typeof name!=='string'||!/^[A-Za-z0-9.-]+$/.test(name))throw Error('Invalid public DNS name');
  const results=await Promise.allSettled([
    (async()=>{try{const r=await dns.lookup(name,{all:true});return {source:'system',answerCount:r.length}}catch(e){return {source:'system',error:e.code}}})(),
    ...['https://dns.google/resolve','https://cloudflare-dns.com/dns-query'].map(base=>(async()=>{try{const r=await fetch(base+'?name='+encodeURIComponent(name)+'&type=A',{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(8000)});if(!r.ok)return {source:new URL(base).hostname,httpStatus:r.status};const j=await r.json();return {source:new URL(base).hostname,dnsStatus:j.Status,answerCount:(j.Answer||[]).filter(a=>a.type===1||a.type===5).length}}catch(e){return {source:new URL(base).hostname,error:e.cause?.code||e.name}}})())
  ]);
  console.log('VPN_DNS_CHECK='+JSON.stringify({hostname:name,checks:results.map(r=>r.status==='fulfilled'?r.value:{error:'lookup-failed'})}));
}
