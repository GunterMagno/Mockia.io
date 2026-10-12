#!/usr/bin/env bash
# Simulacro de restauracion: demuestra que una copia cifrada se puede recuperar.
#
# Es el test de backup.sh y restore.sh. Con una pareja de claves age TEMPORAL y una BD sembrada:
#   1. backup.sh genera el fichero cifrado.
#   2. El fichero es de age y no contiene ningun texto en claro sembrado (y se comprueba, con un volcado de
#      control, que el texto SI estaria en claro en un volcado sin cifrar: el test no puede pasar en vacio).
#   3. Con otra clave privada no se descifra, ni con age ni con restore.sh (y restore.sh no crea nada).
#   4. Con la clave correcta, restore.sh restaura en OTRA base y coinciden, coleccion a coleccion, el numero
#      de documentos, un hash del contenido y los indices.
#
# Uso:  DRILL_MONGO_URI=mongodb://localhost:27017 bash scripts/ci/backup-drill.sh
# Necesita: age, age-keygen, mongodump, mongorestore y node (con las dependencias del repositorio instaladas).
# Solo crea y borra bases llamadas mockia_drill_*. No imprime la URI ni ningun contenido sembrado.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mongo_base="${DRILL_MONGO_URI:-mongodb://localhost:27017}"
mongo_base="${mongo_base%/}"

fail() {
  echo "drill FALLA: $*" >&2
  exit 1
}
step() { echo "drill: $*"; }

for tool in age age-keygen mongodump mongorestore node; do
  command -v "$tool" >/dev/null 2>&1 || fail "falta la herramienta '$tool' en el PATH"
done
for script in backup.sh restore.sh backup-drill-db.mjs; do
  [ -f "$here/$script" ] || fail "falta scripts/ci/$script"
done

suffix="$(node -e "process.stdout.write(require('node:crypto').randomBytes(5).toString('hex'))")"
src_db="mockia_drill_src_$suffix"
dst_db="mockia_drill_dst_$suffix"
marker="DRILL_PLAINTEXT_$(node -e "process.stdout.write(require('node:crypto').randomBytes(8).toString('hex'))")"
work="$(mktemp -d)"

cleanup() {
  status=$?
  node "$here/backup-drill-db.mjs" drop "$mongo_base" "$src_db" >/dev/null 2>&1 || true
  node "$here/backup-drill-db.mjs" drop "$mongo_base" "$dst_db" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

db() { node "$here/backup-drill-db.mjs" "$@"; }

step "generando dos parejas de claves age temporales"
age-keygen -o "$work/good.key" >/dev/null 2>&1
age-keygen -o "$work/wrong.key" >/dev/null 2>&1
good_recipient="$(age-keygen -y "$work/good.key")"

step "sembrando la BD de origen ($src_db)"
db seed "$mongo_base" "$src_db" "$marker"
db digest "$mongo_base" "$src_db" >"$work/src.json"
grep -q '"users"' "$work/src.json" || fail "la siembra no creo la coleccion users"

step "control: un volcado SIN cifrar contiene el texto sembrado (si no, la comprobacion siguiente no probaria nada)"
control="$(
  { mongodump --quiet --uri "$mongo_base/$src_db" --archive | grep -acF -- "$marker"; } || true
)"
[ "${control:-0}" -ge 1 ] || fail "el volcado de control no contiene el marcador: el test seria vacuo"

step "backup.sh"
mkdir "$work/out"
file="$(bash "$here/backup.sh" "$mongo_base/$src_db" "$good_recipient" "$work/out")"
[ -f "$file" ] || fail "backup.sh no produjo el fichero indicado"
case "$(basename "$file")" in
  mockia-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9].archive.gz.age) ;;
  *) fail "nombre de fichero inesperado: $(basename "$file")" ;;
esac
[ "$(find "$work/out" -type f | wc -l | tr -d ' ')" = "1" ] || fail "en el directorio de salida debe quedar solo el fichero cifrado"
[ "$(head -c 22 "$file")" = "age-encryption.org/v1" ] || fail "el fichero no es un fichero age"
[ "$(wc -c <"$file" | tr -d ' ')" -gt 2000 ] || fail "el fichero cifrado es sospechosamente pequeno"

step "el fichero cifrado no contiene texto en claro sembrado"
if grep -aqF -- "$marker" "$file"; then
  fail "el fichero cifrado contiene texto en claro del marcador"
fi
if grep -aqF -- "Usuario " "$file" || grep -aqF -- "example.test" "$file"; then
  fail "el fichero cifrado contiene texto en claro de los documentos"
fi

step "con otra clave privada no se descifra"
if age -d -i "$work/wrong.key" "$file" >/dev/null 2>&1; then
  fail "age descifro con una clave que no es la del destinatario"
fi
if bash "$here/restore.sh" "$file" "$work/wrong.key" "$mongo_base" >/dev/null 2>&1; then
  fail "restore.sh restauro con una clave que no es la del destinatario"
fi
[ "$(db digest "$mongo_base" "$dst_db")" = "{}" ] || fail "una restauracion fallida dejo datos en la BD de destino"

step "restore.sh con la clave correcta en otra BD ($dst_db)"
NS_INCLUDE="$src_db.*" NS_FROM="$src_db.*" NS_TO="$dst_db.*" \
  bash "$here/restore.sh" "$file" "$work/good.key" "$mongo_base"
db digest "$mongo_base" "$dst_db" >"$work/dst.json"

step "comparando documentos, hash e indices por coleccion"
if ! cmp -s "$work/src.json" "$work/dst.json"; then
  diff "$work/src.json" "$work/dst.json" | grep -v -F -- "$marker" | head -40 >&2 || true
  fail "la BD restaurada no coincide con la original"
fi
node -e '
  const d = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  for (const [name, v] of Object.entries(d)) console.log(`  ${name}: ${v.count} documentos, sha256 ${v.sha256.slice(0, 12)}…, ${v.indexes.length} indices`);
' "$work/dst.json"

echo "drill OK"
