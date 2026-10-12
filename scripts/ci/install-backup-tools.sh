#!/usr/bin/env bash
# Instala en un runner de GitHub (Ubuntu) las herramientas de las copias: age y mongodb-database-tools
# (mongodump / mongorestore). Sin dependencias nuevas del repositorio.
# La CLI de MongoDB viene del repositorio apt oficial, verificado con la clave GPG de MongoDB.
set -euo pipefail

. /etc/os-release
case "${VERSION_CODENAME:-}" in
  jammy | noble) ;;
  *)
    echo "install-backup-tools.sh: Ubuntu '${VERSION_CODENAME:-desconocido}' no soportado (jammy o noble)" >&2
    exit 1
    ;;
esac

sudo apt-get update -qq
sudo apt-get install -y -qq age curl gnupg ca-certificates

curl -fsSL https://pgp.mongodb.com/server-8.0.asc |
  sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${VERSION_CODENAME}/mongodb-org/8.0 multiverse" |
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq mongodb-database-tools

age --version
mongodump --version | head -1
