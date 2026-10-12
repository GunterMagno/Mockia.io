#!/usr/bin/env bash
# Copia de seguridad cifrada de MongoDB.
#
#   backup.sh <uri> <recipient> <out-dir>
#
# - <uri>: cadena de conexion de un usuario de SOLO LECTURA. Si incluye una base (mongodb://host/mockia) solo se
#   copia esa base; sin base se copian todas.
# - <recipient>: clave PUBLICA age del titular (age1...). La privada no esta aqui ni en GitHub.
# - <out-dir>: directorio de salida (se crea si no existe).
#
# Escribe <out-dir>/mockia-YYYYMMDD-HHMM.archive.gz.age y imprime SOLO su ruta por la salida estandar.
# Garantias: el volcado va por una tuberia directa mongodump | age y nunca existe sin cifrar en disco; la URI no se
# imprime ni aparece en los argumentos de ningun proceso (se pasa a mongodump por un fichero de configuracion 0600
# que se borra al salir); sin `set -x`.
set -euo pipefail
umask 077

if [ "$#" -ne 3 ]; then
  echo "uso: backup.sh <uri> <recipient> <out-dir>" >&2
  exit 2
fi
uri="$1"
recipient="$2"
out_dir="$3"

case "$uri" in
  mongodb://* | mongodb+srv://*) ;;
  *)
    echo "backup.sh: la URI debe empezar por mongodb:// o mongodb+srv://" >&2
    exit 2
    ;;
esac
case "$recipient" in
  AGE-SECRET-KEY-*)
    echo "backup.sh: eso es una clave PRIVADA de age; se necesita la publica (age1...). No la uses aqui." >&2
    exit 2
    ;;
  age1* | ssh-ed25519\ * | ssh-rsa\ *) ;;
  *)
    echo "backup.sh: el destinatario no parece una clave publica age (debe empezar por age1)" >&2
    exit 2
    ;;
esac
for tool in mongodump age; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "backup.sh: falta '$tool' en el PATH" >&2
    exit 1
  }
done

mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%d-%H%M)"
final="$out_dir/mockia-$stamp.archive.gz.age"
partial="$out_dir/.mockia-$stamp.partial.$$"
conf="$(mktemp)"

cleanup() {
  rm -f "$conf" "$partial"
}
trap cleanup EXIT

if [ -e "$final" ]; then
  echo "backup.sh: ya existe $final (otra copia del mismo minuto); no se sobrescribe" >&2
  exit 1
fi

# La URI va entre comillas dobles de YAML, escapando \ y ".
escaped="${uri//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
printf 'uri: "%s"\n' "$escaped" >"$conf"

echo "backup.sh: volcando y cifrando..." >&2
# pipefail: si mongodump falla, la tuberia falla y no se publica ningun fichero.
mongodump --quiet --config "$conf" --archive --gzip | age -r "$recipient" >"$partial"

# Un fichero age valido empieza por esta cabecera y un volcado real pesa mas que unos pocos bytes.
if [ "$(head -c 22 "$partial")" != "age-encryption.org/v1" ]; then
  echo "backup.sh: la salida no es un fichero age valido" >&2
  exit 1
fi
if [ "$(wc -c <"$partial" | tr -d ' ')" -lt 512 ]; then
  echo "backup.sh: la copia esta vacia o es demasiado pequena (comprueba que la URI incluye la base, p. ej. mongodb+srv://.../mockia)" >&2
  exit 1
fi

mv -n "$partial" "$final"
[ -f "$final" ] || {
  echo "backup.sh: no se pudo escribir $final" >&2
  exit 1
}
echo "backup.sh: copia cifrada creada ($(wc -c <"$final" | tr -d ' ') bytes)" >&2
printf '%s\n' "$final"
