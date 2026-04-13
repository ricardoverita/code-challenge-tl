#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
COUNTRY_COMPOSE_FILE="docker-compose.country.yml"

SCENARIO="success"
COUNTRY="pe"
WALLET_ID="wallet-e2e-001"
AMOUNT="10.50"
CURRENCY="PEN"
API_URL="http://localhost:3000"
TIMEOUT_SECONDS=90
FAILURE_HOLD_SECONDS=12
WATCH_TIMEOUT_MS=120000

TMP_DIR=""
PAYMENT_ID=""
LEDGER_STOPPED=0

if [[ -t 1 ]]; then
  C_RESET='\033[0m'
  C_INFO='\033[1;34m'
  C_OK='\033[1;32m'
  C_WARN='\033[1;33m'
  C_ERR='\033[1;31m'
  C_DIM='\033[2m'
else
  C_RESET=''
  C_INFO=''
  C_OK=''
  C_WARN=''
  C_ERR=''
  C_DIM=''
fi

log_info() { printf "%b[scenario] %s%b\n" "$C_INFO" "$*" "$C_RESET"; }
log_ok() { printf "%b[scenario] %s%b\n" "$C_OK" "$*" "$C_RESET"; }
log_warn() { printf "%b[scenario] %s%b\n" "$C_WARN" "$*" "$C_RESET"; }
log_err() { printf "%b[scenario] %s%b\n" "$C_ERR" "$*" "$C_RESET" >&2; }

usage() {
  cat <<USAGE
Usage: ./scripts/run-kafka-scenario.sh [options]

Options:
  --scenario <success|failure-stop-ledger|failure>
  --country <pe|mx|co...>            (default: pe)
  --wallet-id <value>                (default: wallet-e2e-001)
  --amount <value>                   (default: 10.50)
  --currency <ISO3>                  (default: PEN)
  --api-url <url>                    (default: http://localhost:3000)
  --timeout <seconds>                (default: 90)
  --failure-hold <seconds>           (default: 12)
  --watch-timeout-ms <ms>            (default: 120000)
  -h, --help

Examples:
  ./scripts/run-kafka-scenario.sh --scenario success --country pe
  ./scripts/run-kafka-scenario.sh --scenario failure-stop-ledger --country pe
USAGE
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_err "Missing command: ${cmd}"
    exit 1
  fi
}

normalize_country() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' '
}

country_upper() {
  echo "$1" | tr '[:lower:]' '[:upper:]'
}

country_compose() {
  docker compose -p "yape-${COUNTRY}" \
    -f "$COUNTRY_COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    --env-file ".env.${COUNTRY}" \
    "$@"
}

json_get_field() {
  local field="$1"
  node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{try{const v=JSON.parse(d)?.['${field}']; process.stdout.write(v===undefined||v===null?'':String(v));}catch{process.stdout.write('')}});"
}

