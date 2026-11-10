#!/usr/bin/env bash
# Emit only public endpoint/configuration metadata, never credentials or full env.
set -euo pipefail
cd "$HOME/abessvpn-server"
docker compose config --format json | docker run --rm -i node:22-alpine node -e '
let text="";process.stdin.on("data",chunk=>text+=chunk).on("end",()=>{
 const config=JSON.parse(text);const env=config.services.api.environment || {};
 const safe=value=>typeof value==="string" && /^[A-Za-z0-9.-]+$/.test(value)?value:"<unset or invalid>";
 console.log("::notice::Compose public SSH origin="+safe(env.SSH_WS_HOST)+"; domain="+safe(env.VPN_DOMAIN)+"; node-options-present="+Boolean(env.NODE_OPTIONS));
});'
container="$(docker compose ps -q api)"
docker inspect "$container" --format '{{json .Config.Env}}' | docker run --rm -i node:22-alpine node -e '
let text="";process.stdin.on("data",chunk=>text+=chunk).on("end",()=>{
 const env=Object.fromEntries(JSON.parse(text).map(value=>{const n=value.indexOf("=");return[value.slice(0,n),value.slice(n+1)];}));
 const safe=value=>typeof value==="string" && /^[A-Za-z0-9.-]+$/.test(value)?value:"<unset or invalid>";
 console.log("::notice::Container public SSH origin="+safe(env.SSH_WS_HOST)+"; domain="+safe(env.VPN_DOMAIN)+"; node-options-present="+Boolean(env.NODE_OPTIONS));
});'
