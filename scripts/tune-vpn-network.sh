#!/usr/bin/env bash
# Reversible TCP defaults; no service restarts or live routing changes.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
engine_before="$(systemctl show -p MainPID --value willy-ssh-ws.service)"
[[ "$engine_before" =~ ^[1-9][0-9]*$ ]]
backup_dir="/var/lib/abess-network-tuning"
install -d -m 0700 "$backup_dir"
if [[ ! -e "$backup_dir/original.conf" ]]; then
  (umask 077
   for key in net.ipv4.tcp_congestion_control net.ipv4.tcp_mtu_probing; do
     printf '%s = %s\n' "$key" "$(sysctl -n "$key")"
   done > "$backup_dir/original.conf")
fi
original_cc="$(sysctl -n net.ipv4.tcp_congestion_control)"
# Some hosts expose BBR without a loadable module. Never fail over to an
# unavailable algorithm or replace an already configured BBR variant.
if ! sysctl -n net.ipv4.tcp_available_congestion_control | grep -qw bbr; then
  modprobe tcp_bbr 2>/dev/null || true
fi
new_cc="$original_cc"
if [[ "$original_cc" == cubic || "$original_cc" == reno ]] && sysctl -n net.ipv4.tcp_available_congestion_control | grep -qw bbr; then
  new_cc=bbr
fi
mtu="$(sysctl -n net.ipv4.tcp_mtu_probing)"
if [[ "$mtu" -eq 0 ]]; then mtu=1; fi
config="$(mktemp)"
trap 'rm -f "$config"' EXIT
printf 'net.ipv4.tcp_congestion_control = %s\nnet.ipv4.tcp_mtu_probing = %s\n' "$new_cc" "$mtu" > "$config"
sysctl -p "$config"
install -m 0644 "$config" /etc/sysctl.d/90-abess-tcp.conf
# Caddy terminates public TLS in its own network namespace. Host defaults
# alone do not prove the public client sockets use the selected algorithm.
project="$HOME/abessvpn-server"
if [[ -f "$project/docker-compose.yml" ]]; then
  container="$(docker compose --project-directory "$project" -f "$project/docker-compose.yml" ps -q caddy)"
  [[ -n "$container" ]]
  caddy_pid="$(docker inspect --format '{{.State.Pid}}' "$container")"
  [[ "$caddy_pid" =~ ^[1-9][0-9]*$ ]]
  previous_public_cc="$(nsenter -t "$caddy_pid" -n sysctl -n net.ipv4.tcp_congestion_control)"
  public_cc="$previous_public_cc"
  if [[ "$previous_public_cc" == cubic || "$previous_public_cc" == reno ]]; then public_cc="$new_cc"; fi
  if [[ ! -e "$backup_dir/caddy-original.conf" ]]; then
    (umask 077
      for key in net.ipv4.tcp_congestion_control net.ipv4.tcp_mtu_probing; do
        printf '%s = %s\n' "$key" "$(nsenter -t "$caddy_pid" -n sysctl -n "$key")"
      done > "$backup_dir/caddy-original.conf")
  fi
  nsenter -t "$caddy_pid" -n sysctl -w "net.ipv4.tcp_congestion_control=$public_cc" net.ipv4.tcp_mtu_probing=1
  [[ "$(nsenter -t "$caddy_pid" -n sysctl -n net.ipv4.tcp_congestion_control)" = "$public_cc" ]]
  [[ "$(docker inspect --format '{{.State.Pid}}' "$container")" = "$caddy_pid" ]]
  # Preserve only this non-secret choice for future Compose container starts.
  python3 - "$project/.env" "$public_cc" <<'PYENV'
import os,re,sys,tempfile
from pathlib import Path
p=Path(sys.argv[1]);text=p.read_text();key='VPN_TCP_CONGESTION_CONTROL='
text='\n'.join(line for line in text.splitlines() if not line.startswith(key))+'\n'+key+sys.argv[2]+'\n'
fd,name=tempfile.mkstemp(dir=p.parent,prefix='.env.tcp-')
try:
    os.fchmod(fd,p.stat().st_mode & 0o777)
    with os.fdopen(fd,'w') as f:f.write(text)
    os.replace(name,p)
finally:
    if os.path.exists(name):os.unlink(name)
PYENV
  echo "PUBLIC_TLS_TCP_TUNING previous=$previous_public_cc active=$public_cc mtu_probing=1 caddy_pid_unchanged=true"
fi
[[ "$(systemctl show -p MainPID --value willy-ssh-ws.service)" == "$engine_before" ]]
echo "TCP_TUNING previous=$original_cc active=$(sysctl -n net.ipv4.tcp_congestion_control) mtu_probing=$(sysctl -n net.ipv4.tcp_mtu_probing) forwarding_pid_unchanged=true"
echo 'TCP_TUNING_SCOPE=new_connections; existing_tunnels_preserved=true'
echo 'TCP_ROLLBACK=sysctl -p /var/lib/abess-network-tuning/original.conf; rm -f /etc/sysctl.d/90-abess-tcp.conf'
