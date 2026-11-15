#!/usr/bin/env python3
"""Container-only integration test with real SSH authentication and forwarding."""
import importlib.util,json,os,re,socket,subprocess,tempfile,time
from datetime import datetime,timezone
from pathlib import Path
root=Path(__file__).parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,root/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
g=module('guard','ssh-session-guard.py');o=module('observer','ssh-ws-passive-traffic.py')
def run(*args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def wait(predicate):
    for _ in range(100):
        value=predicate()
        if value:return value
        time.sleep(.1)
    raise AssertionError('Real SSH session did not reach its expected state')
assert os.environ.get('ABESS_ISOLATED_SSH_TEST')=='yes','Run only in the disposable SSH test container'
run('groupadd','--system','abessvpn');run('useradd','--gid','abessvpn','--no-create-home','--shell','/usr/sbin/nologin','abv_guardlive');run('usermod','--password','x','abv_guardlive')
Path('/run/sshd').mkdir(exist_ok=True)
processes=[]
with tempfile.TemporaryDirectory(prefix='abess-ssh-live-') as directory:
    d=Path(directory);d.chmod(0o755)
    run('ssh-keygen','-q','-t','ed25519','-N','','-f',str(d/'host'))
    run('ssh-keygen','-q','-t','ed25519','-N','','-f',str(d/'client'))
    (d/'authorized_keys').write_bytes((d/'client.pub').read_bytes());(d/'authorized_keys').chmod(0o644)
    (d/'config').write_text(f'Port 22222\nListenAddress 127.0.0.1\nHostKey {d}/host\nPidFile {d}/pid\nAuthorizedKeysFile {d}/authorized_keys\nStrictModes no\nUsePAM no\nPermitRootLogin no\nPasswordAuthentication yes\nAllowUsers abv_guardlive\nAllowTcpForwarding yes\nLogLevel ERROR\n')
    daemon=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(d/'config')],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);processes.append(daemon)
    def reachable():
        try:
            with socket.create_connection(('127.0.0.1',22222),timeout=.1):return True
        except OSError:return False
    try:
        wait(reachable)
        base=['ssh','-N','-p','22222','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null','-o','LogLevel=ERROR','-o','IdentitiesOnly=yes']
        def launch(port):
            p=subprocess.Popen(base+['-i',str(d/'client'),'-o','BatchMode=yes','-L',str(port)+':127.0.0.1:22222','abv_guardlive@127.0.0.1'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);processes.append(p);return p
        first=launch(23001);second=launch(23002)
        old=wait(lambda:s if len(s:=g.sessions_snapshot((22222,)))==2 else None)
        since=time.time();time.sleep(1.1)
        third=launch(23003)
        sessions=wait(lambda:s if len(s:=g.sessions_snapshot((22222,)))==3 else None)
        # Waiting at a password prompt must not consume an authenticated slot.
        (d/'askpass').write_text('#!/bin/sh\nsleep 30\n');(d/'askpass').chmod(0o755)
        preauth=subprocess.Popen(base+['-o','PreferredAuthentications=password','-o','PubkeyAuthentication=no','abv_guardlive@127.0.0.1'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,env=dict(os.environ,DISPLAY='test',SSH_ASKPASS=str(d/'askpass'),SSH_ASKPASS_REQUIRE='force'));processes.append(preauth)
        time.sleep(1)
        assert len(g.sessions_snapshot((22222,)))==3,'Pre-authentication was counted as a session'
        mapping=o.ssh_process_accounts({'abv_guardlive':'test-account'})
        output=subprocess.check_output(o.ssh_socket_command({22222}),text=True)
        samples=list(o.ssh_socket_samples(output,mapping,{22222}))
        socket_lines=[line for line in output.splitlines() if 'ino:' in line]
        assert len(socket_lines)==4,'Pre-authentication test connection was not established'
        mapped=sum(bool(set(map(int,re.findall(r'pid=(\d+)',line)))&mapping.keys()) for line in socket_lines)
        assert mapped==3,'Accounting and controller disagree about authenticated sessions'
        counters_available='bytes_received:' in output
        if counters_available:assert len(samples)==3
        policy={'format':'abess-ssh-ws-policy-v1','generatedAt':datetime.now(timezone.utc).isoformat(),'accounts':[{'id':'ssh_00000000-0000-0000-0000-000000000001','username':'abv_guardlive','enabled':True,'maxConnections':1,'enforcementMode':'enforce-new','enforcementSince':datetime.fromtimestamp(since,timezone.utc).isoformat()}]}
        actions,over,_=g.planned_actions(policy,sessions)
        assert len(actions)==1 and over==1 and actions[0]['pid'] not in {s['pid'] for s in old}
        assert g.terminate_session(actions[0])
        wait(lambda:third.poll() is not None)
        assert first.poll() is None and second.poll() is None and daemon.poll() is None,'A preserved SSH process was stopped'
        # Existing tunnel still forwards a real SSH banner after enforcement.
        with socket.create_connection(('127.0.0.1',23001),timeout=3) as client:
            assert client.recv(512).startswith(b'SSH-')
        print('REAL_SSH_SESSIONS_VERIFIED='+json.dumps({'authenticated':3,'preauthExcluded':True,'accountingAgrees':True,'trafficCountersAvailable':counters_available,'onlyNewExcessTerminated':True,'oldTunnelsStillForward':True}))
    finally:
        for p in reversed(processes):
            if p.poll() is None:p.terminate()
        for p in processes:
            try:p.wait(timeout=3)
            except subprocess.TimeoutExpired:p.kill();p.wait()
