#!/usr/bin/env python3
"""Enforce new managed SSH sessions only; preserve pre-activation connections."""
import grp,json,os,re,signal,subprocess,time
from pathlib import Path
from ssh_session_identity import read_authenticated_process
POLICY=Path(os.environ.get('ABESS_POLICY_FILE','/var/lib/abess-ssh-ws/policy/gateway-policy.json'))
STATUS=Path(os.environ.get('ABESS_GUARD_STATUS','/var/lib/abess-session-guard/status.json'))
USER=re.compile(r'^abv_[a-z0-9][a-z0-9_-]{2,27}$')
ACCOUNT=re.compile(r'^ssh_[0-9a-f-]{36}$')

def read_process(pid):
    return read_authenticated_process(pid,grp.getgrnam('abessvpn').gr_gid)

def sessions_snapshot(ports=(22,2222)):
    port_filter='( '+' or '.join('sport = :'+str(int(p)) for p in ports)+' )'
    out=subprocess.check_output(['ss','-tinpeH','state','established',port_filter],text=True,timeout=5)
    sessions={}
    for line in out.splitlines():
        inode=re.search(r'\bino:(\d+)',line)
        if not inode:continue
        columns=line.split();offset=0 if columns[0].isdigit() else 1
        if len(columns)<offset+4:continue
        peer=columns[offset+3]
        for pid in re.findall(r'pid=(\d+)',line):
            try:process=read_process(int(pid))
            except (OSError,KeyError,StopIteration,ValueError):continue
            if process:
                key=inode.group(1)+':'+str(process['startTicks'])+':'+process['username']
                sessions[key]={**process,'key':key,'peer':peer};break
    return list(sessions.values())

def planned_actions(policy,sessions,now=None):
    from datetime import datetime
    now=time.time() if now is None else now
    if policy.get('format')!='abess-ssh-ws-policy-v1' or not isinstance(policy.get('accounts'),list):raise ValueError('Invalid policy')
    stamp=datetime.fromisoformat(policy['generatedAt'].replace('Z','+00:00')).timestamp()
    if now-stamp>60 or stamp-now>5:raise ValueError('Stale policy')
    actions=[];over=0;active_modes=set()
    for a in policy['accounts']:
        if not ACCOUNT.fullmatch(str(a.get('id',''))) or not USER.fullmatch(str(a.get('username',''))):raise ValueError('Invalid account')
        limit=a.get('maxConnections')
        if not isinstance(limit,int) or isinstance(limit,bool) or not 1<=limit<=1000:raise ValueError('Invalid session limit')
        mine=sorted((s for s in sessions if s['username']==a['username']),key=lambda s:(s['startedAt'],s['pid']))
        if len(mine)>limit:over+=1
        mode=a.get('enforcementMode','audit');active_modes.add(mode)
        if mode=='enforce-all':
            actions.extend({**s,'accountId':a['id']} for s in (mine[limit:] if a.get('enabled') else mine))
            continue
        if mode!='enforce-new' or not a.get('enabled'):continue
        since=datetime.fromisoformat(a['enforcementSince'].replace('Z','+00:00')).timestamp()
        if since>now+5:raise ValueError('Future activation')
        # Existing sessions consume capacity but are never closed by activation.
        grandfather=[s for s in mine if s['startedAt']<=since]
        new=[s for s in mine if s['startedAt']>since]
        keep=max(0,limit-len(grandfather))
        actions.extend({**s,'accountId':a['id']} for s in new[keep:])
    return actions,over,('enforce-all' if 'enforce-all' in active_modes else 'enforce-new' if 'enforce-new' in active_modes else 'audit')

def terminate_session(item,reader=read_process,killer=os.kill):
    # Recheck identity and process start time immediately before signalling.
    try:current=reader(item['pid'])
    except (OSError,KeyError,ValueError,StopIteration):return False
    if not current or current['uid']<1000 or any(current[k]!=item[k] for k in ['uid','username','startTicks']):return False
    try:killer(item['pid'],signal.SIGTERM);return True
    except ProcessLookupError:return False

def atomic_status(status):
    STATUS.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=STATUS.with_suffix('.tmp');tmp.write_text(json.dumps(status));os.chmod(tmp,0o600);os.replace(tmp,STATUS)

def main():
    from datetime import datetime,timezone
    if os.geteuid()!=0:raise SystemExit('root required')
    denied=set();total=0
    try:total=int(json.loads(STATUS.read_text()).get('deniedTotal',0))
    except (OSError,ValueError,TypeError):pass
    while True:
        try:
            policy=json.loads(POLICY.read_text());sessions=sessions_snapshot();actions,over,mode=planned_actions(policy,sessions)
            strict=False
            if Path('/var/lib/abess-raw-meter/enabled').exists():
                mode='enforce-all'
                # The synchronous relay owns admission/quotas for registered
                # sockets. This guard only removes legacy/unmetered leftovers.
                actions=[]
                admitted=set()
                try:
                    report=json.loads(Path('/var/lib/abess-raw-meter/admitted.json').read_text())
                    status=json.loads(Path('/var/lib/abess-raw-meter/status.json').read_text())
                    fresh=time.time()-datetime.fromisoformat(report['observedAt'].replace('Z','+00:00')).timestamp()<5
                    strict=fresh and status.get('ok') is True
                    if fresh:admitted=set(report['peers'])
                except (OSError,ValueError,KeyError):pass
                selected={a['key'] for a in actions}
                actions.extend(s for s in sessions if s.get('peer') not in admitted and s['key'] not in selected)
            for item in actions:
                if terminate_session(item) and item['key'] not in denied:denied.add(item['key']);total+=1
            if len(denied)>20000:denied={a['key'] for a in actions}
            atomic_status({'format':'abess-session-guard-v1','observedAt':datetime.now(timezone.utc).isoformat(),'mode':mode,'strictBytes':strict,'observedSessions':len(sessions),'overLimitAccounts':over,'deniedTotal':total,'healthy':True})
        except Exception as e:
            atomic_status({'format':'abess-session-guard-v1','observedAt':datetime.now(timezone.utc).isoformat(),'mode':'audit','deniedTotal':total,'healthy':False,'error':type(e).__name__})
        time.sleep(2)
if __name__=='__main__':main()
