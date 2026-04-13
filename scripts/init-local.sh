#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"
COUNTRY_TEMPLATE=".env.country.example"

log() {
  printf '[init] %s\n' "$*" >&2
}

error() {
  printf '[init][error] %s\n' "$*" >&2
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

normalize_countries() {
  local raw="$1"
  echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ' | sed -E 's/,+/,/g; s/^,+//; s/,+$//'
}

set_env_var() {
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

get_env_var() {
  local file="$1"
  local key="$2"
  local value

  value="$(grep -E "^[[:space:]]*${key}=" "$file" | head -n 1 | cut -d '=' -f 2- || true)"
  printf '%s' "$value"
}

validate_countries() {
  local countries_csv="$1"
  [[ "$countries_csv" =~ ^[a-z]{2}(,[a-z]{2})*$ ]]
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

ask_country_currency() {
  local country="$1"
  local file="$2"
  local current current_country default_currency input

  current="$(get_env_var "$file" "COUNTRY_CURRENCY")"
  current_country="$(get_env_var "$file" "COUNTRY_CODE")"
  if [[ "$current_country" == "$country" && -n "$current" ]]; then
    default_currency="$current"
  else
    default_currency="$(default_currency_for_country "$country")"
  fi

  while true; do
    read -r -p "Currency for ${country} (ISO 4217, example: PEN, MXN, COP) [default: ${default_currency}]: " input
    input="${input:-$default_currency}"
    input="$(echo "$input" | tr '[:lower:]' '[:upper:]' | tr -d ' ')"

    if validate_currency "$input"; then
      printf '%s' "$input"
      return
    fi

    echo "Currency must be exactly 3 uppercase letters (example: PEN)." >&2
  done
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    log "Found existing ${ENV_FILE}."
    return
  fi

  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    error "${ENV_EXAMPLE} not found. Cannot bootstrap ${ENV_FILE}."
    exit 1
  fi

  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log "Created ${ENV_FILE} from ${ENV_EXAMPLE}."
}

configure_db_password() {
  local current_password
  current_password="$(get_env_var "$ENV_FILE" "DB_PASSWORD")"
  current_password="${current_password:-postgres}"

  if ask_yes_no "Use default DB password (${current_password})?" "y"; then
    set_env_var "$ENV_FILE" "DB_PASSWORD" "$current_password"
    return
  fi

  local new_password
  while true; do
    read -r -s -p "Enter DB password: " new_password
    echo
    if [[ -n "$new_password" ]]; then
      break
    fi
    echo "Password cannot be empty."
  done

  set_env_var "$ENV_FILE" "DB_PASSWORD" "$new_password"
  log "Updated DB_PASSWORD in ${ENV_FILE}."
}

configure_countries() {
  local current_countries input countries_csv
  current_countries="$(get_env_var "$ENV_FILE" "SUPPORTED_COUNTRIES")"
  current_countries="$(normalize_countries "${current_countries:-pe,mx}")"

  read -r -p "Add SUPPORTED_COUNTRIES (example: pe,mx,co) [default: ${current_countries}]: " input
  input="${input:-$current_countries}"
  countries_csv="$(normalize_countries "$input")"

  if [[ -z "$countries_csv" ]] || ! validate_countries "$countries_csv"; then
    error "Invalid format for countries. Use two-letter codes separated by comma (example: pe,mx,co)."
    exit 1
  fi

  set_env_var "$ENV_FILE" "SUPPORTED_COUNTRIES" "$countries_csv"
  set_env_var "$ENV_FILE" "COUNTRY_NAMESPACE_ENABLED" "true"
  set_env_var "$ENV_FILE" "DB_HOST" "yape-postgres"
  set_env_var "$ENV_FILE" "KAFKA_BROKERS" "yape-kafka:9092"

  log "Configured SUPPORTED_COUNTRIES=${countries_csv} in ${ENV_FILE}."
  printf '%s' "$countries_csv"
}

create_country_env_files() {
  local countries_csv="$1"
  local country
  IFS=',' read -ra countries <<< "$countries_csv"

  for country in "${countries[@]}"; do
    local file=".env.${country}"

    if [[ -f "$file" ]]; then
      if ! ask_yes_no "${file} already exists. Update COUNTRY_CODE and COUNTRY_CURRENCY?" "y"; then
        log "Keeping existing ${file}."
        continue
      fi
    else
      if [[ -f "$COUNTRY_TEMPLATE" ]]; then
        cp "$COUNTRY_TEMPLATE" "$file"
      else
        printf 'COUNTRY_CODE=%s\n' "$country" > "$file"
      fi
    fi

    local currency
    currency="$(ask_country_currency "$country" "$file")"

    set_env_var "$file" "COUNTRY_CODE" "$country"
    set_env_var "$file" "COUNTRY_CURRENCY" "$currency"
    log "Prepared ${file} with COUNTRY_CODE=${country} and COUNTRY_CURRENCY=${currency}."
  done
}

ensure_docker_available() {
  if ! command -v docker >/dev/null 2>&1; then
    error "docker not found in PATH. Install Docker first."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    error "docker compose not available. Please enable Docker Compose plugin."
    exit 1
  fi
}

start_stack() {
  local countries_csv="$1"
  local with_kafka_ui="$2"
  local with_visual_demo="$3"

  log "Starting core stack..."
  docker compose --env-file "$ENV_FILE" \
    --profile core \
    --profile init-topics \
    --profile payment-api \
    --profile outbox-relay \
    --profile fraud-consumer \
    up -d --build

  if [[ "$with_kafka_ui" == "yes" ]]; then
    log "Starting Kafka UI..."
    docker compose --env-file "$ENV_FILE" --profile kafka --profile kafka-ui up -d
  fi

  if [[ "$with_visual_demo" == "yes" ]]; then
    log "Starting Visual Demo..."
    docker compose --env-file "$ENV_FILE" \
      --profile core \
      --profile init-topics \
      --profile payment-api \
      --profile visual-demo \
      up -d --build visual-demo
  fi

  local country
  IFS=',' read -ra countries <<< "$countries_csv"
  for country in "${countries[@]}"; do
    local country_env_file=".env.${country}"
    log "Starting country workers for ${country}..."
    docker compose -p "yape-${country}" \
      -f docker-compose.country.yml \
      --env-file "$ENV_FILE" \
      --env-file "$country_env_file" \
      --profile country \
      up -d --build
  done

  log "Bootstrap complete."
}

print_runtime_info() {
  local countries_csv="$1"
  local with_kafka_ui="$2"
  local with_visual_demo="$3"
  local api_port db_port

  api_port="$(get_env_var "$ENV_FILE" "PORT")"
  api_port="${api_port:-3000}"

  db_port="$(get_env_var "$ENV_FILE" "DB_PORT")"
  db_port="${db_port:-5432}"

  echo ""
  echo "=== Runtime info ==="
  echo "Payment API : http://localhost:${api_port}"
  echo "Kafka broker: localhost:9092"
  echo "Postgres    : localhost:${db_port}"

  if [[ "$with_kafka_ui" == "yes" ]]; then
    echo "Kafka UI    : http://localhost:8080"
  else
    echo "Kafka UI    : disabled (run: docker compose --env-file .env --profile kafka --profile kafka-ui up -d)"
  fi

  if [[ "$with_visual_demo" == "yes" ]]; then
    echo "Visual Demo : http://localhost:4000"
  else
    echo "Visual Demo : disabled (run: docker compose --env-file .env --profile core --profile init-topics --profile payment-api --profile visual-demo up -d --build visual-demo)"
  fi

  echo "Country workers:"
  IFS=',' read -ra countries <<< "$countries_csv"
  for country in "${countries[@]}"; do
    local currency
    currency="$(get_env_var ".env.${country}" "COUNTRY_CURRENCY")"
    currency="${currency:-$(default_currency_for_country "$country")}"
    echo " - ${country}: project yape-${country} (currency ${currency}, ledger-consumer, status-saga)"
  done
}

main() {
  log "Interactive bootstrap started."
  ensure_docker_available
  ensure_env_file
  configure_db_password

  local countries_csv
  countries_csv="$(configure_countries)"
  create_country_env_files "$countries_csv"

  local kafka_ui_choice="no"
  if ask_yes_no "Enable Kafka UI (http://localhost:8080)?" "y"; then
    kafka_ui_choice="yes"
  fi

  local visual_demo_choice="no"
  if ask_yes_no "Enable Visual Demo (http://localhost:4000)?" "y"; then
    visual_demo_choice="yes"
  fi

  if ask_yes_no "Start Docker services now?" "y"; then
    start_stack "$countries_csv" "$kafka_ui_choice" "$visual_demo_choice"
    print_runtime_info "$countries_csv" "$kafka_ui_choice" "$visual_demo_choice"
  else
    log "Setup files prepared. You can start manually with:"
    echo "  docker compose --env-file .env --profile all up -d --build"
    IFS=',' read -ra countries <<< "$countries_csv"
    for country in "${countries[@]}"; do
      echo "  docker compose -p yape-${country} -f docker-compose.country.yml --env-file .env --env-file .env.${country} --profile country up -d --build"
    done
  fi

  log "Done."
}

main "$@"