cleanup() {
  if [[ "$LEDGER_STOPPED" == "1" ]]; then
    log_warn "Restoring ledger-consumer for country '${COUNTRY}'..."
    country_compose up -d ledger-consumer >/dev/null 2>&1 || true
  fi

  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --scenario)
        SCENARIO="${2:-}"
        shift 2
        ;;
      --country)
        COUNTRY="${2:-}"
        shift 2
        ;;
      --wallet-id)
        WALLET_ID="${2:-}"
        shift 2
        ;;
      --amount)
        AMOUNT="${2:-}"
        shift 2
        ;;
      --currency)
        CURRENCY="${2:-}"
        shift 2
        ;;
      --api-url)
        API_URL="${2:-}"
        shift 2
        ;;
      --timeout)
        TIMEOUT_SECONDS="${2:-}"
        shift 2
        ;;
      --failure-hold)
        FAILURE_HOLD_SECONDS="${2:-}"
        shift 2
        ;;
      --watch-timeout-ms)
        WATCH_TIMEOUT_MS="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        log_err "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
  done

  COUNTRY="$(normalize_country "$COUNTRY")"

  if [[ "$SCENARIO" == "failure" ]]; then
    SCENARIO="failure-stop-ledger"
  fi

  if [[ ! "$COUNTRY" =~ ^[a-z]{2}$ ]]; then
    log_err "Invalid country '${COUNTRY}'. Use 2-letter code (pe, mx, co...)."
    exit 1
  fi

  if [[ "$SCENARIO" != "success" && "$SCENARIO" != "failure-stop-ledger" ]]; then
    log_err "Invalid scenario '${SCENARIO}'. Allowed: success, failure-stop-ledger"
    exit 1
  fi

  if [[ ! "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 10 ]]; then
    log_err "--timeout must be an integer >= 10"
    exit 1
  fi

  if [[ ! "$FAILURE_HOLD_SECONDS" =~ ^[0-9]+$ ]] || [[ "$FAILURE_HOLD_SECONDS" -lt 1 ]]; then
    log_err "--failure-hold must be an integer >= 1"
    exit 1
  fi
}

ensure_files() {
  if [[ ! -f "$ENV_FILE" ]]; then
    log_err "Missing ${ENV_FILE}. Run ./scripts/init-local.sh first."
    exit 1
  fi

  if [[ ! -f ".env.${COUNTRY}" ]]; then
    log_err "Missing .env.${COUNTRY}. Create it (or run ./scripts/add-new-country.sh ${COUNTRY})."
    exit 1
  fi

  if [[ ! -f "$COUNTRY_COMPOSE_FILE" ]]; then
    log_err "Missing ${COUNTRY_COMPOSE_FILE}."
    exit 1
  fi
}

ensure_stack() {
  log_info "Ensuring core services are up (kafka, api, relay, fraud)..."
  docker compose --env-file "$ENV_FILE" \
    --profile core \
    --profile init-topics \
    --profile payment-api \
    --profile outbox-relay \
    --profile fraud-consumer \
    up -d --build postgres kafka topic-init payment-api outbox-relay fraud-consumer >/dev/null

  log_info "Ensuring country services are up for ${COUNTRY} (ledger, saga)..."
  country_compose --profile country up -d --build ledger-consumer status-saga >/dev/null

  for c in yape-kafka yape-payment-api yape-outbox-relay yape-fraud-consumer; do
    if ! docker ps --format '{{.Names}}' | grep -Fxq "$c"; then
      log_err "Required container is not running: ${c}"
      exit 1
    fi
  done

  if ! country_compose ps --status running --services | grep -Fxq 'status-saga'; then
    log_err "status-saga is not running for ${COUNTRY}."
    exit 1
  fi

  if [[ "$SCENARIO" == "success" ]] && ! country_compose ps --status running --services | grep -Fxq 'ledger-consumer'; then
    log_err "ledger-consumer is not running for ${COUNTRY}."
    exit 1
  fi

  log_ok "Base stack is ready."
}

stop_ledger_consumer() {
  log_warn "Stopping ledger-consumer for country ${COUNTRY} to simulate failure..."
  country_compose stop ledger-consumer >/dev/null
  LEDGER_STOPPED=1

  if country_compose ps --status running --services | grep -Fxq 'ledger-consumer'; then
    log_err "ledger-consumer is still running after stop command."
    exit 1
  fi

  log_ok "ledger-consumer stopped."
}

start_ledger_consumer() {
  log_info "Starting ledger-consumer again for country ${COUNTRY}..."
  country_compose up -d ledger-consumer >/dev/null
  LEDGER_STOPPED=0
  log_ok "ledger-consumer restored."
}

topic_name() {
  local suffix="$1"
  printf '%s.payments.%s' "$COUNTRY" "$suffix"
}

start_topic_watchers() {
  TMP_DIR="$(mktemp -d)"

  local topics=(
    "$(topic_name payment.created.v1)"
    "$(topic_name fraud.assessed.v1)"
    "$(topic_name ledger.posted.v1)"
    "$(topic_name payment.settled.v1)"
    "$(topic_name payment.failed.v1)"
    "$(topic_name payment.created.v1.dlt)"
    "$(topic_name fraud.assessed.v1.dlt)"
    "$(topic_name ledger.posted.v1.dlt)"
  )

  log_info "Starting Kafka watchers (timeout ${WATCH_TIMEOUT_MS}ms each topic)..."

  for topic in "${topics[@]}"; do
    local safe
    safe="${topic//./_}"

    (
      docker exec yape-kafka /opt/kafka/bin/kafka-console-consumer.sh \
        --bootstrap-server localhost:9092 \
        --topic "$topic" \
        --property print.timestamp=true \
        --property print.key=true \
        --timeout-ms "$WATCH_TIMEOUT_MS" \
        >"${TMP_DIR}/${safe}.out" \
        2>"${TMP_DIR}/${safe}.err" || true
    ) &

    echo "$topic" >>"${TMP_DIR}/topics.list"
  done

  sleep 1
  log_ok "Watchers ready."
}

create_payment() {
  local cc payload response
  cc="$(country_upper "$COUNTRY")"

  payload="{\"walletId\":\"${WALLET_ID}\",\"countryCode\":\"${cc}\",\"amount\":${AMOUNT},\"currency\":\"${CURRENCY}\"}"

  log_info "Creating payment via API (${API_URL}/payments)..."
  response="$(curl -sS -X POST "${API_URL}/payments" -H 'Content-Type: application/json' -d "$payload")"

  PAYMENT_ID="$(printf '%s' "$response" | json_get_field paymentId)"
  local status
  status="$(printf '%s' "$response" | json_get_field status)"

  if [[ -z "$PAYMENT_ID" ]]; then
    log_err "Failed to create payment. Raw response: $response"
    exit 1
  fi

  log_ok "Payment created: paymentId=${PAYMENT_ID}, status=${status:-unknown}"
}

read_status() {
  curl -sS "${API_URL}/payments/${PAYMENT_ID}/status"
}

poll_status_until_final() {
  local started now elapsed status status_json
  started="$(date +%s)"

  while true; do
    status_json="$(read_status || true)"
    status="$(printf '%s' "$status_json" | json_get_field status)"

    if [[ -n "$status" ]]; then
      printf "%b[status] %s%b\n" "$C_DIM" "$status_json" "$C_RESET"
    else
      log_warn "Status endpoint not ready yet."
    fi

    if [[ "$status" == "settled" || "$status" == "failed" ]]; then
      log_ok "Final status reached: ${status}"
      return 0
    fi

    now="$(date +%s)"
    elapsed=$((now - started))

    if [[ "$elapsed" -ge "$TIMEOUT_SECONDS" ]]; then
      log_warn "Timeout waiting final status after ${TIMEOUT_SECONDS}s."
      return 1
    fi

    sleep 2
  done
}

wait_watchers() {
  # Wait slightly longer than poll loop to allow delayed consumers
  local wait_seconds=$((TIMEOUT_SECONDS + FAILURE_HOLD_SECONDS + 10))
  local i
  for ((i=0; i<wait_seconds; i++)); do
    if ! pgrep -f "kafka-console-consumer.sh --bootstrap-server localhost:9092" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
}

print_topic_results() {
  log_info "Kafka events captured for paymentId=${PAYMENT_ID}:"

  while IFS= read -r topic; do
    [[ -z "$topic" ]] && continue
    local safe out err line
    safe="${topic//./_}"
    out="${TMP_DIR}/${safe}.out"
    err="${TMP_DIR}/${safe}.err"

    if [[ -s "$out" ]]; then
      line="$(grep -F "$PAYMENT_ID" "$out" | head -n 1 || true)"

      if [[ -n "$line" ]]; then
        printf "%b  ✓ %s%b\n" "$C_OK" "$topic" "$C_RESET"
        echo "    $line"
      else
        printf "%b  ~ %s%b\n" "$C_WARN" "$topic (messages seen, none matched paymentId)" "$C_RESET"
      fi
    else
      printf "%b  - %s%b\n" "$C_DIM" "$topic (no message in window)" "$C_RESET"
    fi

    if [[ -s "$err" ]]; then
      local filtered
      filtered="$(grep -vE 'Processed a total of 0 messages|Reached end of topic|^$' "$err" || true)"
      if [[ -n "$filtered" ]]; then
        printf "%b    note: %s%b\n" "$C_DIM" "$filtered" "$C_RESET"
      fi
    fi
  done <"${TMP_DIR}/topics.list"
}

run_success() {
  start_topic_watchers
  create_payment
  poll_status_until_final || true
  wait_watchers
}

run_failure_stop_ledger() {
  stop_ledger_consumer
  start_topic_watchers
  create_payment

  log_warn "Holding ledger down for ${FAILURE_HOLD_SECONDS}s..."
  sleep "$FAILURE_HOLD_SECONDS"

  local snapshot
  snapshot="$(read_status || true)"
  if [[ -n "$snapshot" ]]; then
    printf "%b[status-mid] %s%b\n" "$C_WARN" "$snapshot" "$C_RESET"
  fi

  start_ledger_consumer
  poll_status_until_final || true
  wait_watchers
}

print_summary() {
  echo ""
  echo "=== Scenario summary ==="
  echo "Scenario      : ${SCENARIO}"
  echo "Country       : ${COUNTRY}"
  echo "Payment ID    : ${PAYMENT_ID}"
  echo "API           : ${API_URL}"
  echo "Kafka UI      : http://localhost:8080"
  echo ""
  echo "Useful logs:"
  echo "  docker compose logs -f outbox-relay fraud-consumer payment-api"
  echo "  docker compose -p yape-${COUNTRY} -f docker-compose.country.yml --env-file .env --env-file .env.${COUNTRY} logs -f ledger-consumer status-saga"
}

main() {
  parse_args "$@"

  require_cmd docker
  require_cmd curl
  require_cmd node

  ensure_files
  ensure_stack

  log_info "Running scenario '${SCENARIO}' for country '${COUNTRY}'..."

  case "$SCENARIO" in
    success)
      run_success
      ;;
    failure-stop-ledger)
      run_failure_stop_ledger
      ;;
  esac

  print_topic_results
  print_summary
  log_ok "Done."
}

main "$@"
