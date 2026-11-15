#!/usr/bin/env python3
"""PAM account hook. Only managed Linux VPN users require relay admission.
Unmanaged users, including root/administrators, retain their original PAM flow.
No password or credential is read, written or transmitted by this hook.
"""
import grp,json,os,pwd,re,socket,subprocess,sys
from pathlib import Path

def admit():
    username=os.environ.get('PAM_USER','')
    if not re.fullmatch(r'abv_[a-z0-9][a-z0-9_-]{2,27}',username):return True
    try:
        user=pwd.getpwnam(username);gid=grp.getgrnam('abessvpn').gr_gid
    except KeyError:return False
    if user.pw_uid<1000 or user.pw_gid!=gid:return True
    if os.environ.get('PAM_TYPE')!='account':return False
    # pam_exec may have an intermediate PAM worker. Restrict discovery to
    # this process's own SSH ancestors and their accepted SSH socket.
    ancestors=set();pid=os.getppid()
    for _ in range(8):
        if pid<=1:break
        p=Path('/proc')/str(pid)
        comm=(p/'comm').read_text().strip()
        if comm in {'sshd','sshd-session','sshd-auth'}:ancestors.add(pid)
        pid=int(next(l.split()[1] for l in (p/'status').read_text().splitlines() if l.startswith('PPid:')))
    if not ancestors:return False
    out=subprocess.check_output(['ss','-tnpeH','state','established'],text=True,timeout=2)
    requests=[]
    for line in out.splitlines():
        if not ancestors.intersection(map(int,re.findall(r'pid=(\d+)',line))):continue
        columns=line.split();offset=0 if columns[0].isdigit() else 1
        if len(columns)<offset+4:continue
        local,peer=columns[offset+2:offset+4]
        la,lp=local.rsplit(':',1);pa,pp=peer.rsplit(':',1)
        # Only the private loopback SSH connection opened by the relay can
        # be bound. A direct SSH login with shared credentials fails closed.
        if la!='127.0.0.1' or pa!='127.0.0.1':continue
        requests.append({'version':1,'username':username,'serverAddress':la,'serverPort':int(lp),'peerAddress':pa,'peerPort':int(pp)})
    if len(requests)!=1:return False
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(3);client.connect(os.environ.get('ABESS_ADMISSION_SOCKET','/run/abess-raw-meter/control.sock'))
        client.sendall(json.dumps(requests[0]).encode()+b'\n');data=b''
        while b'\n' not in data and len(data)<4096:
            chunk=client.recv(4096)
            if not chunk:break
            data+=chunk
        return json.loads(data).get('ok') is True

if __name__=='__main__':
    try:ok=admit()
    except Exception:ok=False
    sys.exit(0 if ok else 1)
