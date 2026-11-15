import crypto from 'node:crypto';
import type {ServiceState} from './service-center.js';
type Actor={id:string;name:string;email?:string;status?:string};
export type DeliveryJob={id:string;userId:string;notificationId?:string;channel:'telegram'|'email';title:string;message:string;status:'PENDING'|'SENDING'|'DELIVERED'|'FAILED';attempts:number;createdAt:string;updatedAt:string;nextAttempt:number;error?:string};
export type TelegramLink={chatId:string;verifiedAt:string};
export type TelegramClaim={userId:string;expires:number};
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
export function createTelegramClaim(state:ServiceState,userId:string){
  state.telegramClaims||={};const now=Date.now();
  for(const [key,claim] of Object.entries(state.telegramClaims))if(claim.expires<now||claim.userId===userId)delete state.telegramClaims[key];
  const token=crypto.randomBytes(24).toString('hex');state.telegramClaims[digest(token)]={userId,expires:now+600000};return token;
}
export function claimTelegram(state:ServiceState,token:string,chatId:string,users:Actor[]){
  if(!/^[a-f0-9]{48}$/.test(token)||!/^\d{1,18}$/.test(chatId))return false;
  const key=digest(token),claim=state.telegramClaims?.[key];
  if(!claim||claim.expires<Date.now()||!users.some(u=>u.id===claim.userId&&u.status==='active'))return false;
  state.telegramLinks||={};
  // A private chat is linked to a single panel account; never grants bot admin rights.
  for(const [id,link] of Object.entries(state.telegramLinks))if(link.chatId===chatId)delete state.telegramLinks[id];
  state.telegramLinks[claim.userId]={chatId,verifiedAt:new Date().toISOString()};delete state.telegramClaims![key];return true;
}
export function queueDelivery(state:ServiceState,userId:string,channel:'telegram'|'email',title:string,message:string,notificationId?:string){
  state.deliveryJobs||=[];
  const existing=notificationId?state.deliveryJobs.find(j=>j.notificationId===notificationId&&j.channel===channel&&j.userId===userId):undefined;
  if(existing)return existing.id;
  if(state.deliveryJobs.length>=10000){state.deliveryJobs=state.deliveryJobs.filter(j=>!['DELIVERED','FAILED'].includes(j.status)).slice(-9000)}
  const now=new Date().toISOString(),id='delivery_'+crypto.randomUUID();state.deliveryJobs.push({id,userId,notificationId,channel,title:title.slice(0,160),message:message.slice(0,3500),status:'PENDING',attempts:0,createdAt:now,updatedAt:now,nextAttempt:Date.now()});return id;
}
export async function deliverTelegram(token:string,chatId:string,title:string,message:string){
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:title+'\n\n'+message}),redirect:'error',signal:AbortSignal.timeout(8000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||data?.ok!==true)throw Error('Telegram a refusé l’envoi.');
}
export function enqueueAlerts(state:ServiceState,status:(id:string)=>{telegram:boolean;email:boolean}){
  for(const n of state.notifications){
    const p=state.preferences[n.userId],channels=status(n.userId);if(!p)continue;
    if(p.telegram&&channels.telegram)queueDelivery(state,n.userId,'telegram',n.title,n.message,n.id);
    if(p.email&&channels.email)queueDelivery(state,n.userId,'email',n.title,n.message,n.id);
  }
}
