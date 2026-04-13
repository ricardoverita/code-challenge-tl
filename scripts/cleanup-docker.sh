#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
CORE_COMPOSE_FILE="docker-compose.yml"
COUNTRY_COMPOSE_FILE="docker-compose.country.yml"
CORE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"

CORE_SERVICES=(
  "yape-postgres"
  "yape-kafka"
  "yape-kafka-ui"
  "yape-topic-init"
  "yape-payment-api"
  "yape-outbox-relay"
  "yape-fraud-consumer"
  "yape-visual-demo"
)

log() {
  printf '[cleanup] %s\n' "$*"
}

warn() {
  printf '[cleanup][warn] %s\n' "$*" >&2
}

error() {
  printf '[cleanup][error] %s\n' "$*" >&2
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    error "docker no está disponible en PATH."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    error "docker compose no está disponible."
    exit 1
  fi
}

project_has_resources() {
  local project="$1"

  if docker ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.ID}}' | grep -q '.'; then
    return 0
  fi

  if docker volume ls --filter "label=com.docker.compose.project=${project}" --format '{{.Name}}' | grep -q '.'; then
    return 0
  fi

  if docker network ls --filter "label=com.docker.compose.project=${project}" --format '{{.Name}}' | grep -q '.'; then
    return 0
  fi

  return 1
}

normalize_countries() {
  local raw="$1"
  echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ' | sed -E 's/,+/,/g; s/^,+//; s/,+$//'
}

get_supported_countries() {
  local countries=""

  if [[ -f "$ENV_FILE" ]]; then
    countries="$(grep -E '^[[:space:]]*SUPPORTED_COUNTRIES=' "$ENV_FILE" | head -n 1 | cut -d '=' -f 2- || true)"
  fi

  countries="$(normalize_countries "${countries:-}")"

  if [[ -z "$countries" ]]; then
    countries="pe,mx"
  fi

  printf '%s' "$countries"
}

