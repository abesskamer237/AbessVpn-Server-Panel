#!/usr/bin/env python3
"""Enforce new managed SSH sessions only; preserve pre-activation connections."""
import grp,json,os,pwd,re,signal,subprocess,time
from pathlib import Path
POLICY=Path(os.environ.get('ABESS_POLICY_FILE','/var/lib/abess-ssh-ws/policy/gateway-policy.json'))
STATUS=Path(os.environ.get('ABESS_GUARD_STATUS','/var/lib/abess-session-guard/status.json'))
USER=re.compile(r'^abv_[a-z0-9][a-z0-9_-]{2,27}$')
ACCOUNT=re.compile(r'^ssh_[0-9a-f-]{36}$')
BOOT_TIME=int(next(l.split()[1] for l in Path('/proc/stat').read_text().splitlines() if l.startswith('btime ')))
CLOCK_TICKS=os.sysconf('SC_CLK_TCK')

def read_process(pid):
    p=Path('/proc')/str(pid)
    stat=(p/'stat').read_text();fields=stat[stat.rindex(')')+2:].split()
    uid=int(next(l.split()[1] for l in (p/'status').read_text().splitlines() if l.startswith('Uid:')))
    cmd=(p/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace')
    match=re.search(r'sshd(?:-session)?: (abv_[a-z0-9_-]+)(?:@| \[)',cmd)
    if not match or not USER.fullmatch(match.group(1)) or uid<1000:return None
    user=pwd.getpwnam(match.group(1))
    if user.pw_uid!=uid or user.pw_gid!=grp.getgrnam('abessvpn').gr_gid:return None
    return {'pid':pid,'uid':uid,'username':user.pw_name,'startTicks':int(fields[19]),'startedAt':BOOT_TIME+int(fields[19])/CLOCK_TICKS}

def sessions_snapshot():
    out=subprocess.check_output(['ss','-tinpeH','state','established','( sport = :22 or sport = :2222 )'],text=True,timeout=5)
    sessions={}
    for line in out.splitlines():
        inode=re.search(r'\bino:(\d+)',line)
        if not inode:continue
        for pid in re.findall(r'pid=(\d+)',line):
            try:process=read_process(int(pid))
            except (OSError,KeyError,StopIteration,ValueError):continue
            if process:
                key=inode.group(1)+':'+str(process['startTicks'])+':'+process['username']
                sessions[key]={**process,'key':key};break
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
        if not isinstance(limit,int) or isinstance(limit,bool) or not 1<=limit<=10:raise ValueError('Invalid session limit')
        mine=sorted((s for s in sessions if s['username']==a['username']),key=lambda s:(s['startedAt'],s['pid']))
        if len(mine)>limit:over+=1
        mode=a.get('enforcementMode','audit');active_modes.add(mode)
        if mode!='enforce-new' or not a.get('enabled'):continue
        since=datetime.fromisoformat(a['enforcementSince'].replace('Z','+00:00')).timestamp()
        if since>now+5:raise ValueError('Future activation')
        # Existing sessions consume capacity but are never closed by activation.
        grandfather=[s for s in mine if s['startedAt']<=since]
        new=[s for s in mine if s['startedAt']>since]
        keep=max(0,limit-len(grandfather))
        actions.extend({**s,'accountId':a['id']} for s in new[keep:])
    return actions,over,('enforce-new' if 'enforce-new' in active_modes else 'audit')

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
            for item in actions:
                if terminate_session(item) and item['key'] not in denied:denied.add(item['key']);total+=1
            if len(denied)>20000:denied={a['key'] for a in actions}
            atomic_status({'format':'abess-session-guard-v1','observedAt':datetime.now(timezone.utc).isoformat(),'mode':mode,'observedSessions':len(sessions),'overLimitAccounts':over,'deniedTotal':total,'healthy':True})
        except Exception as e:
            atomic_status({'format':'abess-session-guard-v1','observedAt':datetime.now(timezone.utc).isoformat(),'mode':'audit','deniedTotal':total,'healthy':False,'error':type(e).__name__})
        time.sleep(2)
if __name__=='__main__':main()
