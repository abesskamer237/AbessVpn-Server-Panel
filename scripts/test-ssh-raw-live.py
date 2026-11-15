#!/usr/bin/env python3
"""Disposable-container integration of real PAM admission and the raw relay."""
import json,os,socket,subprocess,tempfile,threading,time
from datetime import datetime,timezone
from pathlib import Path
assert os.environ.get('ABESS_ISOLATED_SSH_TEST')=='yes'
ROOT=Path(__file__).parent
def run(*args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def wait(fn):
    for _ in range(150):
        try:
            result=fn()
            if result:return result
        except (OSError,ValueError,KeyError):pass
        time.sleep(.1)
    raise AssertionError('Raw SSH admission test timed out')
run('groupadd','--system','abessvpn');run('useradd','--gid','abessvpn','--no-create-home','--shell','/usr/sbin/nologin','abv_rawlive');run('usermod','--password','x','abv_rawlive')
Path('/run/sshd').mkdir(exist_ok=True)
processes=[];stop=threading.Event()
with tempfile.TemporaryDirectory(prefix='abess-raw-live-') as directory:
    d=Path(directory);d.chmod(0o755)
    run('ssh-keygen','-q','-t','ed25519','-N','','-f',str(d/'host'));run('ssh-keygen','-q','-t','ed25519','-N','','-f',str(d/'key'))
    (d/'authorized_keys').write_bytes((d/'key.pub').read_bytes());(d/'authorized_keys').chmod(0o644)
    Path('/etc/pam.d/sshd').write_text(f'auth required pam_unix.so\naccount requisite pam_exec.so quiet /usr/local/bin/python3 {ROOT}/ssh-pam-admission.py\naccount required pam_permit.so\nsession required pam_permit.so\n')
    config=f'Port 22222\nListenAddress 127.0.0.1\nHostKey {d}/host\nPidFile {d}/pid\nAuthorizedKeysFile {d}/authorized_keys\nStrictModes no\nUsePAM yes\nPermitRootLogin yes\nPasswordAuthentication no\nAllowTcpForwarding yes\nLogLevel ERROR\n'
    (d/'config').write_text(config)
    daemon=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(d/'config')],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);processes.append(daemon)
    account={'id':'ssh_00000000-0000-0000-0000-000000000001','username':'abv_rawlive','sourceIp':'127.120.0.1','tokenHash':'a'*64,'enabled':True,'expiresAt':datetime.fromtimestamp(time.time()+3600,timezone.utc).isoformat(),'quotaBytes':1024*1024,'baselineUsedBytes':0,'maxConnections':1,'blockedDevices':[]}
    def policy():
        p={'format':'abess-ssh-ws-policy-v1','generatedAt':datetime.now(timezone.utc).isoformat(),'accounts':[dict(account)]}
        (d/'policy.tmp').write_text(json.dumps(p));os.replace(d/'policy.tmp',d/'policy.json')
    policy();(d/'active').touch()
    def updater():
        while not stop.wait(1):policy()
    threading.Thread(target=updater,daemon=True).start()
    log=(d/'relay.log').open('wb')
    relay=subprocess.Popen(['node',str(ROOT/'ssh-raw-meter.mjs')],env=dict(os.environ,RAW_METER_HOST='127.0.0.1',RAW_METER_PORT='2081',RAW_METER_SSH_PORT='22222',RAW_METER_DATA=str(d/'data'),RAW_METER_POLICY=str(d/'policy.json'),RAW_METER_ACTIVE=str(d/'active')),stdout=log,stderr=log);processes.append(relay)
    (d/'proxy.py').write_text('''import os,select,socket,sys
s=socket.create_connection(('127.0.0.1',2081));s.sendall(b'GET /legacy-common-path HTTP/1.1\\r\\nHost: localhost\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nX-Abess-Device-ID: '+sys.argv[1].encode()+b'\\r\\nX-Abess-Device-Name: Test phone\\r\\n\\r\\n')
data=b''
while b'\\r\\n\\r\\n' not in data:
 c=s.recv(4096)
 if not c:raise SystemExit(1)
 data+=c
header,_,rest=data.partition(b'\\r\\n\\r\\n')
if not header.startswith(b'HTTP/1.1 101'):raise SystemExit(2)
if rest:os.write(1,rest)
while True:
 ready,_,_=select.select([0,s],[],[],10)
 for fd in ready:
  data=os.read(0,65536) if fd==0 else s.recv(65536)
  if not data:raise SystemExit(0)
  if fd==0:s.sendall(data)
  else:os.write(1,data)
''')
    base=['ssh','-p','22222','-i',str(d/'key'),'-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null','-o','LogLevel=ERROR','-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ConnectTimeout=4']
    def client(device,port):
        p=subprocess.Popen(base+['-o',f'ProxyCommand=/usr/local/bin/python3 {d}/proxy.py {device}','-N','-L',str(port)+':127.0.0.1:24000','abv_rawlive@127.0.0.1'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);processes.append(p);return p
    def usage():return json.loads((d/'data/usage-live.json').read_text())['accounts'][0]
    try:
        wait(lambda:Path('/run/abess-raw-meter/control.sock').exists())
        first=client('phone-alpha',23001)
        wait(lambda:usage()['online']==1)
        second=client('phone-beta',23002);wait(lambda:second.poll() is not None)
        assert first.poll() is None and usage()['online']==1,'Extra session bypassed the admission limit'
        direct=subprocess.run(base+['-N','abv_rawlive@127.0.0.1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
        assert direct.returncode!=0,'Direct SSH bypassed the relay quota'
        admin=subprocess.run(base+['root@127.0.0.1','true'],capture_output=True,timeout=8)
        assert admin.returncode==0,admin.stderr.decode()
        devices=usage()['devices'];assert len(devices)==1 and devices[0]['name']=='Test phone'
        key=devices[0]['deviceKey'];account['blockedDevices']=[key];policy()
        wait(lambda:first.poll() is not None)
        blocked=client('phone-alpha',23003);wait(lambda:blocked.poll() is not None)
        account['blockedDevices']=[];policy();time.sleep(.4)
        resumed=client('phone-alpha',23004);wait(lambda:usage()['online']==1)
        listener=socket.socket();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(('127.0.0.1',24000));listener.listen()
        def echo():
            conn,_=listener.accept()
            with conn:
                while data:=conn.recv(65536):conn.sendall(data)
        threading.Thread(target=echo,daemon=True).start()
        with socket.create_connection(('127.0.0.1',23004),timeout=5) as data:
            data.settimeout(5)
            try:
                for _ in range(80):data.sendall(b'x'*32768);data.recv(32768)
            except OSError:pass
        wait(lambda:resumed.poll() is not None)
        exhausted=wait(lambda:u if (u:=usage())['usedBytes']==account['quotaBytes'] else None)
        assert exhausted['usedBytes']<=account['quotaBytes']
        retry=client('phone-gamma',23005);wait(lambda:retry.poll() is not None)
        # A clean restart retains spent quota and cannot resurrect sessions.
        relay.terminate();relay.wait(timeout=5)
        restart=subprocess.Popen(['node',str(ROOT/'ssh-raw-meter.mjs')],env=dict(os.environ,RAW_METER_HOST='127.0.0.1',RAW_METER_PORT='2081',RAW_METER_SSH_PORT='22222',RAW_METER_DATA=str(d/'data'),RAW_METER_POLICY=str(d/'policy.json'),RAW_METER_ACTIVE=str(d/'active')),stdout=log,stderr=log);processes.append(restart)
        time.sleep(1.2);assert usage()['usedBytes']==account['quotaBytes'] and usage()['online']==0
        print('RAW_SSH_HARD_LIMITS_VERIFIED='+json.dumps({'realPamAdmission':True,'extraSessionRejectedBeforeAuthentication':True,'directSshBypassRejected':True,'adminUnaffected':True,'deviceBlockAndResume':True,'quotaBytes':exhausted['usedBytes'],'quotaNeverExceeded':True,'restartPreservesQuota':True}))
    except Exception:
        log.flush();print((d/'relay.log').read_text());print('SSHD_ALIVE='+str(daemon.poll() is None));raise
    finally:
        stop.set()
        for p in reversed(processes):
            if p.poll() is None:p.terminate()
        for p in processes:
            try:p.wait(timeout=3)
            except subprocess.TimeoutExpired:p.kill();p.wait()
        log.close()
