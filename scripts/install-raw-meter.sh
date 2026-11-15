#!/usr/bin/env bash
# Stage a compatible raw relay, then activate managed-user PAM admission.
# Unmanaged/admin PAM decisions and the existing forwarding service are retained.
set -Eeuo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
mode="${1:---prepare}"
source_dir="$(cd "$(dirname "$0")" && pwd)"
node_bin="$(command -v node)"
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]]
if ! getent group abess-gateway >/dev/null; then groupadd --system abess-gateway; fi
if ! id abess-gateway >/dev/null 2>&1; then useradd --system --gid abess-gateway --no-create-home --shell /usr/sbin/nologin abess-gateway; fi
install -d -m 0755 /usr/local/lib/abess
install -d -m 0700 -o abess-gateway -g abess-gateway /var/lib/abess-raw-meter
checksum="$(cat "$source_dir/ssh-raw-meter.mjs" "$source_dir/ssh-ws-quota.mjs" | sha256sum | cut -d' ' -f1)"
restart=yes
[[ -f /var/lib/abess-raw-meter/code.sha256 && "$(cat /var/lib/abess-raw-meter/code.sha256)" = "$checksum" ]] && restart=no
install -m 0644 "$source_dir/ssh-raw-meter.mjs" "$source_dir/ssh-ws-quota.mjs" /usr/local/lib/abess/
install -m 0755 "$source_dir/ssh-pam-admission.py" /usr/local/lib/abess/ssh-pam-admission.py
cat > /etc/systemd/system/abess-raw-meter.service <<UNIT
[Unit]
Description=ABESS strict raw SSH quota and authenticated session admission
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=abess-gateway
Group=abess-gateway
ExecStart=$node_bin /usr/local/lib/abess/ssh-raw-meter.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/abess-raw-meter /run/abess-raw-meter
RuntimeDirectory=abess-raw-meter
RuntimeDirectoryMode=0700
LimitNOFILE=65536
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable abess-raw-meter.service
if [[ "$restart" = yes ]] || ! systemctl is-active --quiet abess-raw-meter.service; then systemctl restart abess-raw-meter.service; fi
for attempt in {1..20}; do
  if curl --silent --fail --max-time 2 http://172.18.0.1:8081/healthz > /var/lib/abess-raw-meter/health-check.json; then break; fi
  sleep 1
done
python3 - <<'PY'
import json
from pathlib import Path
j=json.loads(Path('/var/lib/abess-raw-meter/health-check.json').read_text())
assert j['format']=='abess-raw-meter-v1' and j['strict'] is True
PY
printf '%s\n' "$checksum" > /var/lib/abess-raw-meter/code.sha256
if [[ "$mode" = --activate ]]; then
  [[ -f /etc/pam.d/sshd ]]
  /usr/sbin/sshd -t
  /usr/sbin/sshd -T | grep -qx 'usepam yes' || { echo 'UsePAM must already be enabled before strict admission.' >&2; exit 1; }
  if [[ ! -f /var/lib/abess-raw-meter/pam-sshd.original ]]; then cp -p /etc/pam.d/sshd /var/lib/abess-raw-meter/pam-sshd.original; chmod 0600 /var/lib/abess-raw-meter/pam-sshd.original; fi
  # PAM reads this account hook on each login; no administrator SSH restart.
  python3 - <<'PY'
import os
from pathlib import Path
p=Path('/etc/pam.d/sshd');line='account requisite pam_exec.so quiet /usr/bin/python3 /usr/local/lib/abess/ssh-pam-admission.py'
s=p.read_text()
if line not in s.splitlines():
    temp=p.with_name('sshd.abess-new');temp.write_text(line+'\n'+s);temp.chmod(p.stat().st_mode&0o777);os.replace(temp,p)
PY
  # Probe the actual hook for an administrator before enabling VPN admission.
  PAM_USER=root PAM_TYPE=account /usr/bin/python3 /usr/local/lib/abess/ssh-pam-admission.py
  systemctl stop abess-traffic-observer.service 2>/dev/null || true
  touch /var/lib/abess-raw-meter/enabled
  chmod 0644 /var/lib/abess-raw-meter/enabled
  echo 'RAW_METER_ACTIVATED=true strict_sessions=true strict_bytes=true'
else
  echo 'RAW_METER_PREPARED=true'
fi
