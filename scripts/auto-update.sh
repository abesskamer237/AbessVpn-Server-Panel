#!/usr/bin/env bash
# ==============================================================================
# ABESS VPN — SCRIPT DE MISE À JOUR AUTOMATIQUE DU SERVEUR
# Ce script vérifie le dépôt Git origin/main, applique les mises à jour,
# recompile l'application et redémarre les services sans coupure de données.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

LOG_TAG="[ABESS-AUTO-UPDATE]"
echo "$LOG_TAG Vérification des mises à jour du serveur..."

if [ ! -d ".git" ]; then
  echo "$LOG_TAG Erreur : Ce répertoire n'est pas un dépôt Git. Mise à jour automatique impossible." >&2
  exit 1
fi

# Récupérer les derniers commits distants
git fetch origin main --quiet

LOCAL_COMMIT="$(git rev-parse --short HEAD)"
REMOTE_COMMIT="$(git rev-parse --short origin/main)"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  echo "$LOG_TAG Le serveur est déjà sur la version la plus récente (Commit: $LOCAL_COMMIT)."
  exit 0
fi

echo "$LOG_TAG Nouvelle version détectée : $LOCAL_COMMIT -> $REMOTE_COMMIT"
echo "$LOG_TAG Application de la mise à jour..."

# Sauvegarde préventive de la configuration
if [ -d "data" ]; then
  mkdir -p data/backups
  cp -r data/*.json data/backups/ 2>/dev/null || true
fi

# Récupération des modifications
git pull origin main

# Si package.json a changé, installer les dépendances
if git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" | grep -q "package.json"; then
  echo "$LOG_TAG Dépendances modifiées, exécution de npm install..."
  npm install --omit=dev --no-audit --no-fund
fi

# Si le frontend a changé, recompiler
if git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" | grep -q -E "src/|index.html|vite.config"; then
  echo "$LOG_TAG Frontend modifié, exécution de npm run build..."
  npm run build
fi

# Si Docker Compose est utilisé sur la machine
if command -v docker >/dev/null 2>&1 && [ -f "docker-compose.yml" ] && docker compose ps >/dev/null 2>&1; then
  echo "$LOG_TAG Redémarrage des conteneurs Docker..."
  docker compose build --no-cache api
  docker compose up -d
elif systemctl is-active --quiet abessvpn-server 2>/dev/null; then
  echo "$LOG_TAG Redémarrage du service systemd abessvpn-server..."
  systemctl restart abessvpn-server
fi

# Test de santé final
sleep 3
if curl -sf http://127.0.0.1:3000/api/v1/ping >/dev/null 2>&1; then
  echo "$LOG_TAG ✅ Serveur mis à jour avec succès vers la version $REMOTE_COMMIT et opérationnel !"
else
  echo "$LOG_TAG ⚠️ Le serveur a été mis à jour mais le test de santé local /api/v1/ping a échoué. Vérifiez les logs." >&2
fi
