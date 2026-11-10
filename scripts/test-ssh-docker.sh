#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
image="${SSH_TEST_IMAGE:-abessvpn-api:ci}"
network="abess-ssh-test-$$"
container="abess-ssh-test-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Public-format test addresses exist ONLY on this isolated, non-routed network.
# No production private-network exception or destination override is introduced.
docker network create --internal --subnet 11.237.0.0/24 "$network" >/dev/null
docker run --name "$container" --network "$network" --ip 11.237.0.2 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,noexec,size=96m \
  -e SSH_TEST_TARGET_HOST=11.237.0.2 \
  "$image" node scripts/test-ssh-gateway.mjs