collect_country_codes() {
  local supported_csv="$1"
  local country
  declare -A uniq=()

  IFS=',' read -ra from_env <<< "$supported_csv"
  for country in "${from_env[@]}"; do
    [[ -n "$country" ]] && uniq["$country"]=1
  done

  while IFS= read -r file; do
    country="${file##*.env.}"
    if [[ "$country" =~ ^[a-z]{2}$ ]]; then
      uniq["$country"]=1
    fi
  done < <(find "$ROOT_DIR" -maxdepth 1 -type f -name '.env.*' ! -name '.env.example' ! -name '.env.country.example' | sort)

  local out=()
  for country in "${!uniq[@]}"; do
    out+=("$country")
  done

  if ((${#out[@]} > 0)); then
    printf '%s\n' "${out[@]}" | sort
  fi
}

list_container_candidates() {
  log "Contenedores de este proyecto detectados:"

  for c in "${CORE_SERVICES[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$c"; then
      echo "  - $c"
    fi
  done

  local country
  while IFS= read -r country; do
    [[ -z "$country" ]] && continue
    local project="yape-${country}"

    while IFS= read -r name; do
      [[ -n "$name" ]] && echo "  - $name"
    done < <(docker ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.Names}}')
  done < <(collect_country_codes "$(get_supported_countries)")
}

list_resource_candidates() {
  log "Recursos potenciales del proyecto:"

  echo "  Redes:"
  while IFS= read -r network; do
    [[ -n "$network" ]] && echo "    - $network"
  done < <(docker network ls --format '{{.Name}}' | grep -E '^(yape-shared|yape-[a-z]{2}_default|yape-challenge_default)$' || true)

  echo "  Volúmenes (labels compose):"
  while IFS= read -r volume; do
    [[ -n "$volume" ]] && echo "    - $volume"
  done < <(docker volume ls --filter 'label=com.docker.compose.project' --format '{{.Name}}' | grep -E '(yape|yape-challenge|yape-[a-z]{2})' || true)

  echo "  Imágenes locales candidatas (built por compose):"
  while IFS= read -r image; do
    [[ -n "$image" ]] && echo "    - $image"
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '(yape|yape-challenge)' || true)
}

down_country_projects() {
  local country

  while IFS= read -r country; do
    [[ -z "$country" ]] && continue
    local project="yape-${country}"

    if ! project_has_resources "$project"; then
      log "Proyecto país ${project} sin recursos activos. Se omite."
      continue
    fi

    log "Bajando proyecto país ${project}..."

    if [[ -f "$ENV_FILE" ]]; then
      COUNTRY_CODE="$country" docker compose -p "$project" \
        -f "$COUNTRY_COMPOSE_FILE" \
        --env-file "$ENV_FILE" \
        down -v --remove-orphans || true
    else
      COUNTRY_CODE="$country" docker compose -p "$project" \
        -f "$COUNTRY_COMPOSE_FILE" \
        down -v --remove-orphans || true
    fi
  done < <(collect_country_codes "$(get_supported_countries)")
}

down_core_project() {
  if [[ ! -f "$CORE_COMPOSE_FILE" ]]; then
    warn "No se encontró ${CORE_COMPOSE_FILE}; se omite limpieza core por compose."
    return
  fi

  if ! project_has_resources "$CORE_PROJECT_NAME"; then
    log "Proyecto core ${CORE_PROJECT_NAME} sin recursos activos. Se omite."
    return
  fi

  log "Bajando stack core del proyecto..."

  if [[ -f "$ENV_FILE" ]]; then
    docker compose -p "$CORE_PROJECT_NAME" -f "$CORE_COMPOSE_FILE" --env-file "$ENV_FILE" --profile all down -v --remove-orphans --rmi local || true
  else
    docker compose -p "$CORE_PROJECT_NAME" -f "$CORE_COMPOSE_FILE" --profile all down -v --remove-orphans --rmi local || true
  fi
}

remove_leftover_project_containers() {
  log "Eliminando contenedores huérfanos del proyecto (si existen)..."

  local ids=""

  ids="$(docker ps -a --filter "label=com.docker.compose.project=${CORE_PROJECT_NAME}" --format '{{.ID}}')"
  if [[ -n "$ids" ]]; then
    echo "$ids" | xargs docker rm -f >/dev/null 2>&1 || true
  fi

  for c in "${CORE_SERVICES[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$c"; then
      docker rm -f "$c" >/dev/null 2>&1 || true
    fi
  done

  local country
  while IFS= read -r country; do
    [[ -z "$country" ]] && continue
    local project="yape-${country}"
    ids="$(docker ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.ID}}')"
    if [[ -n "$ids" ]]; then
      echo "$ids" | xargs docker rm -f >/dev/null 2>&1 || true
    fi
  done < <(collect_country_codes "$(get_supported_countries)")
}

remove_leftover_project_images() {
  log "Eliminando imágenes locales del proyecto (si existen)..."

  local image
  while IFS= read -r image; do
    [[ -n "$image" ]] && docker image rm -f "$image" >/dev/null 2>&1 || true
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^${CORE_PROJECT_NAME}-(payment-api|outbox-relay|fraud-consumer|visual-demo):" || true)

  local country
  while IFS= read -r country; do
    [[ -z "$country" ]] && continue
    while IFS= read -r image; do
      [[ -n "$image" ]] && docker image rm -f "$image" >/dev/null 2>&1 || true
    done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^yape-${country}-(ledger-consumer|status-saga):" || true)
  done < <(collect_country_codes "$(get_supported_countries)")
}

remove_shared_network_if_unused() {
  if ! docker network inspect yape-shared >/dev/null 2>&1; then
    return
  fi

  local attached
  attached="$(docker network inspect yape-shared --format '{{len .Containers}}' 2>/dev/null || echo "0")"

  if [[ "$attached" == "0" ]]; then
    log "Eliminando red yape-shared (sin contenedores conectados)..."
    docker network rm yape-shared >/dev/null 2>&1 || true
  else
    warn "No se elimina yape-shared porque tiene ${attached} contenedor(es) conectado(s)."
  fi
}

main() {
  require_docker

  echo ""
  echo "Este script está a punto de borrar recursos Docker del proyecto local yape-challenge:"
  echo "- Contenedores (core y por país)"
  echo "- Redes de compose del proyecto"
  echo "- Volúmenes de compose del proyecto"
  echo "- Imágenes locales construidas por compose del proyecto"
  echo ""

  list_container_candidates
  list_resource_candidates

  echo ""
  echo "Escribe CONFIRM para ejecutar el borrado."
  read -r -p "> " confirm

  if [[ "$confirm" != "CONFIRM" ]]; then
    log "Operación cancelada. No se eliminó nada."
    exit 0
  fi

  down_country_projects
  down_core_project
  remove_leftover_project_containers
  remove_leftover_project_images
  remove_shared_network_if_unused

  log "Limpieza completada."
}

main "$@"
