#!/usr/bin/env bash
# MANUAL OPERATOR ACTION ON A VPS ONLY. Never invoked by GitHub CI/deploy.
# Creates isolated SSH-WS systemd services and DOES NOT edit existing sshd/Caddy.
set -euo pipefail
if [[ "$EUID" -ne 0 ]]; then echo "Run as root on the selected VPS." >&2; exit 1; fi
if [[ ! -f scripts/ssh-ws-gateway.mjs || ! -f scripts/ssh-ws-reconciler.mjs ]]; then
  echo "Run from ABESS repository root." >&2; exit 1
fi
if [[ "$PWD" == *" "* || "$PWD" == /root* || "$PWD" == /home/* ]]; then
  echo "Use a system checkout such as /opt/abess-panel (no spaces/home directory)." >&2; exit 1
fi
if [[ -z "${CONTROL_API_BASE_URL:-}" || ! "${CONTROL_API_BASE_URL}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "CONTROL_API_BASE_URL must be the HTTPS panel origin." >&2; exit 1
fi
if [[ ! "${VPN_NODE_ID:-}" =~ ^[0-9a-f-]{36}$ || ! -s "${VPN_NODE_KEY_FILE:-/dev/null}" ]]; then
  echo "Provide VPN_NODE_ID and root-only VPN_NODE_KEY_FILE." >&2; exit 1
fi
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]]; then
  echo "Node 22+ is required." >&2; exit 1
fi
if [[ ! -x /usr/sbin/sshd || ! -f /etc/ssh/ssh_host_ed25519_key ]]; then
  echo "Install openssh-server and its Ed25519 host key first." >&2; exit 1
fi
if [[ ! -f node_modules/ws/package.json ]]; then
  echo "Run npm ci in this checkout first." >&2; exit 1
fi
install -d -m 0700 /etc/abess-ssh-ws /var/lib/abess-ssh-ws
if ! getent group abessvpn >/dev/null; then groupadd --system abessvpn; fi
if ! getent group abess-gateway >/dev/null; then groupadd --system abess-gateway; fi
if ! id abess-gateway >/dev/null 2>&1; then
  useradd --system --gid abess-gateway --no-create-home --shell /usr/sbin/nologin abess-gateway
fi
if [[ "$(id -gn abess-gateway)" != "abess-gateway" ]]; then
  echo "The existing abess-gateway user must have its dedicated private group." >&2
  exit 1
fi
# The unprivileged gateway reads a root-written policy and writes only its own counters.
chmod 0751 /var/lib/abess-ssh-ws
install -d -o root -g abess-gateway -m 0750 /var/lib/abess-ssh-ws/policy
install -d -o abess-gateway -g abess-gateway -m 0700 /var/lib/abess-ssh-ws/gateway
cat > /etc/abess-ssh-ws/sshd_config <<'SSHD'
Port 2222
ListenAddress 127.0.0.1
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /run/abess-ssh-ws-sshd.pid
PasswordAuthentication yes
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication no
UsePAM yes
AllowGroups abessvpn
AllowTcpForwarding local
GatewayPorts no
PermitTunnel no
PermitTTY no
X11Forwarding no
AllowAgentForwarding no
PermitUserEnvironment no
MaxSessions 0
MaxStartups 20:30:120
UseDNS no
LogLevel VERBOSE
Include /etc/abess-ssh-ws/allowed-users.conf
SSHD
chmod 0600 /etc/abess-ssh-ws/sshd_config
# Explicit no-user policy until the reconciler binds each username to a
# unique, gateway-controlled 127.120.x.y loopback source IP.
if [[ ! -e /etc/abess-ssh-ws/allowed-users.conf ]]; then
  printf 'AllowUsers _abess_no_active_user_\n' > /etc/abess-ssh-ws/allowed-users.conf
fi
chmod 0600 /etc/abess-ssh-ws/allowed-users.conf
/usr/sbin/sshd -t -f /etc/abess-ssh-ws/sshd_config
cat > /etc/systemd/system/abess-ssh-ws-sshd.service <<'UNIT'
[Unit]
Description=ABESS isolated SSHD for WebSocket tunneling
After=network.target
[Service]
Type=simple
ExecStart=/usr/sbin/sshd -D -e -f /etc/abess-ssh-ws/sshd_config
Restart=on-failure
RestartSec=2
RuntimeDirectory=sshd
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/abess-ssh-ws-gateway.service <<UNIT
[Unit]
Description=ABESS SSH-WS gateway (loopback only)
After=network.target abess-ssh-ws-sshd.service
Requires=abess-ssh-ws-sshd.service
[Service]
Type=simple
User=abess-gateway
WorkingDirectory=$PWD
Environment=SSH_WS_LISTEN_PORT=2080
Environment=SSH_WS_SSH_PORT=2222
Environment=SSH_WS_PATH=/ssh-ws
Environment=SSH_WS_MAX_CONNECTIONS=512
Environment=SSH_WS_POLICY_FILE=/var/lib/abess-ssh-ws/policy/gateway-policy.json
Environment=SSH_WS_USAGE_FILE=/var/lib/abess-ssh-ws/gateway/usage.json
Environment=SSH_WS_USAGE_REPORT_FILE=/var/lib/abess-ssh-ws/gateway/usage-live.json
ExecStart=$NODE_BIN $PWD/scripts/ssh-ws-gateway.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/abess-ssh-ws/gateway
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
UMask=0077
MemoryMax=256M
TasksMax=512
[Install]
WantedBy=multi-user.target
UNIT
install -m 0600 -o root -g root "$VPN_NODE_KEY_FILE" /etc/abess-ssh-ws/node-key
cat > /etc/abess-ssh-ws/agent.env <<ENV
CONTROL_API_BASE_URL=$CONTROL_API_BASE_URL
VPN_NODE_ID=$VPN_NODE_ID
VPN_NODE_KEY_FILE=/etc/abess-ssh-ws/node-key
SSH_WS_STATE_FILE=/var/lib/abess-ssh-ws/state.json
SSH_WS_ALLOW_USERS_FILE=/etc/abess-ssh-ws/allowed-users.conf
SSH_WS_POLICY_FILE=/var/lib/abess-ssh-ws/policy/gateway-policy.json
SSH_WS_USAGE_REPORT_FILE=/var/lib/abess-ssh-ws/gateway/usage-live.json
SSH_WS_GATEWAY_GID=$(id -g abess-gateway)
SSH_WS_OFFLINE_LIMIT_MS=600000
ENV
chmod 0600 /etc/abess-ssh-ws/agent.env
cat > /etc/systemd/system/abess-ssh-ws-reconciler.service <<UNIT
[Unit]
Description=ABESS scoped SSH-WS account reconciler
Wants=network-online.target
After=network-online.target abess-ssh-ws-sshd.service
[Service]
Type=simple
EnvironmentFile=/etc/abess-ssh-ws/agent.env
WorkingDirectory=$PWD
ExecStart=$NODE_BIN $PWD/scripts/ssh-ws-reconciler.mjs
Restart=always
RestartSec=5
User=root
PrivateTmp=true
ProtectHome=true
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now abess-ssh-ws-sshd.service abess-ssh-ws-gateway.service abess-ssh-ws-reconciler.service
printf 'SSH-WS on 127.0.0.1:2080 -> SSH on 127.0.0.1:2222\n'
printf 'Ed25519 SSH host fingerprint (verify independently):\n'
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
printf 'Configure a separate Caddy HTTPS/WSS host route /ssh-ws manually.\n'
