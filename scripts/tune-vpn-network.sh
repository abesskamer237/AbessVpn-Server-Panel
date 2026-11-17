#!/usr/bin/env bash
# Reversible TCP defaults; no service restarts or live routing changes.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
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
engine_before="$(systemctl show -p MainPID --value "$forwarding_unit")"
[[ "$engine_before" =~ ^[1-9][0-9]*$ ]] || {
  echo "Cannot read the active forwarding service PID: $forwarding_unit" >&2
  exit 1
}
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

# A 4 MiB socket-buffer ceiling is sufficient for a 100 Mb/s path around
# 200 ms RTT (roughly 2.5 MiB bandwidth-delay product), without forcing
# large buffers to be allocated for every connection. Preserve originals.
buffer_config="$(mktemp)"
caddy_buffer_config="$(mktemp)"
trap 'rm -f "$config" "$buffer_config" "$caddy_buffer_config"' EXIT
if [[ ! -e "$backup_dir/original-buffers.conf" ]]; then
  (umask 077
   for key in net.core.rmem_max net.core.wmem_max net.core.netdev_max_backlog; do
     printf '%s = %s\n' "$key" "$(sysctl -n "$key")"
   done > "$backup_dir/original-buffers.conf")
fi
printf 'net.core.rmem_max = 4194304\nnet.core.wmem_max = 4194304\nnet.core.netdev_max_backlog = 4096\n' > "$buffer_config"
printf 'net.core.rmem_max = 4194304\nnet.core.wmem_max = 4194304\n' > "$caddy_buffer_config"
sysctl -p "$buffer_config"
install -m 0644 "$buffer_config" /etc/sysctl.d/91-abess-tcp-buffers.conf
# Caddy terminates public TLS in its own network namespace. Host defaults
# alone do not prove the public client sockets use the selected algorithm.
project="$HOME/abessvpn-server"
if [[ -f "$project/docker-compose.yml" ]]; then
  container="$(docker compose --project-directory "$project" -f "$project/docker-compose.yml" ps -q caddy)"
  [[ -n "$container" ]]
  caddy_pid="$(docker inspect --format '{{.State.Pid}}' "$container")"
  [[ "$caddy_pid" =~ ^[1-9][0-9]*$ ]]
  if [[ ! -e "$backup_dir/caddy-original-buffers.conf" ]]; then
    (umask 077
      for key in net.core.rmem_max net.core.wmem_max; do
        printf '%s = %s\\n' "$key" "$(nsenter -t "$caddy_pid" -n sysctl -n "$key")"
      done > "$backup_dir/caddy-original-buffers.conf")
  fi
  nsenter -t "$caddy_pid" -n sysctl -p "$caddy_buffer_config"
  [[ "$(nsenter -t "$caddy_pid" -n sysctl -n net.core.rmem_max)" = 4194304 ]]
  [[ "$(nsenter -t "$caddy_pid" -n sysctl -n net.core.wmem_max)" = 4194304 ]]
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
[[ "$(systemctl show -p MainPID --value "$forwarding_unit")" == "$engine_before" ]]
echo "TCP_TUNING previous=$original_cc active=$(sysctl -n net.ipv4.tcp_congestion_control) mtu_probing=$(sysctl -n net.ipv4.tcp_mtu_probing) forwarding_service=$forwarding_unit forwarding_pid_unchanged=true"
echo 'TCP_TUNING_SCOPE=new_connections; existing_tunnels_preserved=true'
echo "TCP_BUFFER_TUNING host_rmem_max=$(sysctl -n net.core.rmem_max) host_wmem_max=$(sysctl -n net.core.wmem_max) netdev_backlog=$(sysctl -n net.core.netdev_max_backlog) caddy_rmem_max=$(nsenter -t "$caddy_pid" -n sysctl -n net.core.rmem_max 2>/dev/null || echo not-configured) caddy_wmem_max=$(nsenter -t "$caddy_pid" -n sysctl -n net.core.wmem_max 2>/dev/null || echo not-configured)"
echo 'TCP_ROLLBACK=sysctl -p /var/lib/abess-network-tuning/original.conf; sysctl -p /var/lib/abess-network-tuning/original-buffers.conf; rm -f /etc/sysctl.d/90-abess-tcp.conf /etc/sysctl.d/91-abess-tcp-buffers.conf'
echo 'CADDY_BUFFER_ROLLBACK=nsenter -t <caddy-pid> -n sysctl -p /var/lib/abess-network-tuning/caddy-original-buffers.conf'
