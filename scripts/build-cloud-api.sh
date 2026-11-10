#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
cloud_dockerfile="$(mktemp /tmp/abess-cloud-Dockerfile.XXXXXX)"
trap 'rm -f "$cloud_dockerfile"' EXIT
python - "$cloud_dockerfile" <<'PY'
from pathlib import Path
import sys
source = Path('Dockerfile').read_text()
assert 'RUN npm ci' in source
Path(sys.argv[1]).write_text(source.replace('RUN npm ci', 'RUN --mount=type=secret,id=proxy_ca,required=true NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --fetch-retries=0'))
PY
docker build --secret "id=proxy_ca,src=${CODEX_PROXY_CERT:-/etc/ssl/certs/ca-certificates.crt}" -f "$cloud_dockerfile" -t abessvpn-api:audit .
