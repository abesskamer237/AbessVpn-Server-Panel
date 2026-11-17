#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || exit 1
source_dir="$(cd "$(dirname "$0")" && pwd)"
python3 "$source_dir/test-ssh-session-guard.py"
forwarding_unit=""
for candidate in abess-ssh-ws-sshd.service willy-ssh-ws.service; do
  if systemctl is-active --quiet "$candidate"; then
    forwarding_unit="$candidate"
    break
  fi
done
[[ -n "$forwarding_unit" ]] || {
  echo 'No supported ABESS SSH forwarding service is active.' >&2
  exit 1
}
before="$(systemctl show -p MainPID --value "$forwarding_unit")"
[[ "$before" =~ ^[1-9][0-9]*$ ]] || {
  echo "Cannot read the active forwarding service PID: $forwarding_unit" >&2
  exit 1
}
install -d -m 0755 /usr/local/lib/abess
install -d -m 0700 /var/lib/abess-session-guard
install -m 0755 "$source_dir/ssh-session-guard.py" /usr/local/lib/abess/ssh-session-guard.py
install -m 0644 "$source_dir/ssh_session_identity.py" /usr/local/lib/abess/ssh_session_identity.py
cat > /etc/systemd/system/abess-session-guard.service <<'UNIT'
[Unit]
Description=ABESS managed SSH connection limits (new sessions only)
After=abess-ssh-ws-reconciler.service
[Service]
Type=simple
User=root
ExecStart=/usr/bin/python3 /usr/local/lib/abess/ssh-session-guard.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/abess-session-guard
CapabilityBoundingSet=CAP_KILL CAP_DAC_READ_SEARCH CAP_SYS_PTRACE
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable abess-session-guard.service
systemctl restart abess-session-guard.service
sleep 4
systemctl is-active --quiet abess-session-guard.service
python3 - <<'PYGUARD'
import json,time
from datetime import datetime
from pathlib import Path
s=json.loads(Path('/var/lib/abess-session-guard/status.json').read_text())
assert s.get('format')=='abess-session-guard-v1' and s.get('healthy') is True, 'Session guard policy validation failed'
assert time.time()-datetime.fromisoformat(s['observedAt']).timestamp()<30
print('SESSION_GUARD_HEALTH='+json.dumps({k:s[k] for k in ['mode','healthy','observedSessions','overLimitAccounts','deniedTotal']}))
PYGUARD
[[ "$(systemctl show -p MainPID --value "$forwarding_unit")" = "$before" ]]
echo "SESSION_GUARD_INSTALLED=true forwarding_service=$forwarding_unit forwarding_pid_unchanged=true"
