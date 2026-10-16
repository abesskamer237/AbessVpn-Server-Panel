#!/bin/sh
set -eu

CONFIG=/shared/xray-config.json
READY=/shared/xray-ready
STATS=/shared/xray-stats.json
PID_FILE=/shared/xray.pid
LAST_CHECKSUM=
CHILD_PID=
GENERATION=

stop_child() {
  if [ -n "${CHILD_PID}" ] && kill -0 "${CHILD_PID}" 2>/dev/null; then
    kill -TERM "${CHILD_PID}" 2>/dev/null || true
    wait "${CHILD_PID}" 2>/dev/null || true
  fi
  CHILD_PID=
  rm -f "$READY" "$PID_FILE"
}

shutdown() {
  stop_child
  exit 0
}
trap shutdown INT TERM

mkdir -p /shared

while :; do
  if [ ! -s "$CONFIG" ]; then
    sleep 1
    continue
  fi

  CHECKSUM="$(cksum "$CONFIG" | awk '{print $1 ":" $2}')"
  if [ "$CHECKSUM" != "$LAST_CHECKSUM" ] || [ -z "$CHILD_PID" ] || ! kill -0 "$CHILD_PID" 2>/dev/null; then
    if ! /usr/local/bin/xray run -test -c "$CONFIG"; then
      echo "[xray-watch] Invalid config; refusing to replace the last running process." >&2
      sleep 3
      continue
    fi

    rm -f "$READY"
    stop_child
    /usr/local/bin/xray run -c "$CONFIG" &
    CHILD_PID=$!
    printf '%s\n' "$CHILD_PID" > "$PID_FILE.tmp"
    mv "$PID_FILE.tmp" "$PID_FILE"
    API_READY=0
    ATTEMPT=0
    while [ "$ATTEMPT" -lt 10 ]; do
      if ! kill -0 "$CHILD_PID" 2>/dev/null; then
        break
      fi
      if SNAPSHOT="$(/usr/local/bin/xray api statsquery --server=127.0.0.1:10085 -pattern 'user>>>' 2>/dev/null)" \
        && printf '%s' "$SNAPSHOT" | jq -e 'type == "object"' >/dev/null 2>&1; then
        API_READY=1
        break
      fi
      ATTEMPT=$((ATTEMPT + 1))
      sleep 1
    done

    if [ "$API_READY" -eq 1 ] && kill -0 "$CHILD_PID" 2>/dev/null; then
      RANDOM_SUFFIX="$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      GENERATION="$(date +%s)-$$-$RANDOM_SUFFIX"
      printf '%s\n' "$GENERATION" > "$READY.tmp"
      mv "$READY.tmp" "$READY"
      LAST_CHECKSUM="$CHECKSUM"
      echo "[xray-watch] Xray-core and its local stats API are ready (generation $GENERATION)."
    else
      echo "[xray-watch] Xray-core or its local stats API failed startup; retrying." >&2
      if kill -0 "$CHILD_PID" 2>/dev/null; then
        kill -TERM "$CHILD_PID" 2>/dev/null || true
        wait "$CHILD_PID" 2>/dev/null || true
      fi
      CHILD_PID=
      LAST_CHECKSUM=
      rm -f "$READY" "$PID_FILE"
      sleep 2
      continue
    fi
  fi

  if kill -0 "$CHILD_PID" 2>/dev/null; then
    if SNAPSHOT="$(/usr/local/bin/xray api statsquery --server=127.0.0.1:10085 -pattern 'user>>>' 2>/dev/null)" \
      && printf '%s' "$SNAPSHOT" | jq -e 'type == "object"' >/dev/null 2>&1; then
      OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf '%s' "$SNAPSHOT" | jq -c --arg generation "$GENERATION" --arg observedAt "$OBSERVED_AT" \
        '{generation:$generation,observedAt:$observedAt,stat:(.stat // [])}' > "$STATS.tmp"
      mv "$STATS.tmp" "$STATS"
    fi
  fi

  sleep 3
done
