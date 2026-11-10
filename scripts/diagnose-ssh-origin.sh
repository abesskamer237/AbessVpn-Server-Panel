#!/usr/bin/env bash
# Emit only public endpoint/configuration metadata, never credentials or full env.
set -euo pipefail
cd "$HOME/abessvpn-server"
export COMPOSE_FILE="$PWD/docker-compose.yml"
command docker compose -f "$PWD/docker-compose.yml" config --format json | docker run --rm -i node:22-alpine node -e '
let text="";process.stdin.on("data",chunk=>text+=chunk).on("end",()=>{
 const config=JSON.parse(text);const env=config.services.api.environment || {};
 const safe=value=>typeof value==="string" && /^[A-Za-z0-9.-]+$/.test(value)?value:"<unset or invalid>";
 console.log("::notice::Compose public SSH origin="+safe(env.SSH_WS_HOST)+"; field-present="+Object.hasOwn(env,"SSH_WS_HOST")+"; value-type="+typeof env.SSH_WS_HOST+"; domain="+safe(env.VPN_DOMAIN)+"; node-options-present="+Boolean(env.NODE_OPTIONS));
});'
container="$(command docker compose -f "$PWD/docker-compose.yml" ps -q api)"
docker inspect "$container" --format '{{json .Config.Env}}' | docker run --rm -i node:22-alpine node -e '
let text="";process.stdin.on("data",chunk=>text+=chunk).on("end",()=>{
 const env=Object.fromEntries(JSON.parse(text).map(value=>{const n=value.indexOf("=");return[value.slice(0,n),value.slice(n+1)];}));
 const safe=value=>typeof value==="string" && /^[A-Za-z0-9.-]+$/.test(value)?value:"<unset or invalid>";
 console.log("::notice::Container public SSH origin="+safe(env.SSH_WS_HOST)+"; domain="+safe(env.VPN_DOMAIN)+"; node-options-present="+Boolean(env.NODE_OPTIONS));
});'

docker run --rm --env-file .env --env NODE_OPTIONS= node:22-alpine node -e '
const value=process.env.SSH_WS_HOST;const safe=value && /^[A-Za-z0-9.-]+$/.test(value)?value:"<unset or invalid>";
console.log("::notice::Stored public SSH origin="+safe+"; field-present="+Object.hasOwn(process.env,"SSH_WS_HOST"));'
docker inspect "$container" --format '{{json .Config.Labels}}' | docker run --rm -i node:22-alpine node -e '
let text="";process.stdin.on("data",chunk=>text+=chunk).on("end",()=>{
 const labels=JSON.parse(text);const files=(labels["com.docker.compose.project.config_files"]||"").split(",").map(value=>require("node:path").basename(value));
 console.log("::notice::Active Compose filenames="+JSON.stringify(files));
});'
