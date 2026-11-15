#!/usr/bin/env python3
"""Read-only compatibility probe: no credentials and no authenticated tunnel."""
import json,socket,subprocess
from pathlib import Path
with socket.create_connection(('127.0.0.1',8080),timeout=5) as s:
    s.settimeout(5);s.sendall(b'GET /ssh-ws/compatibility-probe HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    data=b''
    try:
        while len(data)<8192 and b'SSH-' not in data:data+=s.recv(4096)
    except (TimeoutError,OSError):pass
    header,_,payload=data.partition(b'\r\n\r\n')
    status=header.split(b'\r\n')[0].decode(errors='replace')
    print('RAW_TRANSPORT_COMPATIBILITY='+json.dumps({'httpStatus':status,'sshBanner':payload.startswith(b'SSH-'),'rawSshPresent':b'SSH-' in data}))
config=subprocess.check_output(['/usr/sbin/sshd','-T'],text=True)
print('SSH_PAM_READINESS='+json.dumps({'usePam':'usepam yes' in config,'pamSshdFile':Path('/etc/pam.d/sshd').is_file(),'pamExecAvailable':any(Path(p).exists() for p in ['/lib/x86_64-linux-gnu/security/pam_exec.so','/usr/lib/x86_64-linux-gnu/security/pam_exec.so'])}))
with socket.create_connection(('127.0.0.1',8080),timeout=5) as s:
    s.settimeout(5);s.sendall(b'GET /ssh-ws/compatibility-probe HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n')
    data=b''
    try:
        while len(data)<8192 and b'SSH-' not in data:
            chunk=s.recv(4096)
            if not chunk:break
            data+=chunk
    except (TimeoutError,OSError):pass
    header,_,payload=data.partition(b'\r\n\r\n')
    print('WEBSOCKET_KEY_COMPATIBILITY='+json.dumps({'rawSshPresent':payload.startswith(b'SSH-'),'websocketAcceptHeader':b'sec-websocket-accept:' in header.lower(),'payloadPresent':bool(payload)}))
