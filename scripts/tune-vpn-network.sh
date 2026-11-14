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
[[ "$(systemctl show -p MainPID --value willy-ssh-ws.service)" == "$engine_before" ]]
echo "TCP_TUNING previous=$original_cc active=$(sysctl -n net.ipv4.tcp_congestion_control) mtu_probing=$(sysctl -n net.ipv4.tcp_mtu_probing) forwarding_pid_unchanged=true"
echo 'TCP_TUNING_SCOPE=new_connections; existing_tunnels_preserved=true'
echo 'TCP_ROLLBACK=sysctl -p /var/lib/abess-network-tuning/original.conf; rm -f /etc/sysctl.d/90-abess-tcp.conf'
