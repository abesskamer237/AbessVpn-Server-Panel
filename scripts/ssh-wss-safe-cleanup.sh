#!/usr/bin/env bash
# Only safe, identified transient cleanup after an existing verified backup.
# Does not modify production credentials, customer data, systemd SSH or Docker volumes.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Root required' >&2; exit 1; }
command -v docker >/dev/null || exit 1
echo 'BEFORE_DOCKER_DISK_USAGE:'
docker system df
for file in /tmp/abess-ssh-ws-postdeploy.sh /tmp/abess-ssh-ws-live-smoke.mjs; do
  if [[ -f "$file" && ! -L "$file" ]]; then
    rm -f -- "$file"
    echo "REMOVED_TEMPORARY_SCRIPT=$file"
  fi
done
echo 'Removing only Docker build-cache entries older than 7 days.'
docker builder prune --force --filter 'until=168h'
echo 'AFTER_DOCKER_DISK_USAGE:'
docker system df
echo 'PRESERVED=postgresql_volumes,ssh_wss_state,admin_accounts,resellers,credits,licences,logs,backups'
