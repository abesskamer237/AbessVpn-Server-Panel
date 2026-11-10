#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
image="${SSH_TEST_IMAGE:-abessvpn-api:ci}"
network="abess-ssh-test-$$"
container="abess-ssh-test-$$"
caddy_container="abess-ssh-caddy-test-$$"
fixture_dir="$(mktemp -d)"
chmod 755 "$fixture_dir"
cleanup() {
  if [ "$?" -ne 0 ]; then docker logs --tail 30 "$caddy_container" >&2 || true; fi
  docker rm -f "$container" "$caddy_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
# Public-format addresses exist only on this isolated, non-routed test network.
docker network create --internal --subnet 11.237.0.0/24 "$network" >/dev/null
# Use the exact production routing; replace only the certificate issuer with a
# local test CA, whose public root is explicitly trusted by the test client.
sed '/email {\$ACME_EMAIL}/a\  local_certs\n  skip_install_trust' Caddyfile > "$fixture_dir/Caddyfile"
docker run -d --name "$caddy_container" --network "$network" --network-alias ssh-tls --ip 11.237.0.3 \
  --read-only --tmpfs /data --tmpfs /config \
  -e VPN_DOMAIN=ssh-tls -e ACME_EMAIL=ci@example.test \
  -e NO_PROXY=ssh,api,xray,ssh-tls,localhost,127.0.0.1 \
  -e no_proxy=ssh,api,xray,ssh-tls,localhost,127.0.0.1 \
  -v "$fixture_dir/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
for ((attempt=1; attempt<=30; attempt++)); do
  if docker exec "$caddy_container" test -s /data/caddy/pki/authorities/local/root.crt; then break; fi
  sleep 1
done
docker exec "$caddy_container" cat /data/caddy/pki/authorities/local/root.crt > "$fixture_dir/root.crt"
chmod 644 "$fixture_dir/root.crt"
docker run --name "$container" --network "$network" --network-alias ssh --ip 11.237.0.2 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,noexec,size=96m \
  -v "$PWD/scripts/test-ssh-gateway.mjs:/app/scripts/test-ssh-gateway.mjs:ro" \
  -v "$fixture_dir/root.crt:/run/ssh-test-ca.crt:ro" \
  -e NODE_EXTRA_CA_CERTS=/run/ssh-test-ca.crt -e SSH_TEST_CADDY_HOST=ssh-tls \
  -e SSH_TEST_TARGET_HOST=11.237.0.2 \
  "$image" node scripts/test-ssh-gateway.mjs
