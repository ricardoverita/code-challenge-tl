#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"
COUNTRY_TEMPLATE=".env.country.example"
COUNTRY_COMPOSE_FILE="docker-compose.country.yml"
CORE_COMPOSE_FILE="docker-compose.yml"

log() {
  printf '[country] %s\n' "$*"
}

error() {
  printf '[country][error] %s\n' "$*" >&2
}

ask_yes_no() {
  local question="$1"
  local default_answer="$2"

  while true; do
    local suffix="[y/N]"
    if [[ "$default_answer" == "y" ]]; then
      suffix="[Y/n]"
    fi

    read -r -p "$question $suffix: " reply
    reply="${reply:-$default_answer}"

    case "$reply" in
      y|Y|yes|YES)
        return 0
        ;;
      n|N|no|NO)
        return 1
        ;;
      *)
        echo "Please answer y or n."
        ;;
    esac
  done
}

normalize_country() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' '
}

validate_country() {
  local country="$1"
  [[ "$country" =~ ^[a-z]{2}$ ]]
}

default_currency_for_country() {
  case "$1" in
    pe) echo "PEN" ;;
    mx) echo "MXN" ;;
    co) echo "COP" ;;
    cl) echo "CLP" ;;
    ar) echo "ARS" ;;
    br) echo "BRL" ;;
    ec) echo "USD" ;;
    *) echo "$(echo "$1" | tr '[:lower:]' '[:upper:]')" ;;
  esac
}

validate_currency() {
  local currency="$1"
  [[ "$currency" =~ ^[A-Z]{3}$ ]]
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    error "No existe ${ENV_FILE} ni ${ENV_EXAMPLE}."
    exit 1
  fi

  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log "Se creó ${ENV_FILE} desde ${ENV_EXAMPLE}."
}

get_env_var() {
  local key="$1"
  grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | head -n 1 | cut -d '=' -f 2- || true
}

