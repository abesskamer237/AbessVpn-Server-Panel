#!/usr/bin/env bash
# Clean up dead mobile SSH sessions without restarting the forwarding service.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || exit 1
config=/etc/ssh/sshd_config
backup_dir=/var/lib/abess-network-tuning
install -d -m 0700 "$backup_dir"
engine_before="$(systemctl show -p MainPID --value willy-ssh-ws.service)"
[[ "$engine_before" =~ ^[1-9][0-9]*$ ]]
sshd_service=ssh.service
systemctl is-active --quiet "$sshd_service" || sshd_service=sshd.service
systemctl is-active --quiet "$sshd_service"
admin_before="$(/usr/sbin/sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep '^clientalive')"
candidate="$(mktemp /etc/ssh/sshd_config.abess.XXXXXXXX)"
trap 'rm -f "$candidate"' EXIT
python3 - "$config" "$candidate" <<'PY'
import re,sys
from pathlib import Path
original=Path(sys.argv[1]).read_text()
start='# BEGIN ABESS VPN MOBILE KEEPALIVE'
end='# END ABESS VPN MOBILE KEEPALIVE'
original=re.sub(r'\n?'+re.escape(start)+r'.*?'+re.escape(end)+r'\n?', '\n', original, flags=re.S)
Path(sys.argv[2]).write_text(original.rstrip()+'\n\n'+start+'\nMatch User abv_*\n    ClientAliveInterval 30\n    ClientAliveCountMax 6\n'+end+'\n')
PY
chmod 0600 "$candidate"
/usr/sbin/sshd -t -f "$candidate"
vpn_settings="$(/usr/sbin/sshd -T -f "$candidate" -C user=abv_diagnostic,host=localhost,addr=127.0.0.1 | grep '^clientalive')"
printf '%s\n' "$vpn_settings" | grep -qx 'clientaliveinterval 30'
printf '%s\n' "$vpn_settings" | grep -qx 'clientalivecountmax 6'
admin_after="$(/usr/sbin/sshd -T -f "$candidate" -C user=root,host=localhost,addr=127.0.0.1 | grep '^clientalive')"
[[ "$admin_before" = "$admin_after" ]]
if [[ ! -e "$backup_dir/sshd_config.original" ]]; then
  install -m 0600 "$config" "$backup_dir/sshd_config.original"
fi
rollback="$(mktemp "$backup_dir/sshd_config.rollback.XXXXXXXX")"
install -m 0600 "$config" "$rollback"
config_mode="$(stat -c '%a' "$config")"
chmod "$config_mode" "$candidate"
mv "$candidate" "$config"
if ! systemctl reload "$sshd_service"; then
  install -m "$config_mode" "$rollback" "$config"
  systemctl reload "$sshd_service" || true
  rm -f "$rollback"
  exit 1
fi
rm -f "$rollback"
systemctl is-active --quiet "$sshd_service"
[[ "$(systemctl show -p MainPID --value willy-ssh-ws.service)" = "$engine_before" ]]
echo 'VPN_SSH_STABILITY interval_seconds=30 missed_replies=6 scope=new_abv_sessions admin_keepalive_unchanged=true forwarding_pid_unchanged=true'
echo 'EXISTING_SESSIONS=preserved; RECONNECT_CLIENT=required_for_new_settings'
