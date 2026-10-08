#!/bin/sh
# Descarga un modelo en el contenedor `llm` (Ollama) y lo calienta con una generacion minima, para que el primer
# usuario real no pague la carga del modelo en memoria.
#
# Uso:    scripts/pull-model.sh <modelo>        p. ej. scripts/pull-model.sh qwen2.5-coder:7b-instruct
# Entorno (todo opcional):
#   COMPOSE_FILES     ficheros de compose separados por espacios.
#                     Por defecto: "docker-compose.prod.yml docker-compose.ai.yml"
#                     Desarrollo:  COMPOSE_FILES="docker-compose.yml docker-compose.ai.yml"
#                     Con GPU:     anade docker-compose.ai.gpu.yml
#   COMPOSE_ENV_FILE  fichero .env a pasar a compose (--env-file). Por defecto el .env del directorio actual.
#   SKIP_WARMUP=1     descarga el modelo pero no lo calienta.
#
# Requisitos: el servicio `llm` ya arrancado (docker compose ... up -d llm). Con vLLM no hace falta este script: vLLM
# descarga el modelo al arrancar. No lee ni imprime secretos.
set -eu

usage() {
  echo "Uso: $0 <modelo>   (p. ej. qwen2.5-coder:7b-instruct)" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi
model=$1

# Nombre de modelo de Ollama: letras, digitos y . _ : / @ -  ; no puede empezar por guion ni por punto (evita que se
# interprete como opcion o ruta) ni contener espacios, comillas, $ o caracteres de shell.
case "$model" in
  '' | -* | .* | */.. | *..* | *[!A-Za-z0-9._:/@-]*)
    echo "Error: nombre de modelo no valido: '$model'" >&2
    usage
    exit 2
    ;;
esac

compose_files=${COMPOSE_FILES:-"docker-compose.prod.yml docker-compose.ai.yml"}

# Construye "docker compose [--env-file X] -f A -f B" en los parametros posicionales (sin eval).
set --
if [ -n "${COMPOSE_ENV_FILE:-}" ]; then
  set -- "$@" --env-file "$COMPOSE_ENV_FILE"
fi
for f in $compose_files; do
  set -- "$@" -f "$f"
done
if [ "$#" -eq 0 ] || { [ "$#" -eq 2 ] && [ "${1:-}" = "--env-file" ]; }; then
  echo "Error: COMPOSE_FILES esta vacio" >&2
  exit 2
fi

if [ -z "$(docker compose "$@" ps -q llm 2>/dev/null || true)" ]; then
  echo "Error: el servicio llm no esta en marcha. Arrancalo antes con:" >&2
  echo "  docker compose $compose_files up -d llm" >&2
  exit 1
fi

echo "Descargando el modelo $model (puede tardar y ocupa varios GB en el volumen ollama_models)..."
if ! docker compose "$@" exec -T llm ollama pull "$model"; then
  echo "Error: 'ollama pull $model' ha fallado (nombre inexistente, sin red o disco lleno)." >&2
  echo "Comprueba el nombre en https://ollama.com/library y el espacio con 'docker system df -v'." >&2
  exit 1
fi

if [ "${SKIP_WARMUP:-0}" = "1" ]; then
  echo "Modelo descargado. Calentamiento omitido (SKIP_WARMUP=1)."
  exit 0
fi

echo "Calentando el modelo (carga en memoria; OLLAMA_KEEP_ALIVE lo mantiene cargado)..."
if ! docker compose "$@" exec -T llm ollama run "$model" "Responde solo: ok" > /dev/null; then
  echo "Aviso: el modelo se descargo pero el calentamiento fallo (memoria insuficiente?). Revisa 'docker compose logs llm'." >&2
  exit 1
fi

echo "Listo: $model descargado y cargado. Pon AI_LOCAL_MODEL=$model en tu .env si no es el valor actual."