set_env_var() {
  local key="$1"
  local value="$2"
  local tmp

  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      if (!updated) {
        print key "=" value
        updated = 1
      }
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

get_env_var_from_file() {
  local file="$1"
  local key="$2"
  grep -E "^[[:space:]]*${key}=" "$file" | head -n 1 | cut -d '=' -f 2- || true
}

set_env_var_in_file() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp

  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      if (!updated) {
        print key "=" value
        updated = 1
      }
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

ask_country_currency() {
  local country="$1"
  local country_env_file="$2"
  local current current_country default_currency input

  current="$(get_env_var_from_file "$country_env_file" "COUNTRY_CURRENCY")"
  current_country="$(get_env_var_from_file "$country_env_file" "COUNTRY_CODE")"
  if [[ "$current_country" == "$country" && -n "$current" ]]; then
    default_currency="$current"
  else
    default_currency="$(default_currency_for_country "$country")"
  fi

  while true; do
    read -r -p "Moneda para ${country} (ISO 4217, ejemplo: PEN, MXN, COP) [default: ${default_currency}]: " input
    input="${input:-$default_currency}"
    input="$(echo "$input" | tr '[:lower:]' '[:upper:]' | tr -d ' ')"

    if validate_currency "$input"; then
      printf '%s' "$input"
      return
    fi

    echo "La moneda debe tener exactamente 3 letras (ejemplo: PEN)." >&2
  done
}

append_country_to_supported() {
  local country="$1"
  local current
  current="$(get_env_var "SUPPORTED_COUNTRIES")"
  current="${current:-pe,mx}"
  current="$(echo "$current" | tr '[:upper:]' '[:lower:]' | tr -d ' ' | sed -E 's/,+/,/g; s/^,+//; s/,+$//')"

  if echo ",$current," | grep -q ",$country,"; then
    log "${country} ya está en SUPPORTED_COUNTRIES (${current})."
    return
  fi

  local updated
  if [[ -z "$current" ]]; then
    updated="$country"
  else
    updated="${current},${country}"
  fi

  set_env_var "SUPPORTED_COUNTRIES" "$updated"
  log "Se actualizó SUPPORTED_COUNTRIES=${updated}."
}

prepare_country_env_file() {
  local country="$1"
  local currency="$2"
  local country_env_file=".env.${country}"

  if [[ ! -f "$country_env_file" ]]; then
    if [[ -f "$COUNTRY_TEMPLATE" ]]; then
      cp "$COUNTRY_TEMPLATE" "$country_env_file"
    else
      printf 'COUNTRY_CODE=%s\n' "$country" > "$country_env_file"
    fi
    log "Se creó ${country_env_file}."
  fi

  set_env_var_in_file "$country_env_file" "COUNTRY_CODE" "$country"
  set_env_var_in_file "$country_env_file" "COUNTRY_CURRENCY" "$currency"

  log "Se configuró COUNTRY_CODE=${country} y COUNTRY_CURRENCY=${currency} en ${country_env_file}."
}

ensure_docker_available() {
  if ! command -v docker >/dev/null 2>&1; then
    error "docker no está disponible en PATH."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    error "docker compose no está disponible."
    exit 1
  fi
}

ensure_topics_for_country() {
  local country="$1"

  if [[ ! -f "$CORE_COMPOSE_FILE" ]]; then
    error "No existe ${CORE_COMPOSE_FILE}. No puedo inicializar topics."
    exit 1
  fi

  log "Inicializando topics Kafka para ${country} (idempotente)..."

  if ! docker ps --format '{{.Names}}' | grep -Fxq "yape-kafka"; then
    if ask_yes_no "Kafka no está corriendo. ¿Levantar servicio kafka del core ahora?" "y"; then
      docker compose --env-file "$ENV_FILE" --profile core up -d kafka
    else
      error "No se puede inicializar topics sin Kafka activo."
      exit 1
    fi
  fi

  SUPPORTED_COUNTRIES="$country" docker compose \
    --env-file "$ENV_FILE" \
    run --rm --no-deps topic-init
}

start_country_services() {
  local country="$1"
  local project="yape-${country}"
  local country_env_file=".env.${country}"

  if [[ ! -f "$COUNTRY_COMPOSE_FILE" ]]; then
    error "No existe ${COUNTRY_COMPOSE_FILE}."
    exit 1
  fi

  log "Levantando servicios aislados para ${country} en proyecto ${project}..."
  docker compose -p "$project" \
    -f "$COUNTRY_COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    --env-file "$country_env_file" \
    --profile country \
    up -d --build
}

main() {
  ensure_docker_available
  ensure_env_file

  local country_input="${1:-}"
  if [[ -z "$country_input" ]]; then
    read -r -p "Código de país (2 letras, ejemplo: pe, mx, co): " country_input
  fi

  local country
  country="$(normalize_country "$country_input")"

  if ! validate_country "$country"; then
    error "Código inválido: '${country_input}'. Usa exactamente 2 letras (ej: pe, mx, co)."
    exit 1
  fi

  log "Preparando onboarding para país: ${country}."

  append_country_to_supported "$country"

  local country_env_file=".env.${country}"
  if [[ ! -f "$country_env_file" && -f "$COUNTRY_TEMPLATE" ]]; then
    cp "$COUNTRY_TEMPLATE" "$country_env_file"
  elif [[ ! -f "$country_env_file" ]]; then
    printf 'COUNTRY_CODE=%s\n' "$country" > "$country_env_file"
  fi

  local currency
  currency="$(ask_country_currency "$country" "$country_env_file")"
  prepare_country_env_file "$country" "$currency"

  if ask_yes_no "¿Inicializar topics de Kafka para ${country} ahora?" "y"; then
    ensure_topics_for_country "$country"
  else
    log "Se omitió inicialización de topics."
  fi

  if ask_yes_no "¿Levantar ahora ledger-consumer y status-saga para ${country}?" "y"; then
    start_country_services "$country"
    log "País ${country} agregado sin afectar países existentes."
    log "Comando usado: docker compose -p yape-${country} -f docker-compose.country.yml --env-file .env --env-file .env.${country} --profile country up -d --build"
  else
    log "Listo. Para levantar manualmente ejecuta:"
    echo "docker compose -p yape-${country} -f docker-compose.country.yml --env-file .env --env-file .env.${country} --profile country up -d --build"
  fi
}

main "$@"
