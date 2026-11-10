#!/usr/bin/env bash
# Install missing deployment prerequisites on Debian/Ubuntu; never restart an existing Docker service.
set -euo pipefail
fail() { echo "::error::$*" >&2; exit 1; }
privileged=()
need_docker=0
command -v docker >/dev/null 2>&1 || need_docker=1
missing=()
for pair in 'curl:curl' 'rsync:rsync' 'ss:iproute2' 'gpg:gnupg'; do
  command -v "${pair%%:*}" >/dev/null 2>&1 || missing+=("${pair#*:}")
done
if [ "$need_docker" -eq 1 ] || [ "${#missing[@]}" -gt 0 ] || ! docker compose version >/dev/null 2>&1; then
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null && sudo -n true 2>/dev/null || fail 'VPS bootstrap requires root or passwordless sudo for package installation.'
    privileged=(sudo -n)
  fi
fi
if [ "$need_docker" -eq 1 ] || [ "${#missing[@]}" -gt 0 ]; then
  [ -f /etc/os-release ] || fail 'Unsupported VPS OS; install Docker Engine, Compose, curl, rsync and iproute2 manually.'
  . /etc/os-release
  case "$ID" in debian|ubuntu) ;; *) fail 'Automatic prerequisites support Debian and Ubuntu only.' ;; esac
  "${privileged[@]}" apt-get update
  "${privileged[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates "${missing[@]}"
fi
if [ "$need_docker" -eq 1 ]; then
  "${privileged[@]}" install -m 0755 -d /etc/apt/keyrings
  key_file="$(mktemp)"
  trap 'rm -f "$key_file"' EXIT
  curl --fail --silent --show-error --location "https://download.docker.com/linux/$ID/gpg" -o "$key_file"
  gpg --show-keys "$key_file" >/dev/null
  "${privileged[@]}" install -m 0644 "$key_file" /etc/apt/keyrings/abess-docker.asc
  rm -f "$key_file"
  arch="$(dpkg --print-architecture)"
  codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [ -n "$codename" ] || fail 'Cannot determine the VPS distribution codename.'
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/abess-docker.asc] https://download.docker.com/linux/%s %s stable\n' "$arch" "$ID" "$codename" | "${privileged[@]}" tee /etc/apt/sources.list.d/abess-docker.list >/dev/null
  "${privileged[@]}" apt-get update
  "${privileged[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl >/dev/null 2>&1; then
    "${privileged[@]}" systemctl enable --now docker
  fi
fi
if ! docker compose version >/dev/null 2>&1; then
  # Existing engines retain their packages and services. Add only the missing CLI plugin.
  compose_version=v2.39.4
  case "$(uname -m)" in x86_64|aarch64|armv7l) arch="$(uname -m)" ;; *) fail 'Unsupported Compose CPU architecture.' ;; esac
  compose_tmp="$(mktemp -d)"
  trap 'rm -rf "$compose_tmp"' EXIT
  asset="docker-compose-linux-$arch"
  curl --fail --silent --show-error --location "https://github.com/docker/compose/releases/download/$compose_version/$asset" -o "$compose_tmp/$asset"
  curl --fail --silent --show-error --location "https://github.com/docker/compose/releases/download/$compose_version/checksums.txt" -o "$compose_tmp/checksums.txt"
  (cd "$compose_tmp"; awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print }' checksums.txt > selected.sha256; test -s selected.sha256; sha256sum -c selected.sha256)
  "${privileged[@]}" install -d -m 0755 /usr/local/lib/docker/cli-plugins
  "${privileged[@]}" install -m 0755 "$compose_tmp/$asset" /usr/local/lib/docker/cli-plugins/docker-compose
  rm -rf "$compose_tmp"
fi
# Do not broaden socket permissions or alter existing users' group membership.
docker info >/dev/null 2>&1 || fail 'Docker is installed, but the SSH user cannot access its daemon. Use a root SSH account or configure Docker access for this user on the VPS.'
docker compose version
echo 'VPS deployment prerequisites are ready.'
