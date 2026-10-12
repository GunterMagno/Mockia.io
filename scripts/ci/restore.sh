#!/usr/bin/env bash
# Restaura una copia cifrada creada por backup.sh.
#
#   restore.sh <file.age> <identity-file> <uri>
#
# - <file.age>: copia mockia-YYYYMMDD-HHMM.archive.gz.age.
# - <identity-file>: fichero con la clave PRIVADA age (la que genero `age-keygen`). Solo en tu equipo.
# - <uri>: servidor de destino. Si incluye una base de datos se ignora (mongorestore no la admite junto a
#   --nsInclude): se elige con NS_INCLUDE / NS_FROM / NS_TO.
#
# Variables opcionales (todas por defecto prudentes):
#   NS_INCLUDE   espacios de nombres a restaurar (--nsInclude), p. ej. 'mockia.*'; sin definir se restaura todo lo de la copia
#   NS_FROM, NS_TO   renombran al restaurar (p. ej. NS_FROM='mockia.*' NS_TO='mockia_copia.*'); van juntos
#   RESTORE_DROP=1   borra cada coleccion del destino antes de restaurarla (por defecto NO: no pisa nada)
#
# El texto descifrado viaja por una tuberia directa age | mongorestore y nunca se escribe en disco. La URI no se
# imprime ni aparece en los argumentos (va por un fichero de configuracion 0600 que se borra al salir).
set -euo pipefail
umask 077

if [ "$#" -ne 3 ]; then
  echo "uso: restore.sh <file.age> <identity-file> <uri>" >&2
  exit 2
fi
file="$1"
identity="$2"
uri="$3"

[ -f "$file" ] || {
  echo "restore.sh: no existe el fichero $file" >&2
  exit 2
}
[ -f "$identity" ] || {
  echo "restore.sh: no existe el fichero de identidad $identity" >&2
  exit 2
}
case "$uri" in
  mongodb://* | mongodb+srv://*) ;;
  *)
    echo "restore.sh: la URI debe empezar por mongodb:// o mongodb+srv://" >&2
    exit 2
    ;;
esac
for tool in mongorestore age; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "restore.sh: falta '$tool' en el PATH" >&2
    exit 1
  }
done
if [ -n "${NS_FROM:-}" ] || [ -n "${NS_TO:-}" ]; then
  if [ -z "${NS_FROM:-}" ] || [ -z "${NS_TO:-}" ]; then
    echo "restore.sh: NS_FROM y NS_TO van juntos" >&2
    exit 2
  fi
fi

# Quita la base de datos de la URI (lo que hay entre la '/' tras el host y la '?'), conservando las opciones.
uri="$(printf '%s' "$uri" | sed -E 's#^(mongodb(\+srv)?://[^/?]*)/[^?]*#\1/#')"

conf="$(mktemp)"
cleanup() {
  rm -f "$conf"
}
trap cleanup EXIT
escaped="${uri//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
printf 'uri: "%s"\n' "$escaped" >"$conf"

args=(--quiet --config "$conf" --archive --gzip)
# Sin NS_INCLUDE se restaura todo lo que haya en la copia (mongorestore sin filtro); con el, solo esos espacios.
if [ -n "${NS_INCLUDE:-}" ]; then
  args+=(--nsInclude "$NS_INCLUDE")
fi
if [ -n "${NS_FROM:-}" ]; then
  args+=(--nsFrom "$NS_FROM" --nsTo "$NS_TO")
fi
if [ "${RESTORE_DROP:-0}" = "1" ]; then
  args+=(--drop)
fi

echo "restore.sh: descifrando y restaurando (${NS_INCLUDE:-todo})..." >&2
# Si age no puede descifrar (clave equivocada), la tuberia falla (pipefail) y mongorestore no recibe nada util.
age -d -i "$identity" "$file" | mongorestore "${args[@]}"
echo "restore.sh: restauracion terminada" >&2
