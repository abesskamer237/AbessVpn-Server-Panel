#!/usr/bin/env bash
# Update accounting only. Never restart or reconfigure the VPN forwarding engine.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
source_dir="$(cd "$(dirname "$0")" && pwd)"
if [[ -f /var/lib/abess-raw-meter/enabled ]]; then
  systemctl stop abess-traffic-observer.service 2>/dev/null || true
  curl --fail --silent --show-error --max-time 5 http://172.18.0.1:8081/healthz | python3 -c 'import json,sys; j=json.load(sys.stdin); assert j["ok"] and j["strict"]'
  echo 'TRAFFIC_ACCOUNTING=strict-inline passive_billing_disabled=true'
  exit 0
fi
python3 "$source_dir/test-ssh-socket-traffic.py"
before="$(systemctl show -p MainPID --value willy-ssh-ws.service)"
[[ "$before" =~ ^[1-9][0-9]*$ ]] || { echo 'Existing forwarding service is not running' >&2; exit 1; }
install -d -m 0755 /usr/local/lib/abess
install -d -m 0700 /var/lib/abess-traffic-observer
install -m 0755 "$source_dir/ssh-ws-passive-traffic.py" /usr/local/lib/abess/ssh-ws-passive-traffic.py
install -m 0644 "$source_dir/ssh_session_identity.py" /usr/local/lib/abess/ssh_session_identity.py
cat > /etc/systemd/system/abess-traffic-observer.service <<'UNIT'
[Unit]
Description=ABESS passive SSH transport traffic observer
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
Environment=ABESS_OBSERVER_MODE=ssh-sockets
ExecStart=/usr/bin/python3 /usr/local/lib/abess/ssh-ws-passive-traffic.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/abess-traffic-observer
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable abess-traffic-observer.service
systemctl restart abess-traffic-observer.service
sleep 15
systemctl is-active --quiet abess-traffic-observer.service
python3 - <<'PY'
import json,time,urllib.request
from pathlib import Path
s=json.loads(Path('/var/lib/abess-traffic-observer/status.json').read_text())
r=json.loads(Path('/var/lib/abess-traffic-observer/usage.json').read_text())
assert s.get('mode')=='ssh-sockets' and s.get('lastReportOk') is True
assert time.time()-s['lastReportAt']<25
# Confirm persistence through the authenticated control API, not just a file.
identity=json.loads(Path('/etc/abess-ssh-ws/node-bootstrap.json').read_text())
key=Path('/etc/abess-ssh-ws/node-key').read_text().strip()
request=urllib.request.Request('http://127.0.0.1:3000/api/v1/nodes/'+identity['id']+'/ssh-ws/desired',headers={'Authorization':'Bearer '+key})
with urllib.request.urlopen(request,timeout=8) as response:
    accounts=json.load(response)['accounts']
expected={aid:int(a.get('anchorBaseline',0))+int(a.get('observedBytes',0)) for aid,a in r['accounts'].items()}
assert all(a['baselineUsedBytes']>=expected.get(a['id'],0) for a in accounts), 'Consumption not persisted by control API'
measured=sum(a.get('observedBytes',0) for a in r['accounts'].values())
assert measured>0, 'No active managed SSH traffic observed; reconnect a client and retry'
print('TRAFFIC_OBSERVER_VERIFIED='+json.dumps({
 'mode':s['mode'],'reportOk':s['lastReportOk'],
 'activeAccounts':s['mappedConnections'],'activeSessions':s['activeMappedConnections'],
 'measuredBytes':measured,'apiPersistenceVerified':True}))
PY
after="$(systemctl show -p MainPID --value willy-ssh-ws.service)"
[[ "$before" = "$after" ]] || { echo 'Forwarding service PID changed during observer update' >&2; exit 1; }
echo 'VPN_FORWARDING_PID_UNCHANGED=true'
