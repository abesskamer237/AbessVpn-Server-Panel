#!/usr/bin/env python3
"""Read-only session identity diagnostics; never prints accounts or endpoints."""
import collections, grp, importlib.util, json, pwd, re, subprocess, sys
from pathlib import Path

sys.path.insert(0,'/usr/local/lib/abess')
spec=importlib.util.spec_from_file_location('guard','/usr/local/lib/abess/ssh-session-guard.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
policy=json.loads(guard.POLICY.read_text())
names={a['username'] for a in policy['accounts']}
counts=collections.Counter();identities=[]
output=subprocess.check_output(['ss','-tinpeH','state','established','( sport = :22 or sport = :2222 )'],text=True,timeout=8)
pids={int(p) for p in re.findall(r'pid=(\d+)',output)}
for pid in pids:
    proc=Path('/proc')/str(pid)
    try:
        cmd=(proc/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace')
        match=re.search(r'sshd(?:-session)?: (abv_[a-z0-9_-]+)(?:@| \[)',cmd)
        if not match or match.group(1) not in names:continue
        counts['managedSocketProcesses']+=1
        status=(proc/'status').read_text().splitlines()
        uids=next(l.split()[1:] for l in status if l.startswith('Uid:'))
        gids=next(l.split()[1:] for l in status if l.startswith('Gid:'))
        eligible=bool(guard.read_process(pid))
        counts['eligibleSocketProcesses' if eligible else 'rejectedSocketProcesses']+=1
        suffix=cmd[match.end(1):].strip()
        parent=int(next(l.split()[1] for l in status if l.startswith('PPid:')))
        parent_cmd=(Path('/proc')/str(parent)/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace')
        identity={'uids':uids,'gids':gids,'privilegedMonitor':'[priv]' in cmd,'eligible':eligible,
                  'suffixKind':next((label for label in ['@notty','[priv]','[net]','[preauth]'] if suffix.startswith(label)),'other'),
                  'rootMonitorParent':parent_cmd.strip()=='sshd: '+match.group(1)+' [priv]',
                  'executable':Path((proc/'exe').readlink()).name,
                  'accountUid':pwd.getpwnam(match.group(1)).pw_uid,'accountGid':pwd.getpwnam(match.group(1)).pw_gid}
        if identity not in identities:identities.append(identity)
    except (OSError,KeyError,ValueError,StopIteration):counts['unreadable']+=1
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit():continue
    try:
        item=guard.read_process(int(proc.name))
        if item and item['username'] in names:counts['eligibleAllProcesses']+=1
    except (OSError,KeyError,ValueError,StopIteration):pass
print('SESSION_IDENTITY_DIAGNOSTICS='+json.dumps({'counts':counts,'identities':identities,'managedGroup':grp.getgrnam('abessvpn').gr_gid,'snapshotCount':len(guard.sessions_snapshot())}))
print('SESSION_CONTROLLER_STATUS='+guard.STATUS.read_text())
